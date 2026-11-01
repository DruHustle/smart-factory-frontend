import { industrialAssets } from "./industrial-assets";
import { authoredAssets } from "./authored-assets";

/** Reviewed immutable references with common integrity and admission contracts. */
export const bundledAssets = [...industrialAssets, ...authoredAssets];
export const bundledModels = bundledAssets.flatMap((asset) =>
  Object.values(asset.models),
);
export function bundledPreview(revision?: string) {
  return bundledAssets.find((asset) =>
    Object.values(asset.models).some((model) => model.revision === revision),
  )?.previewUrl;
}
