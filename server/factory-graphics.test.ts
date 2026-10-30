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
  it("isolates viewer material/texture lifetimes while sharing immutable public geometry", () => {
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
    const a = instantiateFactoryReference(optimized, new Map(), new Map()),
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
    expect((a.children[0] as THREE.Mesh).geometry).toBe(
      (b.children[0] as THREE.Mesh).geometry,
    );
    expect(a.children[0].userData.sharedReferenceGeometry).toBe(true);
  });
});
