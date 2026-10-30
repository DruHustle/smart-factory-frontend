import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createSurfaceGrain } from "./factory-graphics";
import type { layoutFactory } from "@shared/factory-floor";

/** Architectural context is illustrative; only inventory nodes are selectable. */
class WorkshopBuilder {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  box(material: THREE.Material, size: number[], at: number[], rotation = 0) {
    return this.add(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      material,
      at,
      [0, rotation, 0],
    );
  }
  cylinder(
    material: THREE.Material,
    radius: number,
    height: number,
    at: number[],
    rotation = [0, 0, 0],
  ) {
    return this.add(
      new THREE.CylinderGeometry(radius, radius, height, 20),
      material,
      at,
      rotation,
    );
  }
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    at: number[],
    rotation = [0, 0, 0],
  ) {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(at[0], at[1], at[2]),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rotation[0], rotation[1], rotation[2]),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    const geometries = this.parts.get(material) ?? [];
    geometries.push(geometry);
    this.parts.set(material, geometries);
  }
  finish() {
    const root = new THREE.Group();
    for (const [material, parts] of this.parts) {
      const geometry = mergeGeometries(parts, false);
      parts.forEach((part) => part.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return root;
  }
}

const surface = (
  color: THREE.ColorRepresentation,
  metalness = 0.1,
  roughness = 0.5,
) => new THREE.MeshStandardMaterial({ color, metalness, roughness });

export function createWorkshop(
  layout: ReturnType<typeof layoutFactory>,
  dark: boolean,
) {
  const b = new WorkshopBuilder();
  const concrete = surface(dark ? 0x3d454b : 0xb9b8b1, 0.02, 0.88);
  const grain = createSurfaceGrain("concrete");
  grain.repeat.set((layout.width + 3) / 2.5, (layout.depth + 3) / 2.5);
  grain.anisotropy = 4;
  concrete.roughnessMap = grain;
  concrete.bumpMap = grain;
  concrete.bumpScale = 0.004;
  const tile = surface(dark ? 0x3b4852 : 0xd0d3d0, 0.08, 0.73);
  tile.roughnessMap = grain;
  tile.bumpMap = grain;
  tile.bumpScale = 0.002;
  const steel = surface(dark ? 0x72828a : 0x99a5ab, 0.72, 0.32);
  const wall = surface(dark ? 0x344451 : 0xdce1e2, 0.08, 0.85);
  const window = surface(dark ? 0x172e3b : 0x97b2bd, 0.38, 0.25);
  const yellow = surface(0xe8b746, 0.15, 0.5);
  const seams = surface(dark ? 0x2a363f : 0xaab2b3, 0, 1);
  const orange = surface(0xc95d24, 0.45, 0.38);
  const w = layout.width + 3,
    d = layout.depth + 3;
  b.box(concrete, [w, 0.3, d], [0, -0.15, 0]);
  // Quiet expansion joints replace the engineering grid.
  for (let x = -w / 2 + 4; x < w / 2; x += 4)
    b.box(seams, [0.018, 0.008, d], [x, 0.002, 0]);
  for (let z = -d / 2 + 4; z < d / 2; z += 4)
    b.box(seams, [w, 0.008, 0.018], [0, 0.002, z]);
  for (const area of layout.zones) {
    const x = area.x + area.width / 2,
      z = area.z + area.depth / 2;
    b.box(tile, [area.width - 0.35, 0.012, area.depth - 0.35], [x, 0.006, z]);
    for (const edge of [-1, 1]) {
      b.box(
        yellow,
        [area.width - 0.4, 0.016, 0.065],
        [x, 0.025, z + edge * (area.depth / 2 - 0.2)],
      );
      b.box(
        yellow,
        [0.065, 0.016, area.depth - 0.4],
        [x + edge * (area.width / 2 - 0.2), 0.025, z],
      );
    }
  }
  // Cutaway hall: the two far walls keep the floor and selection unobstructed.
  b.box(wall, [w, 4.5, 0.16], [0, 2.05, -d / 2]);
  b.box(wall, [0.16, 4.5, d], [-w / 2, 2.05, 0]);
  b.box(window, [w - 0.4, 1.1, 0.03], [0, 2.95, -d / 2 + 0.095]);
  b.box(window, [0.03, 1.1, d - 0.4], [-w / 2 + 0.095, 2.95, 0]);
  for (let x = -w / 2 + 0.2; x < w / 2; x += 5) {
    b.box(steel, [0.15, 4.7, 0.25], [x, 2.1, -d / 2 + 0.13]);
    b.box(orange, [0.22, 0.65, 0.32], [x, 0.2, -d / 2 + 0.13]);
  }
  for (let z = -d / 2 + 0.2; z < d / 2; z += 5) {
    b.box(steel, [0.25, 4.7, 0.15], [-w / 2 + 0.13, 2.1, z]);
    b.box(orange, [0.32, 0.65, 0.22], [-w / 2 + 0.13, 0.2, z]);
  }
  for (const y of [0.8, 3.9]) {
    b.cylinder(
      steel,
      0.07,
      w - 0.5,
      [0, y, -d / 2 + 0.35],
      [0, 0, Math.PI / 2],
    );
    b.cylinder(
      steel,
      0.07,
      d - 0.5,
      [-w / 2 + 0.35, y, 0],
      [Math.PI / 2, 0, 0],
    );
  }
  const lamp = surface(0xf7f7ed, 0, 0.45);
  lamp.emissive.set(0xffefcf);
  lamp.emissiveIntensity = 1.4;
  const scuff = surface(dark ? 0x26333d : 0x839399, 0.1, 0.78);
  b.box(scuff, [w, 0.48, 0.03], [0, 0.24, -d / 2 + 0.1]);
  b.box(scuff, [0.03, 0.48, d], [-w / 2 + 0.1, 0.24, 0]);
  for (let x = -w / 2 + 1; x < w / 2; x += 2)
    b.box(seams, [0.022, 1.5, 0.02], [x, 1.25, -d / 2 + 0.1]);
  for (let z = -d / 2 + 1; z < d / 2; z += 2)
    b.box(seams, [0.02, 1.5, 0.022], [-w / 2 + 0.1, 1.25, z]);
  b.box(steel, [w - 0.5, 0.08, 0.38], [0, 4.1, -d / 2 + 0.55]);
  b.box(steel, [0.38, 0.08, d - 0.5], [-w / 2 + 0.55, 4.1, 0]);
  for (let x = -w / 2 + 2; x < w / 2; x += 5) {
    b.box(lamp, [1.3, 0.04, 0.2], [x, 3.75, -d / 2 + 0.7]);
    b.box(steel, [0.04, 0.32, 0.04], [x, 3.95, -d / 2 + 0.7]);
  }
  return b.finish();
}

/** Detailed immediate geometry remains usable while reference GLBs load. */
export function createEquipmentProxy(model: string | null, itemType = "") {
  const b = new WorkshopBuilder();
  const steel = surface(0xaab6bc, 0.8, 0.27),
    casing = surface(0xe0e5e6, 0.06, 0.42);
  const black = surface(0x24343e, 0.01, 0.72),
    blue = surface(0x286482, 0.06, 0.38);
  const orange = surface(0xd76526, 0.06, 0.4),
    yellow = surface(0xd3a032, 0.35, 0.4);
  const glass = surface(0x163d4f, 0.45, 0.23),
    carton = surface(0xad8658, 0, 0.95);
  const pipe = (r: number, h: number, at: number[], rotation = [0, 0, 0]) =>
    b.cylinder(steel, r, h, at, rotation);
  if (model === "pump-motor") {
    b.box(black, [2.55, 0.16, 1.15], [0, 0.12, 0]);
    for (const x of [-0.9, 0.85]) b.box(steel, [0.14, 0.3, 0.9], [x, 0.3, 0]);
    b.cylinder(blue, 0.34, 0.95, [-0.58, 0.7, 0], [0, 0, Math.PI / 2]);
    for (let n = 0; n < 12; n++) {
      const a = (n * Math.PI) / 6;
      b.box(
        blue,
        [0.88, 0.055, 0.055],
        [-0.58, 0.7 + Math.cos(a) * 0.35, Math.sin(a) * 0.35],
      );
    }
    b.cylinder(black, 0.36, 0.1, [-1.08, 0.7, 0], [0, 0, Math.PI / 2]);
    b.cylinder(yellow, 0.23, 0.35, [0.08, 0.7, 0], [0, 0, Math.PI / 2]);
    b.cylinder(blue, 0.43, 0.36, [0.55, 0.7, 0], [0, 0, Math.PI / 2]);
    pipe(0.12, 0.9, [0.55, 1.24, 0]);
    pipe(0.13, 0.55, [0.96, 0.7, 0], [0, 0, Math.PI / 2]);
    for (const x of [0.37, 0.73])
      b.cylinder(steel, 0.46, 0.045, [x, 0.7, 0], [0, 0, Math.PI / 2]);
  } else if (model === "conveyor") {
    b.box(black, [2.65, 0.12, 0.86], [0, 0.83, 0]);
    for (const z of [-0.49, 0.49]) {
      b.box(steel, [2.8, 0.14, 0.07], [0, 0.8, z]);
      b.box(steel, [2.8, 0.055, 0.055], [0, 1.08, z]);
      for (const x of [-1.05, 1.05])
        b.box(steel, [0.09, 0.8, 0.09], [x, 0.4, z]);
    }
    for (let x = -1.2; x <= 1.2; x += 0.19)
      pipe(0.065, 0.85, [x, 0.93, 0], [Math.PI / 2, 0, 0]);
    for (const x of [-0.72, 0.35]) {
      b.box(carton, [0.52, 0.43, 0.6], [x, 1.19, 0]);
      b.box(casing, [0.07, 0.008, 0.61], [x, 1.41, 0]);
    }
    b.box(blue, [0.3, 0.35, 0.35], [-0.9, 0.62, 0.67]);
  } else if (model === "robot-arm") {
    b.box(black, [1.2, 0.18, 1.1], [0, 0.09, 0]);
    b.cylinder(steel, 0.4, 0.28, [0, 0.3, 0]);
    b.cylinder(orange, 0.32, 0.6, [0, 0.7, 0]);
    b.cylinder(black, 0.26, 0.45, [0, 1, 0], [Math.PI / 2, 0, 0]);
    b.add(
      new THREE.BoxGeometry(0.35, 0.95, 0.36),
      orange,
      [0.22, 1.42, 0],
      [0, 0, -0.47],
    );
    b.cylinder(black, 0.22, 0.4, [0.43, 1.8, 0], [Math.PI / 2, 0, 0]);
    b.add(
      new THREE.BoxGeometry(0.95, 0.27, 0.3),
      orange,
      [0.86, 1.65, 0],
      [0, 0, -0.3],
    );
    pipe(0.12, 0.35, [1.3, 1.39, 0]);
    for (const z of [-0.14, 0.14])
      b.box(steel, [0.08, 0.32, 0.07], [1.3, 1.12, z]);
    // Low guards read as a work cell without covering the robot.
    for (const z of [-1.1, 1.1]) {
      b.box(yellow, [2.8, 0.055, 0.055], [0.2, 0.88, z]);
      for (const x of [-1.15, 1.55])
        b.box(yellow, [0.055, 0.9, 0.055], [x, 0.45, z]);
    }
  } else if (model === "storage-tank") {
    pipe(0.66, 1.45, [0, 1.13, 0]);
    b.add(
      new THREE.SphereGeometry(0.66, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      steel,
      [0, 1.85, 0],
    );
    for (const x of [-0.46, 0.46])
      for (const z of [-0.46, 0.46]) pipe(0.065, 0.55, [x, 0.28, z]);
    b.cylinder(blue, 0.17, 0.35, [0, 2.48, 0]);
    pipe(0.09, 1.8, [0.85, 1.06, 0]);
    pipe(0.09, 0.55, [0.6, 1.95, 0], [0, 0, Math.PI / 2]);
    b.box(casing, [0.25, 0.3, 0.12], [0.86, 1.27, 0.12]);
  } else if (model === "control-cabinet" || model === "raspberry-pi-4b") {
    const gateway = model === "raspberry-pi-4b";
    const w = gateway ? 0.75 : 1.28,
      h = gateway ? 1.7 : 2.05;
    b.box(black, [w + 0.08, 0.16, 0.78], [0, 0.1, 0]);
    b.box(casing, [w, h, 0.7], [0, h / 2 + 0.18, 0]);
    b.box(steel, [w - 0.1, h - 0.14, 0.035], [0, h / 2 + 0.2, 0.37]);
    b.box(black, [0.44, 0.32, 0.06], [0, h * 0.72, 0.41]);
    b.box(glass, [0.36, 0.24, 0.015], [0, h * 0.72, 0.45]);
    b.box(black, [0.035, 0.22, 0.08], [w / 2 - 0.14, h * 0.44, 0.43]);
    for (let n = 0; n < 7; n++)
      b.box(black, [w * 0.55, 0.025, 0.015], [0, 0.38 + n * 0.06, 0.397]);
    if (gateway)
      for (const x of [-0.22, 0.22])
        b.cylinder(black, 0.025, 0.4, [x, h + 0.36, 0]);
  } else if (model === "valve") {
    pipe(0.18, 2.1, [0, 0.5, 0], [0, 0, Math.PI / 2]);
    b.cylinder(blue, 0.33, 0.5, [0, 0.7, 0]);
    pipe(0.07, 0.45, [0, 1.12, 0]);
    b.add(
      new THREE.TorusGeometry(0.4, 0.045, 8, 24),
      orange,
      [0, 1.4, 0],
      [Math.PI / 2, 0, 0],
    );
    for (const x of [-0.7, 0.7])
      b.cylinder(steel, 0.27, 0.075, [x, 0.5, 0], [0, 0, Math.PI / 2]);
    b.box(black, [1.4, 0.1, 0.7], [0, 0.1, 0]);
  } else {
    // Unknown devices remain generic instrumentation, never invented machinery.
    b.box(steel, [0.65, 0.12, 0.65], [0, 0.06, 0]);
    pipe(0.055, 0.7, [0, 0.45, 0]);
    b.box(blue, [0.42, 0.5, 0.3], [0, 1, 0]);
    b.box(glass, [0.28, 0.18, 0.025], [0, 1.06, 0.16]);
    if (/sensor|temperature|pressure/.test(itemType))
      pipe(0.025, 0.3, [0, 1.39, 0]);
  }
  // Dispose materials that this model did not need as well as unused arguments.
  const root = b.finish();
  const used = new Set(
    root.children.map((child) => (child as THREE.Mesh).material),
  );
  for (const material of [
    steel,
    casing,
    black,
    blue,
    orange,
    yellow,
    glass,
    carton,
  ])
    if (!used.has(material)) material.dispose();
  return root;
}
