import * as T from "three";
/** Intersect closed solids with one plane, weld contours, classify nested holes,
 * and triangulate only solid regions. Ambiguous/open contours produce no cap.
 * Geometry is returned in world coordinates; original meshes remain unchanged.
 */
function capIsland(
  geometry: T.BufferGeometry,
  matrix: T.Matrix4,
  plane: T.Plane,
) {
  const pos = geometry.getAttribute("position"),
    index = geometry.index;
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
  const points: T.Vector3[] = [],
    links = new Map<number, Set<number>>(),
    keys = new Map<string, number>();
  const vertex = (p: T.Vector3) => {
    const key = p
      .toArray()
      .map((n) => Math.round(n * 1e6))
      .join(",");
    if (keys.has(key)) return keys.get(key)!;
    const i = points.length;
    keys.set(key, i);
    points.push(p);
    links.set(i, new Set());
    return i;
  };
  const count = index?.count ?? pos.count;
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map((k) =>
      new T.Vector3()
        .fromBufferAttribute(pos, index ? index.getX(i + k) : i + k)
        .applyMatrix4(matrix),
    );
    const d = tri.map((p) => plane.distanceToPoint(p));
    const hits: T.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (d[k] < 0 !== d[j] < 0)
        hits.push(tri[k].clone().lerp(tri[j], d[k] / (d[k] - d[j])));
    }
    if (hits.length === 2 && hits[0].distanceToSquared(hits[1]) > 1e-16) {
      const a = vertex(hits[0]),
        b = vertex(hits[1]);
      if (a !== b) {
        links.get(a)!.add(b);
        links.get(b)!.add(a);
      }
    }
  }
  if ([...links.values()].some((n) => n.size !== 2))
    return { geometry: null, open: true, loops: 0 };
  const used = new Set<number>(),
    contours: T.Vector2[][] = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    let prev = -1,
      cur = start;
    const loop: T.Vector2[] = [];
    do {
      if (used.has(cur)) return { geometry: null, open: true, loops: 0 };
      used.add(cur);
      const p = points[cur].clone().sub(origin);
      loop.push(new T.Vector2(p.dot(u), p.dot(v)));
      const next = [...links.get(cur)!].find((n) => n !== prev)!;
      prev = cur;
      cur = next;
    } while (cur !== start);
    if (loop.length >= 3) contours.push(loop);
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
    return { geometry: null, open: false, loops: contours.length };
  const cap = new T.BufferGeometry().setAttribute(
    "position",
    new T.Float32BufferAttribute(output, 3),
  );
  cap.computeVertexNormals();
  return { geometry: cap, open: false, loops: contours.length };
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
        .map((n) => Math.round(n * 1e6))
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
      const key = find(vertex[indices[0]]);
      if (!faces.has(key)) faces.set(key, []);
      faces.get(key)!.push(...indices);
    }
    groups = [...faces.values()].map((indices) =>
      new T.BufferGeometry().setAttribute("position", p).setIndex(indices),
    );
    islands.set(geometry, groups);
  }
  const output: number[] = [];
  let open = false,
    loops = 0;
  for (const g of groups) {
    const result = capIsland(g, matrix, plane);
    open ||= result.open;
    loops += result.loops;
    if (result.geometry) {
      const p = result.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++)
        output.push(p.getX(i), p.getY(i), p.getZ(i));
      result.geometry.dispose();
    }
  }
  if (!output.length) return { geometry: null, open, loops };
  const cap = new T.BufferGeometry().setAttribute(
    "position",
    new T.Float32BufferAttribute(output, 3),
  );
  cap.computeVertexNormals();
  return { geometry: cap, open, loops };
}
