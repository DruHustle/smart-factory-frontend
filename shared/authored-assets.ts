import catalog from "./authored-assets.catalog.json" with { type: "json" };
import type { IndustrialAsset } from "./industrial-assets";

/** Original Blender references; independently authored, never NVIDIA-certified assets. */
export const authoredAssets = catalog.assets as unknown as (IndustrialAsset & {
  assetType: string;
})[];
export const authoredReferenceModels = authoredAssets.map((asset) => ({
  slug: asset.slug,
  name: asset.name,
  description: asset.description,
  assetType: asset.assetType,
  revision: asset.models.compact.revision,
}));
