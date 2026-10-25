import { createHash } from "node:crypto";
import { z } from "zod";
import {
  eventSchema,
  type Registration,
  type Mapping,
  type IntegrationEvent,
} from "./contract";
export const provenanceSchema = z
  .object({
    mode: z.enum(["live", "simulated", "replay"]),
    scenarioRunId: z.string().min(1).max(128).optional(),
    replayRunId: z.string().min(1).max(128).optional(),
    sessionId: z.string().min(1).max(128).optional(),
    sequence: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    sourceQuality: z
      .enum(["good", "bad", "uncertain", "unknown"])
      .default("unknown"),
    sourceConnection: z
      .enum(["online", "offline", "unknown"])
      .default("unknown"),
    timestampOrigin: z.enum(["device", "gateway"]).default("device"),
    retained: z.boolean().default(false),
    gatewayReceivedAt: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => value.endsWith("Z") || value.endsWith("+00:00"),
        "Gateway receipt must be UTC",
      )
      .transform((value) => new Date(value).toISOString()),
    sourceEvents: z
      .array(
        z
          .object({
            id: z.string().max(128),
            origin: z.literal("source"),
            code: z.string().max(128),
            state: z.enum(["active", "cleared"]),
            componentId: z.uuid(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
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
    const raw = b.sourceKey.startsWith("assetSignals.")
      ? sample.assetSignals?.[b.sourceKey.slice(13)]
      : sample[b.sourceKey];
    if (raw == null) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw))
      throw new Error("Nonfinite or unsupported value");
    let factor = 1;
    if (b.sourceUnit !== b.metric.unit)
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
        value: raw * factor,
        sourceEvent: null,
        provenance: {
          deviceId: sample.deviceId,
          sourceKey: b.sourceKey,
          rawValue: raw,
          rawUnit: b.sourceUnit,
          conversion:
            factor === 1 ? null : { rule: "linear", factor, offset: 0 },
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
        eventId: eventId("alarm:" + alarm.componentId + ":" + alarm.id + ":" + alarm.state),
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
