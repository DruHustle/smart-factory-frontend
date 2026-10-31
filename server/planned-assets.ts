/** A planned local inventory record makes no manufacturer, connectivity or publication claim. */
export function plannedAssetShell(
  assetId: string,
  name: string,
  assetType: string,
) {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 100);
  return {
    modelType: "AssetAdministrationShell",
    id: assetId,
    idShort: /^[A-Za-z]/.test(cleaned) ? cleaned : "Asset" + cleaned,
    administration: { version: "1", revision: "0" },
    assetInformation: {
      assetKind: "Instance",
      globalAssetId: assetId,
      specificAssetIds: [{ name: "assetType", value: assetType }],
    },
    extensions: [
      { name: "smartFactoryPlanned", valueType: "xs:boolean", value: "true" },
    ],
    submodels: [],
  };
}
export function isPlannedAsset(asset: {
  assetId?: string;
  aasShell: unknown;
  aasxImported?: boolean;
}) {
  if (
    asset.aasxImported ||
    !asset.assetId?.startsWith("urn:smart-factory:planned:")
  )
    return false;
  const shell = asset.aasShell as {
    extensions?: Array<{ name?: string; value?: string }>;
  } | null;
  return (
    Array.isArray(shell?.extensions) &&
    shell.extensions.some(
      (e) => e?.name === "smartFactoryPlanned" && e?.value === "true",
    )
  );
}
