import { eq, inArray, sql } from "drizzle-orm";
import {
  alerts,
  alertThresholds,
  devices,
  type Alert,
  type Device,
} from "../drizzle/schema";
import { getAlertErrorCode } from "../shared/alert-codes";
import { evaluateAlertThreshold } from "../shared/alert-thresholds";
import {
  hasConfiguredLimits,
  projectAlarmCondition,
  thresholdSignature,
  type AlarmConditionEvidence,
  type ThresholdConfiguration,
} from "../shared/alarm-condition";
import { metrics, type Metric } from "../shared/measurements";
import type { ApplicationDatabase } from "./database-scope";
import { sourceContinuity } from "./sourceContinuity";
import type { TelemetryInput } from "./ingestion";
import {
  currentObservation,
  type Commissioning,
  type normalizeMeasurements,
} from "./observationPolicy";

/** Bounded queries for the entire result page, never one query per incident. */
export async function annotateAlarmConditions<T extends Alert>(
  db: ApplicationDatabase,
  rows: T[],
) {
  if (!rows.length)
    return [] as (T & ReturnType<typeof projectAlarmCondition>)[];
  const sourceIds = [...new Set(rows.map((row) => row.deviceId))];
  const [thresholds, sources, continuity] = await Promise.all([
    db
      .select()
      .from(alertThresholds)
      .where(inArray(alertThresholds.deviceId, sourceIds)),
    db
      .select({
        id: devices.id,
        metadata: devices.metadata,
        status: devices.status,
      })
      .from(devices)
      .where(inArray(devices.id, sourceIds)),
    sourceContinuity(db, sourceIds),
  ]);
  const byThreshold = new Map(
    thresholds.map((threshold) => [threshold.id, threshold]),
  );
  const bySource = new Map(sources.map((source) => [source.id, source]));
  const now = Date.now();
  return rows.map((row) => {
    const source = bySource.get(row.deviceId);
    const policy = source?.metadata?.commissioning as Commissioning | undefined;
    const projection = projectAlarmCondition(
      row,
      byThreshold.get(row.conditionEvidence?.thresholdConfiguration.id ?? -1),
      policy?.revision,
      now,
    );
    // An explicit trusted offline report invalidates current visibility. Absence
    // of an on-change value event alone does not manufacture an offline report.
    const connection = continuity.get(row.deviceId);
    const sourceReason = connection?.offline
      ? "source_connection_offline"
      : connection?.interruptedAt != null &&
          connection.interruptedAt >= (row.conditionEvidence?.occurredAt ?? 0)
        ? "source_connection_interrupted"
        : null;
    return {
      ...row,
      ...projection,
      ...(sourceReason && !projection.conditionReason
        ? {
            currentCondition: "unknown" as const,
            conditionReason: sourceReason,
          }
        : {}),
    };
  });
}

function configuration(
  threshold: ThresholdConfiguration,
): ThresholdConfiguration {
  return {
    id: threshold.id,
    deviceId: threshold.deviceId,
    metric: threshold.metric,
    unit: threshold.unit,
    minValue: threshold.minValue,
    maxValue: threshold.maxValue,
    warningMin: threshold.warningMin,
    warningMax: threshold.warningMax,
    enabled: threshold.enabled,
  };
}

/** Called under ingestion's per-device advisory lock and transaction. */
export async function observeAlarmConditions(
  tx: ApplicationDatabase,
  data: {
    device: Device;
    input: TelemetryInput;
    assetId: string | null;
    readingId: number;
    receivedAt: Date;
    policy: Commissioning | undefined;
    normalized: ReturnType<typeof normalizeMeasurements>;
    eligibility: ReturnType<typeof currentObservation>;
    lastMeasurementAt: number | null;
  },
) {
  const {
    device,
    input,
    assetId,
    readingId,
    receivedAt,
    policy,
    normalized,
    eligibility,
  } = data;
  if (device.isDemo) return;
  const thresholds = await tx
    .select()
    .from(alertThresholds)
    .where(eq(alertThresholds.deviceId, device.id));
  const rules = thresholds.filter(hasConfiguredLimits).map(configuration);
  if (!rules.length) return;
  const candidates = await tx
    .select()
    .from(alerts)
    .where(
      // One indexed latest event per configured rule keeps flapping history out
      // of the acquisition path. A new rule can never clear an old rule's event.
      sql`${alerts.id} in (
        select matched.id from jsonb_array_elements(${JSON.stringify(rules)}::jsonb) configured_rule
        cross join lateral (
          select recorded.id from alerts recorded
          where recorded."deviceId"=${device.id}
            and ${assetId ? sql`recorded."assetId"=${assetId}` : sql`recorded."assetId" is null`}
            and recorded.type='threshold_exceeded'
            and recorded.source_condition in ('active','cleared')
            and recorded.metric=configured_rule->>'metric'
            and recorded.condition_evidence->'thresholdConfiguration'=configured_rule
          order by recorded.id desc limit 1
        ) matched
      )`,
    );
  const provenance = input.integration as
    | { sourceQuality?: string; sourceConnection?: string }
    | undefined;
  // Bad source quality may invalidate a prior claim only when the delivery itself
  // is current, correctly routed and trusted. A delayed replay cannot erase evidence.
  const transportEligibility = currentObservation(
    {
      ...input,
      sensorStatus: undefined,
      integration: provenance
        ? { ...provenance, sourceQuality: "good", sourceConnection: "online" }
        : undefined,
    },
    policy,
    data.lastMeasurementAt,
    receivedAt.getTime(),
  );
  const entireSourceUncertain =
    input.sensorStatus === "read_error" ||
    (provenance &&
      (provenance.sourceQuality !== "good" ||
        provenance.sourceConnection !== "online"));
  if (transportEligibility.eligible) {
    for (const alarm of candidates) {
      if (input.timestamp <= (alarm.conditionObservedAt?.getTime() ?? 0))
        continue;
      const metric = alarm.metric as Metric;
      const measurement = normalized.measurements[metric];
      const supplied = metrics.includes(metric) && input[metric] != null;
      const reason = entireSourceUncertain
        ? (eligibility.reason ?? "source_unverified")
        : supplied &&
            (measurement?.quality !== "good" || !measurement.canonicalUnit)
          ? "measurement_unverified"
          : null;
      if (!reason) continue;
      await tx
        .update(alerts)
        .set({
          conditionInvalidReason: reason,
          conditionObservedAt: new Date(input.timestamp),
          conditionValidUntil: null,
          updatedAt: receivedAt,
        })
        .where(eq(alerts.id, alarm.id));
      if (reason !== alarm.conditionInvalidReason)
        await tx.execute(sql`insert into incident_activity(alert_id,kind,detail)
          values(${alarm.id},'source_unverified',${JSON.stringify({ reason, readingId, occurredAt: input.timestamp })}::jsonb)`);
    }
  }
  if (!eligibility.eligible || !policy) return;
  for (const threshold of thresholds) {
    const metric = threshold.metric as Metric;
    const measurement = normalized.measurements[metric];
    const value = normalized.values[metric];
    if (
      !hasConfiguredLimits(threshold) ||
      value == null ||
      !Number.isFinite(value) ||
      !measurement ||
      threshold.unit !== measurement.canonicalUnit ||
      measurement.quality !== "good"
    )
      continue;
    const rule = configuration(threshold);
    const previous = candidates.find(
      (candidate) =>
        candidate.metric === metric &&
        candidate.conditionEvidence &&
        thresholdSignature(
          candidate.conditionEvidence.thresholdConfiguration,
        ) === thresholdSignature(rule),
    );
    if (
      previous &&
      input.timestamp <= (previous.conditionObservedAt?.getTime() ?? 0)
    )
      continue;
    const active =
      previous?.sourceCondition === "active" ? previous : undefined;
    const breach = evaluateAlertThreshold(value, threshold);
    const conditionEvidence: AlarmConditionEvidence = {
      readingId,
      occurredAt: input.timestamp,
      receivedAt: receivedAt.toISOString(),
      sourceDeviceId: device.deviceId,
      gatewayId: input.gatewayId ?? null,
      mode: "live",
      metric,
      value,
      unit: threshold.unit!,
      measurement,
      thresholdConfiguration: rule,
      commissioningRevision: policy.revision ?? 0,
      acquisitionMode: policy.acquisitionMode ?? "cyclic",
    };
    const conditionFields = {
      conditionEvidence,
      conditionObservedAt: new Date(input.timestamp),
      conditionValidUntil:
        eligibility.validForMs == null
          ? null
          : new Date(input.timestamp + eligibility.validForMs),
      conditionInvalidReason: null,
      updatedAt: receivedAt,
    };
    if (!breach) {
      if (!previous) continue;
      await tx
        .update(alerts)
        .set({ ...conditionFields, sourceCondition: "cleared" })
        .where(eq(alerts.id, previous.id));
      if (active)
        await tx.execute(sql`insert into incident_activity(alert_id,kind,detail)
          values(${active.id},'source_cleared',${JSON.stringify({ readingId, occurredAt: input.timestamp, value, unit: threshold.unit, thresholdId: threshold.id })}::jsonb)`);
      continue;
    }
    const message = `${metric} reported ${value} ${threshold.unit} ${breach.direction} configured ${breach.severity} threshold ${breach.threshold}`;
    const errorCode = getAlertErrorCode({
      type: "threshold_exceeded",
      metric,
      severity: breach.severity,
    });
    const evidence = {
      readingId,
      occurredAt: input.timestamp,
      receivedAt: receivedAt.toISOString(),
      sourceDeviceId: device.deviceId,
      gatewayId: input.gatewayId ?? null,
      mode: String(
        (input.integration as { mode?: string } | undefined)?.mode ?? "unknown",
      ),
      quality: measurement.quality,
      metric,
      value,
      threshold: breach.threshold,
      unit: threshold.unit!,
      measurement,
    };
    if (active) {
      await tx
        .update(alerts)
        .set({
          ...conditionFields,
          sourceCondition: "active",
          severity:
            active.severity === "critical" ? "critical" : breach.severity,
          value,
          threshold: breach.threshold,
          message,
          errorCode,
          latestEvidenceSnapshot: evidence,
          lastObservedAt: new Date(input.timestamp),
          occurrences: sql`${alerts.occurrences}+1`,
        })
        .where(eq(alerts.id, active.id));
    } else {
      const [created] = await tx
        .insert(alerts)
        .values({
          ...conditionFields,
          deviceId: device.id,
          assetId,
          type: "threshold_exceeded",
          sourceCondition: "active",
          severity: breach.severity,
          metric,
          value,
          threshold: breach.threshold,
          message,
          errorCode,
          evidenceSnapshot: evidence,
          latestEvidenceSnapshot: evidence,
          lastObservedAt: new Date(input.timestamp),
          createdAt: new Date(input.timestamp),
        })
        .returning({ id: alerts.id });
      await tx.execute(sql`insert into incident_activity(alert_id,kind,detail)
        values(${created.id},'source_active',${JSON.stringify({ readingId, occurredAt: input.timestamp, value, unit: threshold.unit, thresholdId: threshold.id })}::jsonb)`);
    }
  }
}
