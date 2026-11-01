import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  optimizeFactoryReference,
  instantiateFactoryReference,
} from "../client/src/components/workspace/factory-graphics";

describe("physical factory reference rendering", () => {
  it("retains separate material properties and transformed geometry when batching", () => {
    const root = new THREE.Group();
    root.position.set(2, 0, 1);
    const paint = new THREE.MeshStandardMaterial({
      color: 0x126489,
      roughness: 0.38,
      metalness: 0.05,
    });
    paint.name = "Paint";
    const steel = new THREE.MeshStandardMaterial({
      color: 0xbfc7cb,
      roughness: 0.25,
      metalness: 0.95,
    });
    steel.name = "Steel";
    for (const [material, x] of [
      [paint, 0],
      [paint, 2],
      [steel, 4],
    ] as const) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material);
      mesh.position.x = x;
      root.add(mesh);
    }
    const before = new THREE.Box3().setFromObject(root),
      result = optimizeFactoryReference(root);
    expect(result.children).toHaveLength(2);
    expect(new THREE.Box3().setFromObject(result)).toEqual(before);
    expect(result.children.map((o) => (o as THREE.Mesh).material)).toContain(
      paint,
    );
    expect((result.children[1] as THREE.Mesh).material).toBe(steel);
    expect(steel.metalness).toBe(0.95);
    expect(paint.roughness).toBe(0.38);
    expect(
      (result.children[0] as THREE.Mesh).geometry.attributes.position.count,
    ).toBe(72);
  });
  it("keeps actual industrial model detail while reducing draw groups to its materials", async () => {
    const file = await readFile(
      "fixtures/equipment/factory/robot-arm/model.glb",
    );
    const gltf = await new GLTFLoader().parseAsync(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      "",
    );
    let triangles = 0;
    const originals = new Set<THREE.Material>();
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        triangles +=
          (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          originals.add(m),
        );
      }
    });
    const result = optimizeFactoryReference(gltf.scene);
    expect(result.children.length).toBe(originals.size);
    expect(result.children.length).toBeGreaterThan(3);
    expect(
      result.children.reduce(
        (n, o) => n + (o as THREE.Mesh).geometry.attributes.position.count / 3,
        0,
      ),
    ).toBe(triangles);
    expect(
      result.children.every((o) =>
        originals.has((o as THREE.Mesh).material as THREE.Material),
      ),
    ).toBe(true);
  });
  it("reuses references within one viewer and isolates geometry, materials and textures between viewers", () => {
    const root = new THREE.Group(),
      texture = new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
      );
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x335577,
    });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const optimized = optimizeFactoryReference(root);
    const materialsA = new Map<THREE.Material, THREE.Material>(),
      texturesA = new Map<THREE.Texture, THREE.Texture>(),
      a = instantiateFactoryReference(optimized, materialsA, texturesA),
      repeatedA = instantiateFactoryReference(optimized, materialsA, texturesA),
      b = instantiateFactoryReference(optimized, new Map(), new Map());
    const am = (a.children[0] as THREE.Mesh)
        .material as THREE.MeshStandardMaterial,
      bm = (b.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(am).not.toBe(bm);
    expect(am.map).not.toBe(bm.map);
    expect(am.map).not.toBe(texture);
    am.color.set(0xffffff);
    am.dispose();
    am.map!.dispose();
    expect(bm.color.getHex()).toBe(0x335577);
    expect((a.children[0] as THREE.Mesh).geometry).not.toBe(
      (b.children[0] as THREE.Mesh).geometry,
    );
    expect((a.children[0] as THREE.Mesh).geometry).not.toBe(
      (optimized.children[0] as THREE.Mesh).geometry,
    );
    expect((a.children[0] as THREE.Mesh).geometry).toBe(
      (repeatedA.children[0] as THREE.Mesh).geometry,
    );
    expect((repeatedA.children[0] as THREE.Mesh).material).toBe(am);
    expect(a.children[0].userData.sharedReferenceGeometry).toBe(true);
    expect(a.children[0].userData.viewerOwnedReferenceGeometry).toBe(true);
  });

  it("preserves indices, all vertex data, groups, draw ranges and bounds without copying renderer listeners", () => {
    const geometry = new THREE.BoxGeometry(2, 3, 4);
    geometry.translate(1, 2, 3);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.setDrawRange(6, 24);
    geometry.name = "Measured reference";
    const originalListener = () => {};
    geometry.addEventListener("dispose", originalListener);
    const source = new THREE.Group();
    source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    const instance = instantiateFactoryReference(source, new Map(), new Map());
    const owned = (instance.children[0] as THREE.Mesh).geometry;
    expect(owned.name).toBe(geometry.name);
    expect(owned.index!.array).toEqual(geometry.index!.array);
    expect(owned.index!.array).not.toBe(geometry.index!.array);
    expect(Object.keys(owned.attributes)).toEqual(
      Object.keys(geometry.attributes),
    );
    for (const [name, original] of Object.entries(geometry.attributes)) {
      const copy = owned.getAttribute(name);
      expect(copy.array).toEqual(original.array);
      expect(copy.array).not.toBe(original.array);
      expect(copy.itemSize).toBe(original.itemSize);
      expect(copy.normalized).toBe(original.normalized);
    }
    expect(owned.groups).toEqual(geometry.groups);
    expect(owned.drawRange).toEqual(geometry.drawRange);
    expect(owned.boundingBox).toEqual(geometry.boundingBox);
    expect(owned.boundingSphere).toEqual(geometry.boundingSphere);
    expect(new THREE.Box3().setFromObject(instance)).toEqual(
      new THREE.Box3().setFromObject(source),
    );
    expect(owned.hasEventListener("dispose", originalListener)).toBe(false);
  });
});

it("fits real geometry to the measured width, depth and height, centred on the floor", async () => {
  const { fitFactoryDimensions } =
    await import("../client/src/components/workspace/factory-graphics");
  const { createEquipmentProxy } =
    await import("../client/src/components/workspace/FactoryEnvironment");
  for (const model of [
    "pump-motor",
    "robot-arm",
    "warehouse-rack",
    "loading-door",
    "exit-door",
  ]) {
    const fitted = fitFactoryDimensions(createEquipmentProxy(model), {
      width: 4,
      depth: 1.2,
      height: 3,
    });
    fitted.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fitted),
      size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(4, 4);
    expect(size.z).toBeCloseTo(1.2, 4);
    expect(size.y).toBeCloseTo(3, 4);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 4);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0, 4);
  }
});
it("does not make the empty loading doorway a selectable hit surface", async () => {
  const { createEquipmentProxy } =
    await import("../client/src/components/workspace/FactoryEnvironment");
  const door = createEquipmentProxy("loading-door");
  door.updateMatrixWorld(true);
  expect(
    new THREE.Raycaster(
      new THREE.Vector3(0, 1, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(door, true),
  ).toHaveLength(0);
  expect(
    new THREE.Raycaster(
      new THREE.Vector3(1.71, 1, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(door, true).length,
  ).toBeGreaterThan(0);
});
