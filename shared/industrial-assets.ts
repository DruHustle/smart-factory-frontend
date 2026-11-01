import catalog from "./industrial-assets.catalog.json" with { type: "json" };

/** Reviewed, immutable public references. Never a source of operational telemetry. */
export interface IndustrialComponent {
  templateComponentId: string;
  parentTemplateComponentId: string | null;
  name: string;
  nodeIndex: number;
  nodePath: string;
  role: "structural" | "group";
  solid: boolean;
  description: string;
  source: string;
  explode: { translation: number[]; rotation: number[]; pivot: number[] };
}
export interface IndustrialModel {
  url: string;
  sha256: string;
  bytes: number;
  triangles: number;
  revision: string;
  manifest: {
    schemaVersion: "smart-factory-model-1";
    name: string;
    provenance: string;
    license: string;
    units: "m";
    handedness: "right";
    upAxis: "+Y";
    components: IndustrialComponent[];
    bindings: never[];
    maintenanceText: string;
  };
}
export interface IndustrialAsset {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  sourceUrl: string;
  sourceRevision: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  previewUrl: string;
  licenseFileUrl: string;
  sourceReceiptUrl: string;
  limitations: string[];
  models: Record<"compact" | "detail", IndustrialModel>;
}
// Generated JSON is independently validated against the API contract in CI.
export const industrialAssets = catalog.assets as unknown as IndustrialAsset[];
export const industrialModels = industrialAssets.flatMap((asset) =>
  Object.values(asset.models),
);
export function industrialPreview(revision?: string): string | undefined {
  return industrialAssets.find((asset) =>
    Object.values(asset.models).some((model) => model.revision === revision),
  )?.previewUrl;
}
