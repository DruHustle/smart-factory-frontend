import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { industrialAssets, industrialModels, industrialPreview } from "../../shared/industrial-assets";
import { validateModelPackage } from "./packages";
import { modelDelivery, verifyBundledModel } from "../../client/src/components/equipment/modelDelivery";

const root = resolve(import.meta.dirname, "../../client/public");
const origin = "https://smart-factory.example";
describe("reviewed NVIDIA OpenUSD library", () => {
  it("contains three actual licensed packages, not placeholder catalogue cards", () => {
    expect(industrialAssets).toHaveLength(3);
    expect(new Set(industrialAssets.map((a) => a.id)).size).toBe(3);
    expect(industrialModels).toHaveLength(6);
    expect(industrialModels.reduce((sum, m) => sum + m.bytes, 0)).toBeLessThan(40 * 1024 * 1024);
  });
  for (const asset of industrialAssets) {
    it(`${asset.slug} retains pinned license, source receipts and real preview`, () => {
      expect(asset.license).toBe("CC-BY-4.0");
      expect(asset.attribution).toContain("NVIDIA");
      expect(asset.attribution).toContain("Modified");
      expect(asset.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
      expect(asset.sourceUrl).toContain(`/tree/${asset.sourceRevision}/${asset.id}`);
      expect(readFileSync(root + asset.licenseFileUrl, "utf8")).toContain("Attribution 4.0 International");
      const receipt = JSON.parse(readFileSync(root + asset.sourceReceiptUrl, "utf8"));
      expect(receipt.revision).toBe(asset.sourceRevision);
      expect(receipt.files.length).toBeGreaterThan(1);
      expect(receipt.files.every((f: { sha256: string }) => /^[a-f0-9]{64}$/.test(f.sha256))).toBe(true);
      const poster = readFileSync(root + asset.previewUrl);
      expect(poster.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(poster.length).toBeGreaterThan(1000);
      expect(asset.limitations.join(" ")).toMatch(/physics.*not transferred/);
      expect(asset.models.compact.manifest.components.map((c) => c.templateComponentId).sort()).toEqual(asset.models.detail.manifest.components.map((c) => c.templateComponentId).sort());
    });
    for (const quality of ["compact", "detail"] as const) it(`${asset.slug} ${quality} passes unchanged API model admission and integrity verification`, async () => {
      const model = asset.models[quality];
      expect(model.url).toMatch(/^\/models\/nvidia\/[a-z-]+\/(compact|detail)\.[a-f0-9]{16}\.glb$/);
      const bytes = readFileSync(root + model.url);
      const validated = validateModelPackage(bytes, model.manifest);
      expect(validated.sha256).toBe(model.sha256);
      expect(bytes.length).toBe(model.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(model.sha256);
      expect(validated.budget.triangles).toBe(model.triangles);
      expect(model.triangles).toBeGreaterThan(100);
      expect(model.triangles).toBeLessThanOrEqual(quality === "compact" ? 34500 : 126500);
      expect(model.manifest.bindings).toEqual([]);
      expect(model.manifest.components.every((c) => c.solid === false)).toBe(true);
      expect(industrialPreview(model.revision)).toBe(asset.previewUrl);
      expect(modelDelivery(model.url, origin).bundled).toBe(model);
      await expect(verifyBundledModel(bytes, model)).resolves.toBeUndefined();
      const corrupted = Uint8Array.from(bytes); corrupted[corrupted.length - 1] ^= 1;
      await expect(verifyBundledModel(corrupted, model)).rejects.toThrow(/integrity/);
      await expect(verifyBundledModel(bytes.subarray(1), model)).rejects.toThrow(/size/);
    });
  }
  it("does not widen the renderer to arbitrary paths, unreviewed static models or third-party fetches", () => {
    const url = industrialModels[0].url;
    for (const bad of ["https://attacker.example" + url, "//attacker.example" + url, url + "?external=1", url + "#fragment", "/models/nvidia/unreviewed.glb", "/private/file.glb", "https://user:password@smart-factory.example" + url, "/models/nvidia/../../private.glb", "data:model/gltf-binary;base64,AA=="]) {
      expect(() => modelDelivery(bad, origin)).toThrow(/authorized/);
    }
    expect(modelDelivery("/api/equipment/example/model?revision=1", origin).bundled).toBeUndefined();
    expect(industrialPreview("unknown")).toBeUndefined();
  });
});
