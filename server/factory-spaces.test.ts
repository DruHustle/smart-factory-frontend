import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  factoryAreas,
  factoryWallSpans,
} from "../client/src/components/workspace/factory-spaces";
import { createWorkshop } from "../client/src/components/workspace/FactoryEnvironment";
import { floorItemAtRay } from "../client/src/components/workspace/floor-picking";

const blank = () => ({ width: 40, depth: 30, zones: [], placements: [] });
describe("factory loading, storage and exit areas", () => {
  it("provides a complete reference flow without creating inventory or changing the layout", () => {
    const layout = blank(),
      before = JSON.stringify(layout),
      areas = factoryAreas(layout);
    expect(areas.map((a) => a.kind)).toEqual([
      "inbound",
      "storage",
      "production",
      "outbound",
    ]);
    expect(areas.every((a) => a.origin === "reference")).toBe(true);
    expect(areas[0].door?.x).toBeLessThan(areas[3].door!.x);
    expect(JSON.stringify(layout)).toBe(before);
  });
  it("uses saved named-zone positions and selects the closest doorway wall", () => {
    const layout = {
        ...blank(),
        zones: [
          { name: "Receiving", x: -4, z: -15, width: 8, depth: 4, count: 0 },
          {
            name: "Warehouse / inventory",
            x: -16,
            z: -5,
            width: 8,
            depth: 6,
            count: 0,
          },
          {
            name: "Production / assembly",
            x: -5,
            z: -3,
            width: 10,
            depth: 6,
            count: 0,
          },
          { name: "Dispatch", x: 16, z: 0, width: 4, depth: 6, count: 0 },
        ],
      },
      before = JSON.stringify(layout),
      areas = factoryAreas(layout);
    expect(areas.every((a) => a.origin === "zone")).toBe(true);
    expect(areas.find((a) => a.kind === "storage")).toMatchObject({
      x: -16,
      z: -5,
      width: 8,
      depth: 6,
    });
    expect(areas.find((a) => a.kind === "inbound")?.door?.edge).toBe("north");
    expect(areas.find((a) => a.kind === "outbound")?.door?.edge).toBe("east");
    expect(JSON.stringify(layout)).toBe(before);
  });
  it("keeps default storage clear of a configured loading opening", () => {
    const layout = {
      ...blank(),
      zones: [{ name: "Inbound", x: -4, z: -15, width: 8, depth: 4, count: 0 }],
    };
    const areas = factoryAreas(layout),
      door = areas.find((a) => a.kind === "inbound")!.door!,
      storage = areas.find((a) => a.kind === "storage")!;
    expect(
      factoryWallSpans(areas, "north", 43).every(
        ([a, b]) =>
          b <= door.x - door.width / 2 || a >= door.x + door.width / 2,
      ),
    ).toBe(true);
    expect(
      storage.x + storage.width <= door.x - door.width / 2 ||
        storage.x >= door.x + door.width / 2,
    ).toBe(true);
  });
  it("leaves actual clear geometry through a loading doorway instead of painting a door on a solid wall", () => {
    const layout = {
      ...blank(),
      zones: [{ name: "Inbound", x: -4, z: -15, width: 8, depth: 4, count: 0 }],
    };
    const door = factoryAreas(layout).find((a) => a.kind === "inbound")!.door!;
    const scene = new THREE.Scene();
    scene.add(createWorkshop(layout, false));
    const item = new THREE.Mesh(
      new THREE.BoxGeometry(1, 3, 1),
      new THREE.MeshBasicMaterial(),
    );
    item.position.set(door.x, 1.6, door.z + 2);
    item.userData.floorItemRef = "asset:door-test";
    scene.add(item);
    for (const y of [1.5, 2.6]) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(door.x, y, door.z - 4),
        new THREE.Vector3(0, 0, 1),
      );
      expect(floorItemAtRay(scene, ray)).toBe("asset:door-test");
    }
  });
  it("renders real racks and keeps the illustrative context within fitted floor margins", () => {
    for (const size of [4, 40]) {
      const layout = { ...blank(), width: size, depth: size },
        model = createWorkshop(layout, false);
      const spaces = model.getObjectByName("factory-loading-storage-and-exit")!,
        storage = spaces.getObjectByName("factory-area-storage")!;
      expect(new THREE.Box3().setFromObject(storage).max.y).toBeGreaterThan(2);
      const bounds = new THREE.Box3().setFromObject(model);
      expect(bounds.max.x).toBeLessThanOrEqual(size / 2 + 2);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-size / 2 - 2);
      expect(bounds.max.z).toBeLessThanOrEqual(size / 2 + 2);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-size / 2 - 2);
      const refs: unknown[] = [];
      spaces.traverse((o) => {
        if (o.userData.floorItemRef) refs.push(o.userData.floorItemRef);
      });
      expect(refs).toEqual([]);
    }
  });
});

it("keeps a named measured floor at its actual size without adding fixed warehouse or door props", () => {
  const layout = { ...blank(), measured: true };
  expect(factoryAreas(layout)).toEqual([]);
  const room = createWorkshop(layout, false);
  room.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(room);
  expect(bounds.max.x - bounds.min.x).toBeLessThan(40.3);
  expect(bounds.max.z - bounds.min.z).toBeLessThan(30.3);
  expect(
    room.getObjectByName("factory-loading-storage-and-exit")?.children,
  ).toHaveLength(0);
});
