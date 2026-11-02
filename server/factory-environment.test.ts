import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createEquipmentProxy,
  createWorkshop,
  setWorkshopTheme,
} from "../client/src/components/workspace/FactoryEnvironment";
import { layoutFactory } from "../shared/factory-floor";

describe("immediate factory geometry", () => {
  it.each([
    "pump-motor",
    "conveyor",
    "robot-arm",
    "storage-tank",
    "control-cabinet",
    "raspberry-pi-4b",
    "raspberry-pi-5",
    "esp32-wrover-dht11",
    "valve",
    null,
  ])(
    "provides finite, bounded %s geometry without a model download or DOM",
    (model) => {
      const root = createEquipmentProxy(model, "sensor");
      let draws = 0,
        triangles = 0;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        draws++;
        const positions = object.geometry.getAttribute("position");
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        triangles += (object.geometry.index?.count ?? positions.count) / 3;
        expect(object.castShadow).toBe(true);
        object.geometry.dispose();
        object.material.dispose();
      });
      const bounds = new THREE.Box3()
        .setFromObject(root)
        .getSize(new THREE.Vector3());
      expect(Math.max(bounds.x, bounds.y, bounds.z)).toBeLessThan(3.2);
      expect(Math.min(bounds.x, bounds.y, bounds.z)).toBeGreaterThan(0.2);
      expect(triangles).toBeGreaterThan(80);
      expect(triangles).toBeLessThan(10000);
      expect(draws).toBeLessThanOrEqual(
        model === "esp32-wrover-dht11" ? 10 : 8,
      );
    },
  );

  it("batches the hall, markings and services into a small fixed draw budget in both themes", () => {
    for (const dark of [false, true]) {
      const root = createWorkshop(layoutFactory([]), dark);
      expect(root.children.length).toBeLessThanOrEqual(10);
      expect(root.children.length).toBeGreaterThan(3);
      const bounds = new THREE.Box3().setFromObject(root);
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.max.y).toBeGreaterThan(4);
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        object.material.dispose();
      });
    }
  });

  it("switches the existing workshop palette to the exact other theme without replacing geometry", () => {
    const hall = layoutFactory([]);
    const bench = {
      ...hall,
      measured: true,
      width: 3,
      depth: 3,
      zones: [],
      placements: [{ model: "raspberry-pi-5" }],
    } as unknown as Parameters<typeof createWorkshop>[0];
    for (const layout of [hall, bench]) {
      const light = createWorkshop(layout, false),
        expectedDark = createWorkshop(layout, true);
      const snapshot = (root: THREE.Object3D) => {
        const colors: number[] = [],
          geometries: THREE.BufferGeometry[] = [];
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          geometries.push(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            if (material instanceof THREE.MeshStandardMaterial)
              colors.push(material.color.getHex());
          }
        });
        return { colors, geometries };
      };
      const before = snapshot(light),
        dark = snapshot(expectedDark);
      expect(before.colors).not.toEqual(dark.colors);
      setWorkshopTheme(light, true);
      expect(snapshot(light).colors).toEqual(dark.colors);
      expect(snapshot(light).geometries).toEqual(before.geometries);
      setWorkshopTheme(light, false);
      expect(snapshot(light).colors).toEqual(before.colors);
      expect(snapshot(light).geometries).toEqual(before.geometries);
    }
  });
});
