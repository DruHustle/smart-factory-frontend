import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewPassport } from "./passport";
const state = vi.hoisted(() => ({ shared: true, getAsset: vi.fn() }));
vi.mock("./db", () => ({ getAssetRecordById: state.getAsset, getDb: vi.fn() }));
vi.mock("./demoData", () => ({ demoOnlyRead: () => state.shared }));
beforeEach(() => {
  state.shared = true;
  state.getAsset.mockReset();
});
describe("printable passport visibility", () => {
  it("allows a signed-in shared demo preview using only approved product fields", async () => {
    state.getAsset.mockResolvedValue({
      id: 1,
      name: "Simulated pump",
      assetType: "pump",
      isDemo: true,
      serialNumber: "DEMO-001",
      aasVersion: 1,
      aasShell: { secret: "never-return-this" },
      endpoint: "private-endpoint",
    });
    const result = await previewPassport(1);
    expect(result.isDemo).toBe(true);
    expect(result.fields.some((f) => f.value === "DEMO-001")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /never-return-this|private-endpoint|aasShell/,
    );
  });
  it("rejects operational records even if a repository accidentally returns one to a demo caller", async () => {
    state.getAsset.mockResolvedValue({
      id: 2,
      name: "PRIVATE",
      isDemo: false,
      serialNumber: "PRIVATE-SECRET",
    });
    await expect(previewPassport(2)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("retains an authorized individual's private preview without publishing it", async () => {
    state.shared = false;
    state.getAsset.mockResolvedValue({
      id: 2,
      name: "Owned pump",
      isDemo: false,
      aasVersion: 1,
    });
    const result = await previewPassport(2);
    expect(result.isDemo).toBe(false);
    expect(result.publishedAt).toBeNull();
    expect(result.publicId).toBeUndefined();
    expect(result.demoIdentity).toBeUndefined();
  });
  it("does not replace imported demo package data with synthetic specifications", async () => {
    state.getAsset.mockResolvedValue({
      id: 3,
      assetId: "urn:vendor:demo:imported",
      name: "Vendor demonstration package",
      assetType: "pump",
      isDemo: true,
      aasxImported: true,
      aasVersion: 1,
      manufacturer: "Original manufacturer",
    });
    const result = await previewPassport(3);
    expect(result.authoredDemo).toBe(false);
    expect(result.demoIdentity).toBeUndefined();
    expect(result.fields.find((f) => f.key === "manufacturer")?.value).toBe(
      "Original manufacturer",
    );
  });
});
