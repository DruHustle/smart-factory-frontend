import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { authoredAssets } from "../../shared/authored-assets";
import { referenceModels } from "../../shared/factory-models";
import { floorModel, floorModelUrl } from "../../shared/factory-floor";
import { bundledPreview } from "../../shared/bundled-assets";
import {
  modelDelivery,
  verifyBundledModel,
} from "../../client/src/components/equipment/modelDelivery";
import { validateModelPackage } from "./packages";
import { modelBytes, template } from "./local";

const publicRoot = new URL("../../client/public/", import.meta.url);
const read = (path: string) =>
  readFileSync(new URL(path.replace(/^\//, ""), publicRoot));
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

describe("original Blender gap assets", () => {
  it("maps the existing door and sensor inventory families without replacing known hardware", () => {
    expect(authoredAssets.map((a) => a.slug)).toEqual([
      "loading-door",
      "exit-door",
      "process-sensor",
    ]);
    expect(floorModel({ itemType: "loading_door", name: "Dock" })).toBe(
      "loading-door",
    );
    expect(floorModel({ itemType: "exit_door", name: "Personnel" })).toBe(
      "exit-door",
    );
    expect(
      floorModel({ itemType: "sensor", name: "Pressure transmitter" }),
    ).toBe("process-sensor");
    expect(floorModel({ itemType: "sensor", name: "ESP32 WROVER DHT11" })).toBe(
      "esp32-wrover-dht11",
    );
    expect(floorModel({ itemType: "pump", name: "Pump" })).toBe("pump-motor");
    expect(
      floorModel({ itemType: "unknown", name: "Unclassified" }),
    ).toBeNull();
  });

  for (const asset of authoredAssets) {
    it(`${asset.slug} preserves source, material, preview, component and delivery contracts`, async () => {
      const receipt = JSON.parse(read(asset.sourceReceiptUrl).toString());
      expect(asset.license).toBe("MIT");
      expect(read(asset.licenseFileUrl).toString()).toContain("MIT License");
      expect(receipt.generatorSha256).toBe(
        digest(
          readFileSync(
            new URL(
              "../../scripts/equipment/blender_gap_assets.py",
              import.meta.url,
            ),
          ),
        ),
      );
      expect(receipt.previewSha256).toBe(digest(read(asset.previewUrl)));
      expect(read(asset.previewUrl).subarray(0, 8).toString("hex")).toBe(
        "89504e470d0a1a0a",
      );
      expect(asset.models.compact.bytes).toBeLessThan(
        asset.models.detail.bytes,
      );
      expect(asset.models.compact.triangles).toBeLessThan(
        asset.models.detail.triangles,
      );
      expect(
        asset.models.compact.manifest.components
          .map((c) => c.templateComponentId)
          .sort(),
      ).toEqual(
        asset.models.detail.manifest.components
          .map((c) => c.templateComponentId)
          .sort(),
      );
      for (const quality of ["compact", "detail"] as const) {
        const model = asset.models[quality],
          bytes = read(model.url);
        const validated = validateModelPackage(bytes, model.manifest);
        expect(validated.sha256).toBe(model.sha256);
        expect(validated.budget.triangles).toBe(model.triangles);
        expect(model.triangles).toBeLessThanOrEqual(
          quality === "compact" ? 34500 : 126500,
        );
        expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
        expect(model.manifest.bindings).toEqual([]);
        expect(
          modelDelivery(model.url, "https://factory.example").bundled,
        ).toBe(model);
        expect(bundledPreview(model.revision)).toBe(asset.previewUrl);
        await verifyBundledModel(bytes, model);
        const modified = Uint8Array.from(bytes);
        modified[modified.length - 1] ^= 1;
        await expect(verifyBundledModel(modified, model)).rejects.toThrow(
          /integrity/,
        );
        const gltf = await new GLTFLoader().parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
          "",
        );
        gltf.scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        expect(Math.abs(bounds.min.y)).toBeLessThan(0.003);
        expect(bounds.max.y).toBeGreaterThan(
          asset.slug === "process-sensor" ? 0.17 : 2,
        );
        const materials = new Set<THREE.MeshStandardMaterial>();
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              materials.add(material);
        });
        expect(
          [...materials].some(
            (m) => m.name.includes("powder coat") && m.metalness < 0.1,
          ),
        ).toBe(true);
        expect(
          [...materials].some(
            (m) =>
              m.name.includes("steel") &&
              m.metalness > 0.8 &&
              m.roughness >= 0.25,
          ),
        ).toBe(true);
        expect([...materials].every((m) => !m.map && !m.normalMap)).toBe(true);
        for (const component of model.manifest.components) {
          let node: THREE.Object3D | undefined = gltf.scene;
          for (const name of component.nodePath.split("/").filter(Boolean))
            node = node?.children.find((child) => child.name === name);
          expect(node, component.nodePath).toBeTruthy();
          expect(gltf.parser.associations.get(node!)?.nodes).toBe(
            component.nodeIndex,
          );
        }
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        materials.forEach((m) => m.dispose());
      }
      const model = asset.models.compact;
      expect(referenceModels.find((m) => m.slug === asset.slug)?.revision).toBe(
        model.revision,
      );
      expect(floorModelUrl(asset.slug)).toContain(
        encodeURIComponent(model.revision),
      );
      expect((await template(model.revision)).sha256).toBe(model.sha256);
      expect(digest(await modelBytes(model.revision))).toBe(model.sha256);
    });
  }
});
