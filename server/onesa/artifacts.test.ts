import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateModel } from "./model";
const bytes = readFileSync("fixtures/equipment/pump-motor.glb");
const manifest = JSON.parse(
  readFileSync("fixtures/equipment/model-manifest.json", "utf8"),
);
const doc = readFileSync("fixtures/equipment/maintenance.txt");
const equipment = JSON.parse(
  readFileSync("fixtures/equipment/equipment.json", "utf8"),
);
it("validates exact model revision, installed component hierarchy and document associations", () => {
  expect(validateModel(bytes, manifest, doc, equipment).equipment).toHaveLength(
    2,
  );
});
it("rejects replacing geometry without a new mapping revision", () => {
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  expect(() => validateModel(changed, manifest, doc, equipment)).toThrow(
    /hash/,
  );
  const m = structuredClone(manifest);
  m.equipment[0].nodes[1].nodeIndex = 2;
  expect(() => validateModel(bytes, m, doc, equipment)).toThrow(/disagree/);
});
it("rejects missing model/component and mismatched document revision", () => {
  const m = structuredClone(manifest);
  m.equipment[0].nodes.pop();
  expect(() => validateModel(bytes, m, doc, equipment)).toThrow();
  expect(() =>
    validateModel(bytes, manifest, Buffer.from("changed"), equipment),
  ).toThrow(/Document/);
});
