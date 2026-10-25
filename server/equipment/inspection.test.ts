import { test, expect } from "vitest";
import * as T from "three";
import { readFileSync } from "node:fs";
import { sectionCap } from "../../client/src/components/equipment/section";
import { applyExplosion } from "../../client/src/components/equipment/inspection";
import { inspectGlb } from "./model-budget";
test("sections preserve a hollow bore and reject open contours", () => {
  const shape = new T.Shape();
  shape.absarc(0, 0, 1, 0, Math.PI * 2, false);
  const hole = new T.Path();
  hole.absarc(0, 0, 0.5, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const solid = new T.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 64,
  });
  const cap = sectionCap(
    solid,
    new T.Matrix4(),
    new T.Plane(new T.Vector3(0, 0, 1), -0.501),
  );
  expect(cap.open).toBe(false);
  expect(cap.loops).toBe(2);
  expect(cap.geometry).toBeTruthy();
  const p = cap.geometry!.getAttribute("position");
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = new T.Vector3().fromBufferAttribute(p, i),
      b = new T.Vector3().fromBufferAttribute(p, i + 1),
      c = new T.Vector3().fromBufferAttribute(p, i + 2);
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    expect(a.clone().add(b).add(c).divideScalar(3).length()).toBeGreaterThan(
      0.5,
    );
  }
  expect(area).toBeCloseTo(Math.PI * 0.75, 2);
  expect(
    sectionCap(
      new T.PlaneGeometry(),
      new T.Matrix4(),
      new T.Plane(new T.Vector3(1, 0, 0), 0.1),
    ).open,
  ).toBe(true);
});
test("authored motion restores the exact baseline without accumulated transforms", () => {
  const node = new T.Object3D();
  node.position.set(0.2, 0.3, 0.4);
  node.rotation.set(0.1, 0.2, 0.3);
  node.updateMatrix();
  const base = node.matrix.clone();
  const part = {
    installedComponentId: "x",
    name: "cover",
    explode: {
      translation: [0.3, 0.4, 0],
      rotation: [0, 0.4, 0.2],
      pivot: [0.1, 0.25, 0],
    },
  };
  for (let i = 0; i < 100; i++) {
    applyExplosion(node, base, part, 1);
    applyExplosion(node, base, part, 0.35);
    applyExplosion(node, base, part, 0);
  }
  node.updateMatrix();
  node.matrix.elements.forEach((v, i) =>
    expect(v).toBeCloseTo(base.elements[i], 12),
  );
});
test("detailed local inventory is mapped, bounded and includes the required internals", () => {
  const file = readFileSync("fixtures/equipment/pump-motor.glb");
  inspectGlb(file);
  const m = JSON.parse(
    readFileSync("fixtures/equipment/local-template.json", "utf8"),
  );
  expect(m.components).toHaveLength(76);
  const names = m.components.map((c: any) => c.name).join(";");
  for (const term of [
    "Volute casing",
    "Impeller",
    "Mechanical seal",
    "rolling elements",
    "cage",
    "coupling",
    "Rotor",
    "Stator",
    "Winding phase",
    "Cooling fan",
  ])
    expect(names).toContain(term);
  expect(
    new Set(m.components.map((c: any) => c.templateComponentId)).size,
  ).toBe(76);
});
