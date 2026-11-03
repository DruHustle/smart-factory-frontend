import type { InventoryItem } from "@shared/inventory";
import {
  canonicalUnits,
  metrics,
  sampleValidity,
  type Metric,
} from "@shared/measurements";

export const ALL_ASSET_OBSERVATIONS = "all-assets";

const hasMetricObservation = (item: InventoryItem, metric: Metric) => {
  const measurement = item.measurements?.[metric];
  return (
    Number.isFinite(item.values?.[metric]) ||
    (measurement != null &&
      (Number.isFinite(measurement.canonicalValue) ||
        Number.isFinite(measurement.sourceValue)))
  );
};

/** Standalone equipment can hold observations through its internal asset identity.
 * A static model alone is not evidence; devices use their own numeric identity. */
export function overviewObservationSources(items: InventoryItem[]) {
  return items.filter(
    (item) =>
      item.kind === "asset" ||
      (item.kind === "equipment" &&
        metrics.some((metric) => hasMetricObservation(item, metric))) ||
      (item.kind === "device" &&
        item.itemType !== "gateway" &&
        Number.isSafeInteger(Number(item.id)) &&
        Number(item.id) > 0),
  );
}

/** Prefer a source with observations for the selected metric, never a static model. */
export function selectOverviewObservationSource(
  items: InventoryItem[],
  metric: Metric,
  requested: string | null,
  now = Date.now(),
) {
  const sources = overviewObservationSources(items);
  const assetIds = [
    ...new Set(
      sources
        .filter((item) => item.kind !== "device")
        .map((item) => item.identifier),
    ),
  ];
  const aggregateAvailable = assetIds.length > 0 && assetIds.length <= 1000;
  const explicit = sources.find((item) => item.ref === requested);
  const qualityRank = (item: InventoryItem) => {
    const measurement = item.measurements?.[metric];
    // Match the API's engineering-unit/quality requirements and the shared
    // bounded-validity policy; source selection never upgrades the evidence.
    if (
      measurement?.quality !== "good" ||
      measurement.canonicalUnit !== canonicalUnits[metric] ||
      measurement.conversionVersion !== "sf-units-v1" ||
      !Number.isFinite(measurement.canonicalValue)
    )
      return 0;
    const validity = sampleValidity(item, now).state;
    return validity === "current" || validity === "held"
      ? 2
      : validity === "stale"
        ? 1
        : 0;
  };
  const measured = sources
    .filter((item) => hasMetricObservation(item, metric))
    .sort((a, b) => {
      const timestamp = (item: InventoryItem) => {
        const value = item.sampleAt ?? Date.parse(item.lastObserved ?? "");
        return Number.isFinite(value) ? value : 0;
      };
      return (
        qualityRank(b) - qualityRank(a) ||
        timestamp(b) - timestamp(a) ||
        a.ref.localeCompare(b.ref)
      );
    });
  const aggregate = requested === ALL_ASSET_OBSERVATIONS && aggregateAvailable;
  const source = aggregate
    ? undefined
    : (explicit ??
      measured[0] ??
      (aggregateAvailable ? undefined : sources[0]));
  return {
    sources,
    selection: aggregate ? ALL_ASSET_OBSERVATIONS : (explicit?.ref ?? "auto"),
    assetIds,
    aggregateAvailable,
    source,
    value: source?.ref ?? (aggregateAvailable ? ALL_ASSET_OBSERVATIONS : ""),
    label: source?.name ?? "All registered assets",
    input:
      source?.kind === "device"
        ? { deviceId: Number(source.id) }
        : { assetIds: source ? [source.identifier] : assetIds },
  };
}
