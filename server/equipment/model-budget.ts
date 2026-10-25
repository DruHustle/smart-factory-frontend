/** Local file admission only; no renderer or model-provider calls. */
export function inspectGlb(bytes: Buffer) {
  if (
    bytes.length < 28 ||
    bytes.length > 20 * 1024 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.toString("ascii", 16, 20) !== "JSON"
  )
    throw new Error("GLB format/size budget exceeded");
  const length = bytes.readUInt32LE(12);
  if (length > bytes.length - 28) throw new Error("Invalid GLB JSON chunk");
  const g = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const n = (key: string) => (Array.isArray(g[key]) ? g[key].length : 0);
  if (n("images") || n("textures"))
    throw new Error(
      "Embedded images/textures are unsupported by the bounded static model importer",
    );
  const colors = new Map<number, number>();
  const parents = new Map<number, number>();
  for (const node of g.nodes ?? [])
    for (const child of node.children ?? []) {
      if (parents.has(child))
        throw new Error("Scene nodes must have a single parent");
      parents.set(child, 1);
    }
  const roots = g.scenes?.[g.scene ?? 0]?.nodes;
  if (
    !Array.isArray(roots) ||
    !roots.length ||
    new Set(roots).size !== roots.length ||
    roots.some(
      (i: number) =>
        !Number.isInteger(i) || i < 0 || i >= n("nodes") || parents.has(i),
    )
  )
    throw new Error("Invalid scene roots");
  const visit = (index: number, depth: number) => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= n("nodes") ||
      depth > 100 ||
      colors.get(index) === 1
    )
      throw new Error("Invalid cyclic/deep node hierarchy");
    if (colors.get(index) === 2) return;
    colors.set(index, 1);
    for (const child of g.nodes[index].children ?? []) visit(child, depth + 1);
    colors.set(index, 2);
  };
  for (let index = 0; index < n("nodes"); index++) visit(index, 0);
  if (
    n("nodes") > 2000 ||
    n("materials") > 128 ||
    n("textures") > 32 ||
    n("meshes") > 1000
  )
    throw new Error("Model complexity budget exceeded");
  // Even an approved hash cannot grant network authority to nested resource URLs.
  for (const item of [...(g.buffers ?? []), ...(g.images ?? [])])
    if (item.uri)
      throw new Error(
        "External/embedded URI resources are not allowed; use self-contained GLB binary views",
      );
  const binaryAt = 20 + length;
  if (
    binaryAt + 8 > bytes.length ||
    bytes.toString("ascii", binaryAt + 4, binaryAt + 8) !== "BIN\0"
  )
    throw new Error("GLB binary chunk required");
  const binaryStart = binaryAt + 8,
    binaryLength = bytes.readUInt32LE(binaryAt);
  if (binaryStart + binaryLength !== bytes.length)
    throw new Error("Invalid binary chunk");
  if (n("accessors") > 10000 || n("bufferViews") > 10000)
    throw new Error("Accessor budget exceeded");
  for (const view of g.bufferViews ?? []) {
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength < 0 ||
      !Number.isInteger(view.byteOffset ?? 0) ||
      (view.byteOffset ?? 0) < 0 ||
      (view.byteOffset ?? 0) + view.byteLength > binaryLength
    )
      throw new Error("Invalid binary buffer view");
  }
  const sizes: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const widths: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  for (const a of g.accessors ?? []) {
    const v = g.bufferViews?.[a.bufferView],
      size = sizes[a.componentType],
      width = widths[a.type];
    if (
      !v ||
      a.sparse ||
      !size ||
      !width ||
      !Number.isInteger(a.count) ||
      a.count < 1 ||
      a.count > 1000000 ||
      !Number.isInteger(a.byteOffset ?? 0) ||
      (a.byteOffset ?? 0) < 0 ||
      (a.byteOffset ?? 0) % size
    )
      throw new Error("Unsupported binary accessor");
    const stride = v.byteStride ?? size * width;
    if (
      !Number.isInteger(stride) ||
      stride < size * width ||
      stride > 252 ||
      stride % size ||
      (v.byteOffset ?? 0) % size ||
      (a.byteOffset ?? 0) + (a.count - 1) * stride + size * width > v.byteLength
    )
      throw new Error("Accessor outside its buffer view");
  }
  for (const node of g.nodes ?? [])
    for (const key of ["matrix", "translation", "rotation", "scale"])
      if (
        node[key] &&
        (!Array.isArray(node[key]) ||
          node[key].some(
            (v: unknown) =>
              typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e6,
          ))
      )
        throw new Error("Nonfinite/unbounded node transform");
  // Bound composed transforms too: individually finite scales can overflow
  // down a deep hierarchy and poison fitting, sectioning and picking.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const transform = (i: number, parent: number[]) => {
    const node = g.nodes[i];
    for (const [key, length] of [
      ["matrix", 16],
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
    ] as const)
      if (node[key] && node[key].length !== length)
        throw new Error("Invalid transform dimensions");
    if (node.matrix && (node.translation || node.rotation || node.scale))
      throw new Error("Ambiguous matrix/TRS transform");
    let m = node.matrix as number[] | undefined;
    if (!m) {
      const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
      if (Math.abs(x * x + y * y + z * z + w * w - 1) > 0.001)
        throw new Error("Invalid rotation quaternion");
      const [a, b, c] = node.scale ?? [1, 1, 1],
        [tx, ty, tz] = node.translation ?? [0, 0, 0];
      m = [
        (1 - 2 * (y * y + z * z)) * a,
        2 * (x * y + z * w) * a,
        2 * (x * z - y * w) * a,
        0,
        2 * (x * y - z * w) * b,
        (1 - 2 * (x * x + z * z)) * b,
        2 * (y * z + x * w) * b,
        0,
        2 * (x * z + y * w) * c,
        2 * (y * z - x * w) * c,
        (1 - 2 * (x * x + y * y)) * c,
        0,
        tx,
        ty,
        tz,
        1,
      ];
    }
    if (m[3] || m[7] || m[11] || m[15] !== 1)
      throw new Error("Nonaffine node transform");
    const world = Array.from({ length: 16 }, (_, k) => {
      const r = k % 4,
        c = Math.floor(k / 4);
      return [0, 1, 2, 3].reduce(
        (v, j) => v + parent[j * 4 + r] * m![c * 4 + j],
        0,
      );
    });
    if (world.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000))
      throw new Error("Composed transform budget exceeded");
    for (const child of node.children ?? []) transform(child, world);
  };
  for (let i = 0; i < n("nodes"); i++)
    if (!parents.has(i)) transform(i, identity);
  const meshCounts: number[] = [];
  let vertexBudget = 0;
  for (const mesh of g.meshes ?? []) {
    let countForMesh = 0;
    for (const p of mesh.primitives ?? []) {
      if (p.targets?.length) throw new Error("Morph targets are unsupported");
      if (p.mode != null && p.mode !== 4)
        throw new Error("Only triangle primitives supported");
      const position = g.accessors?.[p.attributes?.POSITION],
        view = g.bufferViews?.[position?.bufferView];
      if (
        !position ||
        position.componentType !== 5126 ||
        position.type !== "VEC3" ||
        position.sparse ||
        !view ||
        view.buffer !== 0 ||
        !Number.isInteger(position.count) ||
        position.count < 0
      )
        throw new Error("Unsupported position accessor");
      vertexBudget += position.count;
      if (vertexBudget > 1000000) throw new Error("Vertex budget exceeded");
      const stride = view.byteStride ?? 12,
        base = (view.byteOffset ?? 0) + (position.byteOffset ?? 0);
      if (
        !Number.isInteger(stride) ||
        stride < 12 ||
        stride > 252 ||
        base < 0 ||
        base + (position.count - 1) * stride + 12 > binaryLength
      )
        throw new Error("Out-of-bounds position accessor");
      for (let i = 0; i < position.count; i++)
        for (let axis = 0; axis < 3; axis++) {
          const v = bytes.readFloatLE(
            binaryStart + base + i * stride + axis * 4,
          );
          if (!Number.isFinite(v) || Math.abs(v) > 1e6)
            throw new Error("Nonfinite/unbounded vertex");
        }
      const count =
        p.indices == null ? position.count : g.accessors?.[p.indices]?.count;
      if (!Number.isInteger(count) || count <= 0 || count % 3)
        throw new Error("Invalid mesh accessor");
      if (p.indices != null) {
        const a = g.accessors[p.indices],
          v = g.bufferViews[a.bufferView];
        if (
          a.type !== "SCALAR" ||
          ![5121, 5123, 5125].includes(a.componentType) ||
          v.byteStride
        )
          throw new Error("Invalid index accessor");
        const base = binaryStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
          size = sizes[a.componentType];
        for (let j = 0; j < count; j++) {
          const at = base + j * size,
            value =
              size === 1
                ? bytes.readUInt8(at)
                : size === 2
                  ? bytes.readUInt16LE(at)
                  : bytes.readUInt32LE(at);
          if (value >= position.count)
            throw new Error("Index exceeds vertex count");
        }
      }
      countForMesh += count / 3;
    }
    meshCounts.push(countForMesh);
  }
  let triangles = 0,
    draws = 0;
  for (const node of g.nodes ?? [])
    if (node.mesh != null) {
      if (!Number.isInteger(node.mesh) || meshCounts[node.mesh] == null)
        throw new Error("Missing mesh");
      triangles += meshCounts[node.mesh];
      draws += g.meshes[node.mesh].primitives.length;
    }

  if (draws > 2000) throw new Error("Draw-call budget exceeded");
  if (!Number.isFinite(triangles) || triangles <= 0 || triangles > 250000)
    throw new Error("Triangle budget exceeded");
  return { bytes: bytes.length, nodes: n("nodes"), triangles };
}
