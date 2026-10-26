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

test("animation starts at the current pose, survives selection updates, and reverses without a jump", () => {
  let now = 0,
    next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const model = new T.Group(),
    scene = new T.Scene(),
    part = new T.Mesh(new T.BoxGeometry());
  part.userData.installedComponentId = "part";
  model.add(part);
  const rendered: number[] = [];
  const inspector = new InspectionScene(
    model,
    scene,
    new Map([["part", part]]),
    [
      {
        name: "part",
        installedComponentId: "part",
        solid: true,
        explode: {
          translation: [1, 0, 0],
          rotation: [0, 0, 0],
          pivot: [0, 0, 0],
        },
      },
    ],
    () => rendered.push(part.position.x),
  );
  const tick = (time: number) => {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((f) => f(time));
  };
  try {
    inspector.set({ ...defaultInspection, explode: 100 });
    expect(
      part.position.x,
      "no target-pose flash before the first animation frame",
    ).toBe(0);
    expect(rendered.every((x) => x === 0)).toBe(true);
    tick(180);
    expect(part.position.x).toBeCloseTo(0.5);
    inspector.set({
      ...defaultInspection,
      explode: 100,
      selected: "part",
      ghost: true,
    });
    expect(
      part.position.x,
      "selection/telemetry refresh cannot finish an in-flight animation",
    ).toBeCloseTo(0.5);
    tick(270);
    expect(part.position.x).toBeGreaterThan(0.5);
    expect(part.position.x).toBeLessThan(1);
    const mid = part.position.x;
    inspector.set({ ...defaultInspection, explode: 0 });
    expect(
      part.position.x,
      "reversal starts from the actual current transform",
    ).toBe(mid);
    tick(630);
    expect(part.position.x).toBe(0);
    expect(part.parent).toBe(model);
    expect(inspector.diagnostics().restorationError).toBe(0);
  } finally {
    inspector.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("inspection preserves imported alpha and emission, and applies visibility consistently", () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const model = new T.Group(),
    scene = new T.Scene(),
    assembly = new T.Group();
  assembly.userData.installedComponentId = "assembly";
  const source = new T.MeshStandardMaterial({
    opacity: 0.6,
    transparent: true,
    emissive: 0x884422,
    emissiveIntensity: 2,
  });
  const cover = new T.Mesh(new T.BoxGeometry(), source);
  cover.userData.installedComponentId = "cover";
  assembly.add(cover);
  model.add(assembly);
  const inspector = new InspectionScene(
    model,
    scene,
    new Map([
      ["assembly", assembly],
      ["cover", cover],
    ]),
    [
      { name: "assembly", installedComponentId: "assembly", role: "group" },
      {
        name: "cover",
        installedComponentId: "cover",
        role: "cover",
        solid: true,
      },
    ],
    () => {},
  );
  try {
    inspector.set({ ...defaultInspection });
    expect(cover.material.opacity).toBe(0.6);
    expect(cover.material.emissive.equals(source.emissive)).toBe(true);
    expect(cover.material.emissiveIntensity).toBe(2);
    inspector.set({ ...defaultInspection, selected: "cover", opacity: 0.5 });
    expect(cover.material.opacity).toBeCloseTo(0.3);
    inspector.set({ ...defaultInspection, covers: true });
    expect(cover.visible).toBe(false);
    inspector.set({ ...defaultInspection });
    expect(cover.visible).toBe(true);
    expect(cover.material.emissive.equals(source.emissive)).toBe(true);
    expect(cover.material.emissiveIntensity).toBe(2);
    inspector.set({
      ...defaultInspection,
      isolated: "assembly",
      hidden: ["cover"],
    });
    expect(cover.visible).toBe(false);
    inspector.set({ ...defaultInspection, hidden: ["assembly"] });
    expect(
      visibleBounds(cover).isEmpty(),
      "focus cannot reveal a child of a hidden assembly",
    ).toBe(true);
  } finally {
    inspector.dispose();
    vi.unstubAllGlobals();
  }
});

test("caps inherit saved opacity and report unsupported open surfaces without inventing a solid", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const model = new T.Group(),
    scene = new T.Scene();
  const solid = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  const open = new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial());
  solid.userData.installedComponentId = "solid";
  open.userData.installedComponentId = "open";
  model.add(solid, open);
  const reports: Array<{ openContours: number; degenerateContours: number }> =
    [];
  const inspector = new InspectionScene(
    model,
    scene,
    new Map([
      ["solid", solid],
      ["open", open],
    ]),
    [
      { name: "solid", installedComponentId: "solid", solid: true },
      { name: "open", installedComponentId: "open", solid: true },
    ],
    () => {},
    (d) => reports.push(d),
  );
  try {
    inspector.set({
      ...defaultInspection,
      section: "X",
      cut: 60,
      opacity: 0.23,
    });
    vi.advanceTimersByTime(80);
    expect(inspector.pickObjects.children.length).toBe(1);
    const cap = inspector.pickObjects.children[0] as T.Mesh<
      T.BufferGeometry,
      T.Material
    >;
    expect(cap.material.opacity).toBe(0.23);
    expect(cap.material.transparent).toBe(true);
    expect(reports.at(-1)?.openContours).toBe(1);
    inspector.set({ ...defaultInspection });
    vi.advanceTimersByTime(80);
    expect(inspector.pickObjects.children.length).toBe(0);
    expect(reports.at(-1)?.openContours).toBe(0);
  } finally {
    inspector.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("fully transparent or alpha-discarded imported surfaces do not affect focus bounds", () => {
  const model = new T.Group();
  const shown = new T.Mesh(new T.BoxGeometry());
  const invisible = new T.Mesh(
    new T.BoxGeometry(),
    new T.MeshStandardMaterial({ transparent: true, opacity: 0 }),
  );
  invisible.position.x = 100;
  model.add(shown, invisible);
  expect(visibleBounds(model).max.x).toBe(0.5);
  invisible.material.transparent = false;
  invisible.material.opacity = 0.2;
  invisible.material.alphaTest = 0.5;
  expect(visibleBounds(model).max.x).toBe(0.5);
});

test("picking skips discarded material while inspection transparency preserves an imported alpha mask", async () => {
  const { hitVisible } =
    await import("../../client/src/components/equipment/visibility");
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const model = new T.Group(),
    scene = new T.Scene();
  const front = new T.Mesh(
    new T.BoxGeometry(),
    new T.MeshStandardMaterial({ transparent: true, opacity: 0 }),
  );
  front.position.z = 2;
  front.userData.installedComponentId = "front";
  const back = new T.Mesh(new T.BoxGeometry());
  model.add(front, back);
  model.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(0, 0, 5), new T.Vector3(0, 0, -1));
  const pick = () => ray.intersectObject(model, true).find(hitVisible)?.object;
  expect(pick()).toBe(back);
  front.material.opacity = 0.2;
  front.material.alphaTest = 0.5;
  expect(pick()).toBe(back);
  front.material.opacity = 0.8;
  expect(pick()).toBe(front);
  const inspector = new InspectionScene(
    model,
    scene,
    new Map([["front", front]]),
    [{ installedComponentId: "front", name: "front", solid: true }],
    () => {},
  );
  try {
    inspector.set({ ...defaultInspection, opacity: 0.32 });
    expect(front.material.alphaTest).toBe(0.16);
    expect(front.material.opacity).toBeCloseTo(0.256);
    expect(pick()).toBe(front);
    inspector.set({ ...defaultInspection });
    expect(front.material.alphaTest).toBe(0.5);
    expect(front.material.opacity).toBe(0.8);
  } finally {
    inspector.dispose();
    vi.unstubAllGlobals();
  }
});
