import type { MeasurementEvidence } from "./measurements";

export type SourceCondition = "unknown" | "active" | "cleared";
export type ThresholdConfiguration = {
  id: number;
  deviceId: number;
  metric: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  warningMin: number | null;
  warningMax: number | null;
  enabled: boolean;
};
export type AlarmConditionEvidence = {
  readingId: number;
  occurredAt: number;
  receivedAt: string;
  sourceDeviceId: string;
  gatewayId: string | null;
  mode: "live";
  metric: string;
  value: number;
  unit: string;
  measurement: MeasurementEvidence;
  thresholdConfiguration: ThresholdConfiguration;
  commissioningRevision: number;
  acquisitionMode: "cyclic" | "on_change";
};

/** Compare the actual reviewed rule, not its mutable display label or a single limit. */
export function thresholdSignature(value: ThresholdConfiguration): string {
  return JSON.stringify([
    value.id,
    value.deviceId,
    value.metric,
    value.unit,
    value.minValue,
    value.maxValue,
    value.warningMin,
    value.warningMax,
    value.enabled,
  ]);
}

export function hasConfiguredLimits(value: ThresholdConfiguration): boolean {
  return (
    value.enabled &&
    !!value.unit &&
    [value.minValue, value.maxValue, value.warningMin, value.warningMax].some(
      (limit) => typeof limit === "number" && Number.isFinite(limit),
    )
  );
}

type ConditionRecord = {
  sourceCondition?: SourceCondition;
  conditionObservedAt?: Date | string | null;
  conditionValidUntil?: Date | string | null;
  conditionInvalidReason?: string | null;
  conditionEvidence?: AlarmConditionEvidence | null;
  acknowledgedAt?: Date | string | null;
  status?: string;
  lastObservedAt?: Date | string | null;
};

export function alarmConditionReasonLabel(reason: string | null | undefined) {
  const labels: Record<string, string> = {
    not_verified: "No verified source condition is recorded.",
    configuration_changed:
      "Threshold configuration changed; verification is required.",
    commissioning_changed:
      "Source commissioning changed; verification is required.",
    observation_time_unverified: "The source observation time is not verified.",
    sample_expired: "The verified observation has exceeded its maximum age.",
    source_connection_offline: "The source or its gateway reported offline.",
    source_connection_interrupted:
      "The connection was interrupted; a newer measurement is required.",
    source_connection: "The source has not confirmed an online connection.",
    source_quality: "The latest source quality is not good.",
    sensor_read_error: "The latest source read failed.",
    measurement_unverified:
      "The latest measurement quality or unit is not verified.",
    newer_evidence_unverified:
      "Newer event evidence has not verified the source condition.",
  };
  return reason
    ? (labels[reason] ?? "The source condition needs verification.")
    : null;
}

/** A recorded clearance is historical evidence. Its current source can still be unknown. */
export function projectAlarmCondition(
  record: ConditionRecord,
  currentThreshold: ThresholdConfiguration | undefined,
  commissioningRevision: number | undefined,
  now = Date.now(),
) {
  const sourceCondition = record.sourceCondition ?? "unknown";
  const evidence = record.conditionEvidence;
  const validUntil = record.conditionValidUntil
    ? new Date(record.conditionValidUntil).getTime()
    : NaN;
  const observedAt = record.conditionObservedAt
    ? new Date(record.conditionObservedAt).getTime()
    : NaN;
  const latestAt = record.lastObservedAt
    ? new Date(record.lastObservedAt).getTime()
    : NaN;
  const conditionReason =
    sourceCondition === "unknown" || !evidence
      ? "not_verified"
      : !currentThreshold ||
          !hasConfiguredLimits(currentThreshold) ||
          thresholdSignature(currentThreshold) !==
            thresholdSignature(evidence.thresholdConfiguration)
        ? "configuration_changed"
        : commissioningRevision !== evidence.commissioningRevision
          ? "commissioning_changed"
          : record.conditionInvalidReason
            ? record.conditionInvalidReason
            : !Number.isFinite(observedAt) || observedAt > now
              ? "observation_time_unverified"
              : Number.isFinite(latestAt) && latestAt > observedAt
                ? "newer_evidence_unverified"
                : !Number.isFinite(validUntil) || validUntil < now
                  ? "sample_expired"
                  : null;
  const acknowledged =
    !!record.acknowledgedAt || record.status === "acknowledged";
  return {
    sourceCondition,
    currentCondition: conditionReason ? ("unknown" as const) : sourceCondition,
    conditionReason,
    acknowledged,
    alarmState:
      `${sourceCondition}_${acknowledged ? "acknowledged" : "unacknowledged"}` as `${SourceCondition}_${"acknowledged" | "unacknowledged"}`,
  };
}
