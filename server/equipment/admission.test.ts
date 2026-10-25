import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inspectGlb } from "./model-budget";
function changed(edit: (g: any, binary: Buffer) => void) {
  const original = readFileSync("fixtures/equipment/pump-motor.glb"),
    n = original.readUInt32LE(12),
    g = JSON.parse(original.toString("utf8", 20, 20 + n)),
    binary = Buffer.from(original.subarray(28 + n));
  edit(g, binary);
  let j = Buffer.from(JSON.stringify(g));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]);
  const h = Buffer.alloc(20);
  h.write("glTF");
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(28 + j.length + binary.length, 8);
  h.writeUInt32LE(j.length, 12);
  h.write("JSON", 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binary.length, 0);
  bh.write("BIN\0", 4);
  return Buffer.concat([h, j, bh, binary]);
}
test("rejects repeated scene nodes that could multiply rendered work", () => {
  expect(() => inspectGlb(changed((g) => g.nodes[0].children.push(1)))).toThrow(
    /single parent/,
  );
});
test("rejects finite transforms whose hierarchy exceeds the composed budget", () => {
  expect(() =>
    inspectGlb(
      changed((g) => {
        g.nodes[0].scale = [10000, 10000, 10000];
        g.nodes[1].scale = [10000, 10000, 10000];
      }),
    ),
  ).toThrow(/Composed/);
});
test("rejects geometry indexes outside admitted positions", () => {
  expect(() =>
    inspectGlb(
      changed((g, b) => {
        const p = g.meshes[0].primitives[0],
          a = g.accessors[p.indices],
          v = g.bufferViews[a.bufferView];
        b.writeUInt32LE(999999, (v.byteOffset ?? 0) + (a.byteOffset ?? 0));
      }),
    ),
  ).toThrow(/Index exceeds/);
});
