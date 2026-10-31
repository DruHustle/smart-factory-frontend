import { TRPCError } from "@trpc/server";
import * as db from "./db";
import {
  removeProvisionedAas,
  removeImportedAasxAsset,
  publishEdgeConfiguration,
} from "./aasProvisioningClient";
import { isPlannedAsset } from "./planned-assets";

/** Shared by the existing inventory delete and the confirmed factory bin action. */
export async function deleteAssetInventoryRecord(
  id: number,
  options?: { localStandalone: boolean },
) {
  const asset = await db.getAssetRecordById(id);
  if (!asset)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Asset not found",
    });
  if (asset.isDemo)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Demo assets are read-only",
    });
  const connections = await db.getAssetConnections(id);
  const shell = asset.aasShell as { id?: unknown } | null;
  const localModel =
    options?.localStandalone &&
    typeof shell?.id === "string" &&
    shell.id.startsWith("urn:smart-factory:aas:") &&
    shell.id !== asset.assetId;
  if (!asset.aasxImported && (isPlannedAsset(asset) || localModel)) {
    // Planned records and database-verified standalone models are app-owned and unpublished.
  } else if (asset.aasxImported) {
    await removeImportedAasxAsset(asset);
  } else {
    await removeProvisionedAas({
      assetId: asset.assetId,
      name: asset.name,
      assetType: asset.assetType,
      manufacturer: asset.manufacturer ?? undefined,
      model: asset.model ?? undefined,
      manufacturerStreet: asset.manufacturerStreet ?? "",
      manufacturerZipcode: asset.manufacturerZipcode ?? "",
      manufacturerCityTown: asset.manufacturerCityTown ?? "",
      manufacturerNationalCode: asset.manufacturerNationalCode ?? "",
      manufacturerArticleNumber: asset.manufacturerArticleNumber ?? undefined,
      orderCodeOfManufacturer: asset.orderCodeOfManufacturer ?? undefined,
      serialNumber: asset.serialNumber ?? undefined,
      ratedValue: asset.ratedValue ?? undefined,
      ratedUnit: asset.ratedUnit ?? undefined,
      aasVersion: asset.aasVersion,
    });
  }
  if (!(await db.deleteAsset(id)))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Asset not found",
    });
  const gatewayIds = [
    ...new Set(
      connections
        .filter((item) => item.connectionDeviceType === "gateway")
        .map((item) => item.gatewayDeviceId),
    ),
  ];
  const edgeSyncFailures: string[] = [];
  for (const gatewayDeviceId of gatewayIds) {
    try {
      await publishEdgeConfiguration({
        schemaVersion: 1,
        gatewayDeviceId,
        assets: await db.getGatewayAssetConnections(gatewayDeviceId),
      });
    } catch {
      edgeSyncFailures.push(gatewayDeviceId);
    }
  }
  return { deleted: true, edgeSyncFailures };
}
