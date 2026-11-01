import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  contactShadow,
  contactShadowVisible,
} from "../../client/src/components/equipment/contactShadow";
import { defaultInspection } from "../../client/src/components/equipment/inspection";
import { industrialAssets } from "../../shared/industrial-assets";

function alphaAt(
  shadow: NonNullable<ReturnType<typeof contactShadow>>,
  x: number,
  z: number,
) {
  const column = Math.round(((x - shadow.center.x) / shadow.width + 0.5) * 127);
  const row = Math.round((0.5 - (z - shadow.center.z) / shadow.depth) * 127);
  return shadow.texture.image.data[(row * 128 + column) * 4 + 3];
}

describe("model-derived contact shading", () => {
  it("hides stale footprints during geometric inspection and waits for restoration animation", () => {
    expect(contactShadowVisible(defaultInspection)).toBe(true);
    expect(
      contactShadowVisible({ ...defaultInspection, selected: "foot" }),
    ).toBe(true);
    for (const state of [
      { explode: 1 },
      { section: "X" as const },
      { hidden: ["foot"] },
      { isolated: "foot" },
      { ghost: true },
      { covers: true },
      { opacity: 0.5 },
    ])
      expect(contactShadowVisible({ ...defaultInspection, ...state })).toBe(
        false,
      );
    expect(contactShadowVisible(defaultInspection, 0.2)).toBe(false);
    expect(contactShadowVisible(defaultInspection, 0)).toBe(true);
  });
  it("keeps asymmetric contact points under their feet, not mirrored or under floating geometry", () => {
    const group = new T.Group();
    const foot = new T.Mesh(new T.BoxGeometry(0.35, 0.25, 0.35));
    foot.position.set(0.6, 0.125, 0.6);
    const raised = new T.Mesh(new T.BoxGeometry(2, 0.1, 2));
    raised.position.y = 1;
    group.add(foot, raised);
    const shadow = contactShadow(group, new T.Box3().setFromObject(group))!;
    expect(alphaAt(shadow, 0.6, 0.6)).toBeGreaterThan(50);
    expect(alphaAt(shadow, 0.6, -0.6)).toBe(0);
    expect(alphaAt(shadow, -0.6, 0.6)).toBe(0);
    expect(alphaAt(shadow, 0, 0)).toBe(0);
    expect(shadow.texture.image.data.byteLength).toBe(65536);
    shadow.texture.dispose();
    foot.geometry.dispose();
    raised.geometry.dispose();
  });

  it("falls back for empty geometry and caps pathological overlapping work", () => {
    expect(contactShadow(new T.Group(), new T.Box3())).toBeNull();
    const group = new T.Group();
    const geometry = new T.BoxGeometry(1, 0.1, 1);
    for (let i = 0; i < 100; i++) group.add(new T.Mesh(geometry));
    expect(contactShadow(group, new T.Box3().setFromObject(group))).toBeNull();
    geometry.dispose();
  });

  for (const asset of industrialAssets)
    for (const quality of ["compact", "detail"] as const)
      it(`${asset.slug} ${quality} retains metre scale and authored PBR while grounding its actual geometry`, async () => {
        const data = readFileSync("client/public" + asset.models[quality].url);
        const gltf = await new GLTFLoader().parseAsync(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          "",
        );
        const bounds = new T.Box3().setFromObject(gltf.scene);
        const dimensions = bounds.getSize(new T.Vector3()).toArray();
        const expected = asset.slug.includes("conveyor")
          ? [1.54, 2.31, 4]
          : asset.slug.includes("rack")
            ? [4, 3.01, 1.08]
            : [0.401, 1.579, 0.838];
        dimensions.forEach((value, axis) =>
          expect(Math.abs(value - expected[axis])).toBeLessThan(0.035),
        );
        expect(Math.abs(bounds.min.y)).toBeLessThan(0.002);
        const materials = new Set<T.MeshStandardMaterial>();
        gltf.scene.traverse((object) => {
          if (object instanceof T.Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              expect(material).toBeInstanceOf(T.MeshStandardMaterial);
              materials.add(material);
            }
        });
        const authored = [...materials].map((m) => [
          m.color.getHex(),
          m.roughness,
          m.metalness,
        ]);
        expect(
          new Set(authored.map((m) => JSON.stringify(m))).size,
        ).toBeGreaterThan(1);
        for (const [, roughness, metalness] of authored) {
          expect(roughness).toBeGreaterThanOrEqual(0);
          expect(roughness).toBeLessThanOrEqual(1);
          expect(metalness).toBeGreaterThanOrEqual(0);
          expect(metalness).toBeLessThanOrEqual(1);
        }
        const shadow = contactShadow(gltf.scene, bounds);
        expect(shadow).not.toBeNull();
        expect(shadow!.work).toBeLessThanOrEqual(1000000);
        const pixels = shadow!.texture.image.data;
        let occupied = 0;
        for (let i = 3; i < pixels.length; i += 4)
          if (pixels[i] > 5) occupied++;
        expect(occupied).toBeGreaterThan(5);
        expect(occupied).toBeLessThan((128 * 128) / 2);
        expect(
          [...materials].map((m) => [
            m.color.getHex(),
            m.roughness,
            m.metalness,
          ]),
        ).toEqual(authored);
        shadow!.texture.dispose();
        gltf.scene.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        materials.forEach((m) => m.dispose());
      });
});
