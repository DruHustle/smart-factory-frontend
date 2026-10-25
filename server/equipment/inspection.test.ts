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
  const previous = JSON.parse(
    readFileSync("fixtures/equipment/revisions/3/template.json", "utf8"),
  );
  expect(m.components.length).toBeGreaterThanOrEqual(
    previous.components.length,
  );
  for (const p of previous.components)
    expect(
      m.components.find(
        (n: any) => n.templateComponentId === p.templateComponentId,
      )?.name,
    ).toBe(p.name);
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
  ).toBe(m.components.length);
});

import {
  InspectionScene,
  defaultInspection,
} from "../../client/src/components/equipment/inspection";
import {
  visibleBounds,
  frameBounds,
} from "../../client/src/components/equipment/framing";
import { vi } from "vitest";
test("ghosting shared painted materials does not make internals transparent; opacity restores", () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const model = new T.Group(),
    scene = new T.Scene(),
    shared = new T.MeshStandardMaterial(),
    housing = new T.Mesh(new T.BoxGeometry(), shared),
    internal = new T.Mesh(new T.BoxGeometry(), shared);
  housing.userData.installedComponentId = "housing";
  internal.userData.installedComponentId = "internal";
  model.add(housing, internal);
  const inspector = new InspectionScene(
    model,
    scene,
    new Map([
      ["housing", housing],
      ["internal", internal],
    ]),
    [
      { name: "housing", installedComponentId: "housing", role: "housing" },
      { name: "internal", installedComponentId: "internal", role: "internal" },
    ],
    () => {},
  );
  inspector.set({ ...defaultInspection, ghost: true });
  expect((housing.material as T.Material).opacity).toBe(0.15);
  expect((internal.material as T.Material).opacity).toBe(1);
  inspector.set({ ...defaultInspection, opacity: 0.32 });
  expect(housing.material.opacity).toBe(0.32);
  expect(internal.material.opacity).toBe(0.32);
  inspector.set({ ...defaultInspection });
  expect(housing.material.opacity).toBe(1);
  expect(internal.material.opacity).toBe(1);
  inspector.dispose();
  vi.unstubAllGlobals();
});
test("tangent faces and edges produce no fabricated cap or open-mesh warning", () => {
  for (const plane of [
    new T.Plane(new T.Vector3(1, 0, 0), -0.5),
    new T.Plane(new T.Vector3(1, 1, 0).normalize(), -Math.sqrt(0.5)),
  ]) {
    const r = sectionCap(new T.BoxGeometry(), new T.Matrix4(), plane);
    expect(r.open).toBe(false);
    expect(r.geometry).toBeNull();
    expect(r.tangent).toBe(true);
  }
});
test("focus bounds exclude hidden and discarded material and fit every retained corner", () => {
  const g = new T.Group(),
    shown = new T.Mesh(new T.BoxGeometry(2, 1, 1)),
    hidden = new T.Mesh(new T.BoxGeometry());
  hidden.position.x = 100;
  hidden.visible = false;
  g.add(shown, hidden);
  const b = visibleBounds(g, new T.Plane(new T.Vector3(1, 0, 0), 0));
  expect(b.min.x).toBe(0);
  expect(b.max.x).toBe(1);
  for (const aspect of [0.45, 1.7]) {
    const c = new T.PerspectiveCamera(42, aspect, 0.01, 100),
      target = new T.Vector3();
    frameBounds(c, target, b);
    c.lookAt(target);
    c.updateMatrixWorld();
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const p = new T.Vector3(x, y, z).project(c);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
        }
  }
});

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
test("shipped constructive solids section without false open-surface diagnostics", async () => {
  const b = readFileSync("fixtures/equipment/pump-motor.glb");
  const gltf = await new GLTFLoader().parseAsync(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);
  for (const plane of [
    new T.Plane(new T.Vector3(0, 0, 1), 0),
    new T.Plane(new T.Vector3(0, 1, 0), -0.25),
    new T.Plane(new T.Vector3(1, 0, 0), -0.42),
  ])
    gltf.scene.traverse((o) => {
      const mesh = o as T.Mesh;
      if (!mesh.isMesh) return;
      const r = sectionCap(mesh.geometry, mesh.matrixWorld, plane);
      expect(
        r.open,
        `${o.name}: genuine closed source was classified open`,
      ).toBe(false);
      expect(r.degenerate, `${o.name}: ambiguous cut`).toBe(false);
      r.geometry?.dispose();
    });
}, 10000);
