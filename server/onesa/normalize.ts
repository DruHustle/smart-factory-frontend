import {
  metrics,
  convertMeasurement,
  convertCanonicalTo,
  type Metric,
  type Measurements,
} from "../../shared/measurements";
import { createHash } from "node:crypto";
import { provenanceSchema } from "../telemetryProvenance";
export { provenanceSchema } from "../telemetryProvenance";
import {
  eventSchema,
  type Registration,
  type Mapping,
  type IntegrationEvent,
} from "./contract";
export type SourceSample = {
  deviceId: string;
  assetId?: string | null;
  ingestionId?: string;
  timestamp: number;
  sensorStatus?: string;
  assetSignals?: Record<string, number>;
} & Record<string, unknown>;
export function normalize(
  sample: SourceSample,
  registration: Registration,
  mapping: Mapping,
  scope: { installationId: string; workspaceId: string },
  mappingVersion: number,
): IntegrationEvent[] {
  const p = provenanceSchema.parse(sample.integration);
  if (
    sample.deviceId !== registration.deviceId ||
    sample.assetId !== registration.externalAssetId ||
    mapping.retired
  )
    throw new Error("Unmapped or retired source");
  const observedAt = new Date(sample.timestamp).toISOString();
  const observed = Date.parse(observedAt),
    received = Date.parse(p.gatewayReceivedAt);
  if (observed > received + 300000)
    throw new Error("Source clock exceeds five minute future tolerance");
  const common = {
    installationId: scope.installationId,
    equipmentId: registration.equipmentId,
    externalAssetId: registration.externalAssetId,
    assetTypeId: registration.assetTypeId,
    observedAt,
    gatewayReceivedAt: p.gatewayReceivedAt,
    mode: p.mode,
    scenarioRunId: p.scenarioRunId ?? null,
    replayRunId: p.replayRunId ?? null,
    sessionId: p.sessionId ?? null,
    sequence: p.sequence ?? null,
    sourceQuality:
      sample.sensorStatus === "read_error" ? ("bad" as const) : p.sourceQuality,
    sourceConnection: p.sourceConnection,
    clockSkew:
      observed > received + 5000
        ? ("future" as const)
        : received - observed > 60000
          ? ("delayed" as const)
          : ("within_tolerance" as const),
  };
  // Event identity does not include mapping/name/tag/unit revision. Reconciliation
  // never causes old data to be duplicated under a different immutable ID.
  const eventId = (key: string) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          scope.installationId,
          registration.equipmentId,
          sample.ingestionId ??
            createHash("sha256").update(JSON.stringify(sample)).digest("hex"),
          key,
        ]),
      )
      .digest("hex");
  const target = (componentId: string) => {
    const t = mapping.targets.find((t) => t.componentId === componentId);
    if (!t) throw new Error("Missing component mapping");
    return {
      workspaceId: scope.workspaceId,
      equipmentId: t.equipmentId,
      componentId: t.targetComponentId,
      mappingVersion,
    };
  };
  const events: IntegrationEvent[] = [];
  for (const b of registration.bindings) {
    let raw = b.sourceKey.startsWith("assetSignals.")
      ? sample.assetSignals?.[b.sourceKey.slice(13)]
      : sample[b.sourceKey];
    if (raw == null) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw))
      throw new Error("Nonfinite or unsupported value");
    const verified = (sample.measurements as Measurements | undefined)?.[
      b.sourceKey as Metric
    ];
    if (sample.measurements && metrics.includes(b.sourceKey as Metric)) {
      if (
        !verified?.canonicalUnit ||
        verified.conversionVersion !== "sf-units-v1" ||
        verified.canonicalValue == null ||
        verified.quality !== "good"
      )
        continue;
      // Receiver enforces the acquisition's actual unit, not a label supplied by a binding.
      raw = verified.sourceValue;
    }
    const rawUnit = verified?.sourceUnit ?? b.sourceUnit;
    let factor = 1,
      offset = 0;
    if (verified) {
      const metric = b.sourceKey as Metric;
      const zero = convertCanonicalTo(
        metric,
        convertMeasurement(metric, 0, rawUnit!),
        b.metric.unit,
      );
      const one = convertCanonicalTo(
        metric,
        convertMeasurement(metric, 1, rawUnit!),
        b.metric.unit,
      );
      factor = one - zero;
      offset = zero;
    } else if (b.sourceUnit !== b.metric.unit)
      factor = (
        {
          "Pa:bar": 0.00001,
          "bar:Pa": 100000,
          "W:kW": 0.001,
          "kW:W": 1000,
        } as Record<string, number>
      )[`${b.sourceUnit}:${b.metric.unit}`];
    if (!factor) throw new Error("Incompatible units");
    events.push(
      eventSchema.parse({
        ...common,
        eventId: eventId(b.componentId + ":" + b.metric.metricId),
        componentId: b.componentId,
        target: target(b.componentId),
        kind: "observation",
        metric: b.metric,
        value: Number(raw) * factor + offset,
        sourceEvent: null,
        provenance: {
          deviceId: sample.deviceId,
          sourceKey: b.sourceKey,
          rawValue: raw,
          rawUnit,
          conversion:
            factor === 1 && offset === 0
              ? null
              : { rule: "linear", factor, offset },
          aggregation: null,
          timestampOrigin: p.timestampOrigin,
          retained: p.retained,
        },
      }),
    );
  }
  for (const alarm of p.sourceEvents)
    events.push(
      eventSchema.parse({
        ...common,
        eventId: eventId(
          "alarm:" + alarm.componentId + ":" + alarm.id + ":" + alarm.state,
        ),
        componentId: alarm.componentId,
        target: target(alarm.componentId),
        kind: "source_alarm",
        metric: null,
        value: null,
        provenance: null,
        sourceEvent: {
          id: alarm.id,
          origin: "source",
          code: alarm.code,
          state: alarm.state,
        },
      }),
    );
  // An explicit connection transition remains visible even when no values exist.
  if (!events.length && p.sourceConnection !== "unknown") {
    const c = registration.components[0].componentId;
    events.push(
      eventSchema.parse({
        ...common,
        eventId: eventId("connection"),
        componentId: c,
        target: target(c),
        kind: "source_connection",
        metric: null,
        value: null,
        provenance: null,
        sourceEvent: null,
      }),
    );
  }
  return events;
}
export function freshness(e: IntegrationEvent, now = Date.now()) {
  if (e.sourceConnection === "offline") return "disconnected";
  if (e.mode === "replay") return "historical";
  if (e.sourceQuality !== "good" || !e.metric || e.clockSkew === "future")
    return "unknown";
  return now - Date.parse(e.observedAt) > e.metric.expectedIntervalMs * 3
    ? "stale"
    : "fresh";
}
