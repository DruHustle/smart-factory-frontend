import { afterEach, describe, expect, it, vi } from "vitest";
import { authoredDemoAas } from "../shared/demo-asset-projection";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

const asset = {
  id: 31,
  assetId: "urn:smart-factory:showcase:floor:pump-02",
  name: "Transfer pump and motor",
  assetType: "pump",
  isDemo: true,
  aasxImported: false,
  manufacturer: null,
  model: null,
  serialNumber: "SIM-FLOOR-pump-02",
  zone: "Process utilities",
  aasVersion: 1,
  aasShell: {},
  aasSubmodels: [],
  aasConceptDescriptions: [],
};

function caller(role = "engineer") {
  return appRouter.createCaller({
    user: {
      id: 3,
      openId: "test-engineer",
      role,
      email: "engineer@example.test",
    },
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext);
}
afterEach(() => vi.restoreAllMocks());

describe("authored demonstration AAS boundary", () => {
  it("enriches a legacy demo in memory without rewriting the stored source", () => {
    const before = structuredClone(asset);
    const model = authoredDemoAas(asset)!;
    expect(model.submodels.length).toBeGreaterThanOrEqual(10);
    expect(model.conceptDescriptions.length).toBeGreaterThan(10);
    expect(model.shell.assetInformation.globalAssetId).toBe(asset.assetId);
    expect(asset).toEqual(before);
  });

  it("preserves operational and imported vendor models verbatim", () => {
    expect(authoredDemoAas({ ...asset, isDemo: false })).toBeUndefined();
    expect(authoredDemoAas({ ...asset, aasxImported: true })).toBeUndefined();
    expect(authoredDemoAas(undefined)).toBeUndefined();
  });

  it("serves the same complete environment through shell and export APIs", async () => {
    vi.spyOn(db, "refreshDemoDataSetting").mockResolvedValue(true);
    vi.spyOn(db, "getAssetRecordById").mockResolvedValue(asset as any);
    const shell = await caller().assets.getShell({ id: asset.id });
    const exported = await caller().assets.exportAas({ id: asset.id });
    expect(shell?.missingRequiredFields).toEqual([]);
    expect(exported).toEqual({
      assetAdministrationShells: [shell?.shell],
      submodels: shell?.submodels,
      conceptDescriptions: shell?.conceptDescriptions,
    });
    expect(JSON.stringify(exported)).not.toMatch(/undefined|NaN/);
  });

  it("retains authorization and required-field checks for operational data", async () => {
    vi.spyOn(db, "refreshDemoDataSetting").mockResolvedValue(true);
    const read = vi
      .spyOn(db, "getAssetRecordById")
      .mockResolvedValue({ ...asset, isDemo: false } as any);
    await expect(
      caller("viewer").assets.exportAas({ id: asset.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    await expect(caller().assets.exportAas({ id: asset.id })).rejects.toThrow(
      /Complete the manufacturer identity/,
    );
  });
});
