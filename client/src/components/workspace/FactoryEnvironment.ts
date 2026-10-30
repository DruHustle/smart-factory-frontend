import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createSurfaceGrain } from "./factory-graphics";
import {
  factoryAreas,
  factoryAreaColors,
  factoryWallSpans,
} from "./factory-spaces";
import type { FloorLayout } from "./floor-arrangement";
import type { FactoryArea } from "./factory-spaces";

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

export function createWorkshop(layout: FloorLayout, dark: boolean) {
  const b = new WorkshopBuilder();
  const concrete = surface(dark ? 0x3d454b : 0xb9b8b1, 0.02, 0.88);
  const grain = createSurfaceGrain("concrete");
  const padding = layout.measured ? 0 : 3;
  grain.repeat.set(
    (layout.width + padding) / 2.5,
    (layout.depth + padding) / 2.5,
  );
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
  const w = layout.width + padding,
    d = layout.depth + padding;
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
  // Door openings follow named layout zones; the two near walls remain cut away.
  const areas = layout.measured
      ? measuredDoorAreas(layout)
      : factoryAreas(layout),
    north = factoryWallSpans(areas, "north", w),
    west = factoryWallSpans(areas, "west", d);
  const solid = (spans: [number, number][], point: number) =>
    spans.some(([a, c]) => point >= a && point <= c);
  for (const [a, c] of north) {
    const length = c - a,
      x = (a + c) / 2;
    b.box(wall, [length, 4.5, 0.16], [x, 2.05, -d / 2]);
    b.box(
      window,
      [Math.max(0.02, length - 0.08), 1.1, 0.03],
      [x, 2.95, -d / 2 + 0.095],
    );
  }
  for (const [a, c] of west) {
    const length = c - a,
      z = (a + c) / 2;
    b.box(wall, [0.16, 4.5, length], [-w / 2, 2.05, z]);
    b.box(
      window,
      [0.03, 1.1, Math.max(0.02, length - 0.08)],
      [-w / 2 + 0.095, 2.95, z],
    );
  }
  for (const area of areas) {
    const door = area.door;
    if (!layout.measured && door?.edge === "north")
      b.box(wall, [door.width + 0.32, 1.1, 0.16], [door.x, 3.75, -d / 2]);
    if (!layout.measured && door?.edge === "west")
      b.box(wall, [0.16, 1.1, door.width + 0.32], [-w / 2, 3.75, door.z]);
  }
  for (let x = -w / 2 + 0.2; x < w / 2; x += 5) {
    if (!solid(north, x)) continue;
    b.box(steel, [0.15, 4.7, 0.25], [x, 2.1, -d / 2 + 0.13]);
    b.box(orange, [0.22, 0.65, 0.32], [x, 0.2, -d / 2 + 0.13]);
  }
  for (let z = -d / 2 + 0.2; z < d / 2; z += 5) {
    if (!solid(west, z)) continue;
    b.box(steel, [0.25, 4.7, 0.15], [-w / 2 + 0.13, 2.1, z]);
    b.box(orange, [0.32, 0.65, 0.22], [-w / 2 + 0.13, 0.2, z]);
  }
  for (const y of [0.8, 3.9]) {
    for (const [a, c] of north)
      if (c - a > 0.1)
        b.cylinder(
          steel,
          0.07,
          c - a,
          [(a + c) / 2, y, -d / 2 + 0.35],
          [0, 0, Math.PI / 2],
        );
    for (const [a, c] of west)
      if (c - a > 0.1)
        b.cylinder(
          steel,
          0.07,
          c - a,
          [-w / 2 + 0.35, y, (a + c) / 2],
          [Math.PI / 2, 0, 0],
        );
  }
  const lamp = surface(0xf7f7ed, 0, 0.45);
  lamp.emissive.set(0xffefcf);
  lamp.emissiveIntensity = 1.4;
  const scuff = surface(dark ? 0x26333d : 0x839399, 0.1, 0.78);
  for (const [a, c] of north)
    b.box(scuff, [c - a, 0.48, 0.03], [(a + c) / 2, 0.24, -d / 2 + 0.1]);
  for (const [a, c] of west)
    b.box(scuff, [0.03, 0.48, c - a], [-w / 2 + 0.1, 0.24, (a + c) / 2]);
  for (let x = -w / 2 + 1; x < w / 2; x += 2)
    if (solid(north, x))
      b.box(seams, [0.022, 1.5, 0.02], [x, 1.25, -d / 2 + 0.1]);
  for (let z = -d / 2 + 1; z < d / 2; z += 2)
    if (solid(west, z))
      b.box(seams, [0.02, 1.5, 0.022], [-w / 2 + 0.1, 1.25, z]);
  b.box(steel, [w - 0.5, 0.08, 0.38], [0, 4.1, -d / 2 + 0.55]);
  b.box(steel, [0.38, 0.08, d - 0.5], [-w / 2 + 0.55, 4.1, 0]);
  for (let x = -w / 2 + 2; x < w / 2; x += 5) {
    b.box(lamp, [1.3, 0.04, 0.2], [x, 3.75, -d / 2 + 0.7]);
    b.box(steel, [0.04, 0.32, 0.04], [x, 3.95, -d / 2 + 0.7]);
  }
  const workshop = b.finish();
  workshop.add(createFactorySpaces(layout, dark));
  return workshop;
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
  if (model === "warehouse-rack") {
    for (const x of [-1.36, 0, 1.36])
      for (const z of [-0.43, 0.43]) {
        b.box(blue, [0.07, 3, 0.07], [x, 1.5, z]);
        b.box(steel, [0.18, 0.04, 0.18], [x, 0.02, z]);
      }
    for (const y of [0.15, 1.05, 1.95, 2.85]) {
      for (const z of [-0.42, 0.42])
        b.box(orange, [2.8, 0.09, 0.08], [0, y, z]);
      b.box(steel, [2.7, 0.035, 0.8], [0, y + 0.06, 0]);
    }
    for (const x of [-0.68, 0.68])
      for (const y of [0.48, 1.38, 2.28]) {
        b.box(carton, [1.05, 0.56, 0.7], [x, y, 0]);
        b.box(casing, [0.25, 0.16, 0.008], [x, y, 0.355]);
        b.box(black, [0.02, 0.16, 0.01], [x - 0.07, y, 0.36]);
      }
  } else if (model === "loading-door" || model === "exit-door") {
    const loading = model === "loading-door",
      w = loading ? 3.5 : 1,
      h = loading ? 3.2 : 2.1,
      depth = loading ? 0.35 : 0.2;
    for (const side of [-1, 1])
      b.box(steel, [0.08, h, depth], [side * (w / 2 - 0.04), h / 2, 0]);
    b.box(steel, [w, 0.12, depth], [0, h - 0.06, 0]);
    if (loading) {
      // Rolled-up shutter leaves the aperture open; empty space is never a hit target.
      for (let y = h - 0.58; y < h - 0.15; y += 0.075)
        b.box(casing, [w - 0.16, 0.065, depth * 0.65], [0, y, 0]);
      b.box(yellow, [w, 0.025, depth], [0, 0.0125, 0]);
      for (const side of [-1, 1])
        for (let y = 0.15; y < 1; y += 0.14)
          b.box(
            black,
            [0.085, 0.06, depth * 1.01],
            [side * (w / 2 - 0.04), y, 0],
          );
    } else {
      b.box(blue, [w - 0.16, h - 0.3, depth * 0.6], [0, (h - 0.3) / 2, 0]);
      b.box(glass, [w * 0.5, 0.45, depth * 0.63], [0, h * 0.62, 0]);
      b.box(steel, [w * 0.55, 0.035, depth * 0.85], [0, h * 0.45, 0]);
      const sign = surface(0x168857, 0, 0.65);
      sign.emissive.set(0x0a5730);
      sign.emissiveIntensity = 0.3;
      b.box(sign, [w * 0.65, 0.16, depth * 0.7], [0, h - 0.22, 0]);
      b.box(casing, [w * 0.3, 0.025, depth * 0.75], [0, h - 0.22, 0]);
    }
  } else if (model === "pump-motor") {
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

/** Architectural layout features; these are not registered inventory or stock records. */
export function createFactorySpaces(layout: FloorLayout, dark: boolean) {
  const root = new THREE.Group();
  root.name = "factory-loading-storage-and-exit";
  const steel = surface(dark ? 0x81939d : 0x8397a0, 0.72, 0.33);
  const yellow = surface(0xd9a53b, 0.1, 0.65);
  const black = surface(0x293b43, 0.04, 0.78);
  const carton = surface(dark ? 0xa58259 : 0xb99469, 0, 0.88);
  const label = surface(0xe6e6d9, 0, 0.75);
  for (const area of factoryAreas(layout)) {
    const b = new WorkshopBuilder();
    const color = new THREE.Color(factoryAreaColors[area.kind]);
    const paint = surface(
      color.clone().lerp(new THREE.Color(dark ? 0x384b54 : 0xe0e5df), 0.75),
      0,
      0.86,
    );
    const line = surface(color, 0, 0.7);
    const cx = area.x + area.width / 2,
      cz = area.z + area.depth / 2;
    b.box(paint, [area.width, 0.006, area.depth], [cx, 0.004, cz]);
    for (const side of [-1, 1]) {
      b.box(
        line,
        [area.width, 0.008, 0.045],
        [cx, 0.009, cz + (side * area.depth) / 2],
      );
      b.box(
        line,
        [0.045, 0.008, area.depth],
        [cx + (side * area.width) / 2, 0.009, cz],
      );
    }
    if (area.door) {
      const door = area.door;
      const at = (x: number, y: number, z = 0) => {
        const point = new THREE.Vector3(x, y, z).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          door.rotation,
        );
        return [point.x + door.x, point.y, point.z + door.z];
      };
      for (const side of [-1, 1]) {
        b.box(
          steel,
          [0.14, 3.2, 0.28],
          at(side * (door.width / 2 + 0.07), 1.6),
          door.rotation,
        );
        b.box(
          yellow,
          [0.24, 0.55, 0.34],
          at(side * (door.width / 2 + 0.07), 0.28, 0.05),
          door.rotation,
        );
        b.box(
          black,
          [0.25, 0.09, 0.35],
          at(side * (door.width / 2 + 0.07), 0.2, 0.05),
          door.rotation,
        );
      }
      b.box(steel, [door.width + 0.28, 0.18, 0.3], at(0, 3.15), door.rotation);
      b.box(
        line,
        [Math.max(0.8, door.width * 0.7), 0.28, 0.06],
        at(0, 3.45),
        door.rotation,
      );
      // Raised roller shutter leaves a genuinely clear loading/exit opening.
      b.cylinder(steel, 0.2, door.width, at(0, 3.36, 0.03), [
        0,
        door.rotation,
        Math.PI / 2,
      ]);
      const dx = area.kind === "inbound" ? cx - door.x : door.x - cx;
      const dz = area.kind === "inbound" ? cz - door.z : door.z - cz;
      const heading = Math.atan2(dx, dz);
      const arrow = new THREE.Shape();
      arrow.moveTo(-0.22, 0);
      arrow.lineTo(0.22, 0);
      arrow.lineTo(0, -0.5);
      arrow.closePath();
      b.add(
        new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2).rotateY(heading),
        line,
        [cx, 0.016, cz],
      );
    }
    if (!layout.measured && area.kind === "storage") {
      const width = Math.max(0.7, Math.min(8, area.width - 0.3));
      const bays = Math.max(1, Math.min(3, Math.floor(width / 2.2))),
        bayWidth = width / bays;
      const rackDepth = Math.min(0.9, Math.max(0.45, area.depth - 0.2));
      const z = area.z + Math.min(area.depth / 2, 0.8);
      for (const side of [-1, 1])
        b.box(
          steel,
          [0.055, 0.95, 0.055],
          [cx + side * width * 0.37, 2.85, z + rackDepth * 0.52],
        );
      for (let bay = 0; bay < bays; bay++) {
        const x = cx - width / 2 + bayWidth * (bay + 0.5);
        for (const side of [-1, 1])
          for (const front of [-1, 1])
            b.box(
              steel,
              [0.065, 2.4, 0.065],
              [
                x + side * (bayWidth / 2 - 0.04),
                1.2,
                z + (front * rackDepth) / 2,
              ],
            );
        for (const y of [0.2, 0.95, 1.7]) {
          b.box(yellow, [bayWidth, 0.07, rackDepth], [x, y, z]);
          const bw = Math.min(0.68, bayWidth * 0.36),
            bh = 0.48;
          for (const side of [-1, 1]) {
            const bx = x + side * bayWidth * 0.24;
            b.box(
              carton,
              [bw, bh, rackDepth * 0.8],
              [bx, y + bh / 2 + 0.04, z],
            );
            b.box(
              label,
              [bw * 0.4, 0.15, 0.012],
              [bx, y + bh / 2 + 0.04, z + rackDepth * 0.4 + 0.007],
            );
          }
        }
      }
    }
    const group = b.finish();
    group.name = `factory-area-${area.kind}`;
    group.userData.factoryArea = area;
    root.add(group);
  }
  return root;
}

/** Only actual door inventory cuts openings in a measured factory's context walls. */
export function measuredDoorAreas(layout: FloorLayout): FactoryArea[] {
  return layout.placements.flatMap((p) => {
    if (!p.dimensions || !["loading-door", "exit-door"].includes(p.model ?? ""))
      return [];
    const halfW = layout.width / 2,
      halfD = layout.depth / 2;
    const a = ((p.rotation ?? 0) * Math.PI) / 180;
    const extentX =
      (Math.abs(Math.cos(a)) * p.dimensions.width +
        Math.abs(Math.sin(a)) * p.dimensions.depth) /
      2;
    const extentZ =
      (Math.abs(Math.sin(a)) * p.dimensions.width +
        Math.abs(Math.cos(a)) * p.dimensions.depth) /
      2;
    const candidates = [
      {
        edge: "north" as const,
        gap: Math.abs(p.z + halfD) - extentZ,
        axis: p.x,
        width: extentX * 2,
      },
      {
        edge: "west" as const,
        gap: Math.abs(p.x + halfW) - extentX,
        axis: p.z,
        width: extentZ * 2,
      },
    ].sort((a, b) => a.gap - b.gap);
    const door = candidates[0];
    if (door.gap > 0.25) return [];
    return [
      {
        kind: p.model === "exit-door" ? "outbound" : "inbound",
        name: p.item.name,
        x: p.x - extentX,
        z: p.z - extentZ,
        width: extentX * 2,
        depth: extentZ * 2,
        origin: "zone",
        door: {
          edge: door.edge,
          x: door.edge === "north" ? door.axis : -halfW,
          z: door.edge === "west" ? door.axis : -halfD,
          width: door.width,
          rotation: door.edge === "north" ? 0 : Math.PI / 2,
        },
      },
    ];
  });
}
