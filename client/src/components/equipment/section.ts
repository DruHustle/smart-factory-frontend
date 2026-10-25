import * as T from "three";
/** Intersect closed solids with one plane, weld contours, classify nested holes,
 * and triangulate only solid regions. Ambiguous/open contours produce no cap.
 * Geometry is returned in world coordinates; original meshes remain unchanged.
 */
const capBuffers = new WeakMap<
  T.BufferGeometry,
  { vertices: Uint32Array; distances: Float64Array }
>();
function capIsland(
  geometry: T.BufferGeometry,
  matrix: T.Matrix4,
  plane: T.Plane,
) {
  const pos = geometry.getAttribute("position"),
    index = geometry.index,
    count = index?.count ?? pos.count;
  const local = plane.clone().applyMatrix4(matrix.clone().invert());
  const u = new T.Vector3()
    .crossVectors(
      plane.normal,
      Math.abs(plane.normal.y) < 0.9
        ? new T.Vector3(0, 1, 0)
        : new T.Vector3(1, 0, 0),
    )
    .normalize();
  const v = new T.Vector3().crossVectors(plane.normal, u),
    origin = plane.coplanarPoint(new T.Vector3());
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox!.intersectsPlane(local))
    return {
      geometry: null,
      open: false,
      loops: 0,
      tangent: false,
      degenerate: false,
    };
  const scale = geometry.boundingBox!.getSize(new T.Vector3()).length() || 1,
    eps = Math.max(1e-10, scale * 1e-8),
    weld = Math.max(1e-9, scale * 2e-7);
  let buffers = capBuffers.get(geometry);
  if (!buffers) {
    buffers = {
      vertices: Uint32Array.from(
        new Set(
          Array.from({ length: count }, (_, j) => (index ? index.getX(j) : j)),
        ),
      ),
      distances: new Float64Array(pos.count),
    };
    capBuffers.set(geometry, buffers);
  }
  const distances = buffers.distances;
  let positive = false,
    negative = false;
  for (const i of buffers.vertices) {
    const d =
      local.normal.x * pos.getX(i) +
      local.normal.y * pos.getY(i) +
      local.normal.z * pos.getZ(i) +
      local.constant;
    distances[i] = Math.abs(d) <= eps ? 0 : d;
    positive ||= d > eps;
    negative ||= d < -eps;
  }
  // Contact on a vertex/edge/face without volume on both sides has zero cut area.
  if (!positive || !negative)
    return {
      geometry: null,
      open: false,
      loops: 0,
      tangent: true,
      degenerate: false,
    };
  const points: T.Vector3[] = [],
    keys = new Map<string, number>(),
    edges = new Map<string, { a: number; b: number; n: number }>();
  const vertex = (p: T.Vector3) => {
    const key = p
      .toArray()
      .map((n) => Math.round(n / weld))
      .join(",");
    let id = keys.get(key);
    if (id === undefined) {
      id = points.length;
      keys.set(key, id);
      points.push(p);
    }
    return id;
  };
  const va = new T.Vector3(),
    vb = new T.Vector3();
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i,
      b = index ? index.getX(i + 1) : i + 1,
      c = index ? index.getX(i + 2) : i + 2;
    const da = distances[a],
      db = distances[b],
      dc = distances[c];
    if (
      (da > 0 && db > 0 && dc > 0) ||
      (da < 0 && db < 0 && dc < 0) ||
      (da === 0 && db === 0 && dc === 0)
    )
      continue;
    const ids = [a, b, c],
      d = [da, db, dc];
    const hits: number[] = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (d[k] === 0)
        hits.push(
          vertex(
            new T.Vector3()
              .fromBufferAttribute(pos, ids[k])
              .applyMatrix4(matrix),
          ),
        );
      if (d[k] * d[j] < 0) {
        va.fromBufferAttribute(pos, ids[k]);
        vb.fromBufferAttribute(pos, ids[j]);
        hits.push(
          vertex(
            va
              .clone()
              .lerp(vb, d[k] / (d[k] - d[j]))
              .applyMatrix4(matrix),
          ),
        );
      }
    }
    const unique = [...new Set(hits)];
    if (unique.length !== 2 || d.every((x) => x === 0)) continue;
    // For an on-plane edge, only the removed-side triangle supplies its boundary.
    if (d.filter((x) => x === 0).length === 2 && !d.some((x) => x < 0))
      continue;
    const [a, b] = unique,
      key = a < b ? `${a}:${b}` : `${b}:${a}`,
      edge = edges.get(key);
    if (edge) edge.n++;
    else edges.set(key, { a, b, n: 1 });
  }
  const links = new Map<number, Set<number>>();
  for (const { a, b, n } of edges.values())
    if (n % 2) {
      if (!links.has(a)) links.set(a, new Set());
      if (!links.has(b)) links.set(b, new Set());
      links.get(a)!.add(b);
      links.get(b)!.add(a);
    }
  const closed = geometry.userData.sectionClosed !== false;
  if (!closed || [...links.values()].some((n) => n.size !== 2))
    return {
      geometry: null,
      open: !closed,
      loops: 0,
      tangent: false,
      degenerate: closed,
    };
  const used = new Set<number>(),
    contours: T.Vector2[][] = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    let prev = -1,
      cur = start;
    const loop: T.Vector2[] = [];
    do {
      if (used.has(cur))
        return {
          geometry: null,
          open: false,
          loops: 0,
          tangent: false,
          degenerate: true,
        };
      used.add(cur);
      const p = points[cur].clone().sub(origin);
      loop.push(new T.Vector2(p.dot(u), p.dot(v)));
      const next = [...links.get(cur)!].find((n) => n !== prev)!;
      prev = cur;
      cur = next;
    } while (cur !== start);
    if (loop.length >= 3 && Math.abs(T.ShapeUtils.area(loop)) > weld * weld)
      contours.push(loop);
  }
  const inside = (p: T.Vector2, poly: T.Vector2[]) => {
    let yes = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        yes = !yes;
    }
    return yes;
  };
  const containers = contours.map((p, i) =>
    contours
      .map((q, j) => (j !== i && inside(p[0], q) ? j : -1))
      .filter((j) => j >= 0),
  );
  const output: number[] = [];
  contours.forEach((outer, i) => {
    if (containers[i].length % 2) return;
    const holes = contours.filter(
      (_, j) =>
        containers[j].length === containers[i].length + 1 &&
        containers[j].includes(i),
    );
    const flattened = [...outer, ...holes.flat()];
    for (const face of T.ShapeUtils.triangulateShape(outer, holes))
      for (const j of face) {
        const p = flattened[j];
        output.push(
          ...origin
            .clone()
            .addScaledVector(u, p.x)
            .addScaledVector(v, p.y)
            .toArray(),
        );
      }
  });
  if (!output.length)
    return {
      geometry: null,
      open: false,
      loops: contours.length,
      tangent: false,
      degenerate: false,
    };
  const cap = new T.BufferGeometry().setAttribute(
    "position",
    new T.Float32BufferAttribute(output, 3),
  );
  cap.computeVertexNormals();
  return {
    geometry: cap,
    open: false,
    loops: contours.length,
    tangent: false,
    degenerate: false,
  };
}

// A combined BOM set may contain many intersecting or nested closed objects.
// Cap each welded surface island independently; parity across unrelated solids
// would incorrectly subtract material (for example a cooling fin from a shell).
const islands = new WeakMap<T.BufferGeometry, T.BufferGeometry[]>();
export function sectionCap(
  geometry: T.BufferGeometry,
  matrix: T.Matrix4,
  plane: T.Plane,
) {
  let groups = islands.get(geometry);
  if (!groups) {
    const p = geometry.getAttribute("position"),
      ix = geometry.index;
    const parent: number[] = [],
      keys = new Map<string, number>(),
      vertex: number[] = [];
    const find = (a: number): number =>
      parent[a] === a ? a : (parent[a] = find(parent[a]));
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)]
        .map((n) => Math.round(n * 1e9))
        .join(",");
      let id = keys.get(key);
      if (id === undefined) {
        id = parent.length;
        parent.push(id);
        keys.set(key, id);
      }
      vertex.push(id);
    }
    const count = ix?.count ?? p.count;
    for (let i = 0; i < count; i += 3) {
      const a = find(vertex[ix ? ix.getX(i) : i]);
      for (let k = 1; k < 3; k++) {
        const b = find(vertex[ix ? ix.getX(i + k) : i + k]);
        if (a !== b) parent[b] = a;
      }
    }
    const faces = new Map<number, number[]>();
    for (let i = 0; i < count; i += 3) {
      const indices = [0, 1, 2].map((k) => (ix ? ix.getX(i + k) : i + k));
      if (new Set(indices.map((i) => vertex[i])).size < 3) continue;
      const key = find(vertex[indices[0]]);
      if (!faces.has(key)) faces.set(key, []);
      faces.get(key)!.push(...indices);
    }
    groups = [...faces.values()].map((indices) => {
      const edgeCounts = new Map<string, number>();
      for (let i = 0; i < indices.length; i += 3)
        for (let k = 0; k < 3; k++) {
          const a = vertex[indices[i + k]],
            b = vertex[indices[i + ((k + 1) % 3)]],
            key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (a !== b) edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        }
      const g = new T.BufferGeometry()
        .setAttribute("position", p)
        .setIndex(indices);
      const bounds = new T.Box3(),
        point = new T.Vector3();
      for (const i of new Set(indices))
        bounds.expandByPoint(point.fromBufferAttribute(p, i));
      g.boundingBox = bounds;
      g.userData.sectionClosed = [...edgeCounts.values()].every((n) => n === 2);
      return g;
    });
    islands.set(geometry, groups);
  }
  const output: number[] = [];
  let open = false,
    tangent = false,
    degenerate = false,
    loops = 0;
  for (const g of groups) {
    const result = capIsland(g, matrix, plane);
    open ||= result.open;
    tangent ||= !!result.tangent;
    degenerate ||= !!result.degenerate;
    loops += result.loops;
    if (result.geometry) {
      const p = result.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++)
        output.push(p.getX(i), p.getY(i), p.getZ(i));
      result.geometry.dispose();
    }
  }
  if (!output.length)
    return { geometry: null, open, loops, tangent, degenerate };
  const cap = new T.BufferGeometry().setAttribute(
    "position",
    new T.Float32BufferAttribute(output, 3),
  );
  cap.computeVertexNormals();
  return { geometry: cap, open, loops, tangent, degenerate };
}
