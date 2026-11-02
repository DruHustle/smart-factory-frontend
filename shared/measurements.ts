/** Engineering conversions version 1. Unknown legacy units are never inferred. */
export const canonicalUnits = {
  temperature: "°C",
  humidity: "%",
  vibration: "mm/s",
  power: "W",
  pressure: "Pa",
  rpm: "rpm",
} as const;
export type Metric = keyof typeof canonicalUnits;
export const metrics = Object.keys(canonicalUnits) as Metric[];
export const sourceUnits: Record<Metric, readonly string[]> = {
  temperature: ["°C", "C", "Cel", "°F", "F", "K"],
  humidity: ["%", "fraction"],
  vibration: ["mm/s", "m/s"],
  power: ["W", "kW", "MW"],
  pressure: ["Pa", "kPa", "MPa", "bar"],
  rpm: ["rpm", "r/min", "1/min", "Hz"],
};
export function convertMeasurement(
  metric: Metric,
  value: number,
  unit: string,
): number {
  if (!Number.isFinite(value) || !sourceUnits[metric].includes(unit))
    throw new Error("unsupported_unit");
  const converted =
    metric === "temperature"
      ? unit === "F" || unit === "°F"
        ? ((value - 32) * 5) / 9
        : unit === "K"
          ? value - 273.15
          : value
      : metric === "humidity" && unit === "fraction"
        ? value * 100
        : metric === "vibration" && unit === "m/s"
          ? value * 1000
          : metric === "power"
            ? value * (unit === "kW" ? 1000 : unit === "MW" ? 1e6 : 1)
            : metric === "pressure"
              ? value *
                (unit === "kPa"
                  ? 1000
                  : unit === "MPa"
                    ? 1e6
                    : unit === "bar"
                      ? 1e5
                      : 1)
              : metric === "rpm" && unit === "Hz"
                ? value * 60
                : value;
  if (
    !Number.isFinite(converted) ||
    Math.abs(converted) > 1e9 ||
    (metric === "humidity" && (converted < 0 || converted > 100))
  )
    throw new Error("converted_value_out_of_range");
  return converted;
}
export type MappingEvidence = {
  rawValue: number;
  rawUnit: "register" | "native";
  scale: number;
  offset: number;
  version: "sf-mapping-v1";
};
export type MeasurementEvidence = {
  mapping?: MappingEvidence;
  reviewedMapping?: { connectionId: number; aasVersion: number };
  sourceValue: number;
  sourceUnit: string | null;
  canonicalValue: number | null;
  canonicalUnit: string | null;
  conversionVersion: "sf-units-v1" | null;
  quality: "good" | "bad" | "uncertain" | "unknown";
};
export type Measurements = Partial<Record<Metric, MeasurementEvidence>>;
export function measurementUnit(
  reading: { measurements?: unknown },
  metric: Metric,
): string | null {
  const evidence = (reading.measurements as Measurements | null)?.[metric];
  return evidence?.canonicalUnit ?? null;
}

/** Prefer the preserved double-precision conversion over legacy REAL columns. */
export function measurementValue(
  reading: { measurements?: unknown } & Partial<Record<Metric, number | null>>,
  metric: Metric,
): number | null {
  const evidence = (reading.measurements as Measurements | null)?.[metric];
  if (evidence?.quality === "bad") return null;
  return evidence?.canonicalValue ?? reading[metric] ?? null;
}
export function convertCanonicalTo(
  metric: Metric,
  value: number,
  unit: string,
): number {
  const zero = convertMeasurement(metric, 0, unit),
    one = convertMeasurement(metric, 1, unit);
  return (value - zero) / (one - zero);
}

/** A bounded on-change hold never changes the actual sample timestamp. */
export type SourceContinuity = {
  offline: boolean;
  interruptedAt: number | null;
  commissioningRevision: number | null;
};
export type SampleValidityInput = {
  timestamp?: number | null;
  sampleAt?: number | null;
  mode?: string;
  evidence?: unknown;
  integration?: unknown;
  sourceContinuity?: SourceContinuity | null;
};
export function sampleValidity(reading: SampleValidityInput, now = Date.now()) {
  type Evidence = {
    eligible?: boolean;
    validForMs?: number | null;
    acquisitionMode?: "cyclic" | "on_change";
    commissioningRevision?: number;
    reason?: string | null;
  };
  const metadata = reading.integration as
    | { mode?: string; evidence?: Evidence }
    | undefined;
  const evidence = (reading.evidence ?? metadata?.evidence) as
    | Evidence
    | undefined;
  const at = reading.timestamp ?? reading.sampleAt;
  const mode = reading.mode ?? metadata?.mode;
  const acquisitionMode = evidence?.acquisitionMode ?? "cyclic";
  const ageMs = typeof at === "number" && Number.isFinite(at) ? now - at : null;
  const validForMs = evidence?.validForMs;
  const continuity = reading.sourceContinuity;
  const sourceReason = continuity?.offline
    ? "source_connection_offline"
    : continuity?.interruptedAt != null &&
        typeof at === "number" &&
        continuity.interruptedAt >= at
      ? "source_connection_interrupted"
      : continuity?.commissioningRevision != null &&
          evidence?.commissioningRevision !== continuity.commissioningRevision
        ? "commissioning_changed"
        : null;
  const verified =
    mode === "live" &&
    evidence?.eligible === true &&
    ageMs !== null &&
    ageMs >= 0 &&
    typeof validForMs === "number" &&
    Number.isFinite(validForMs) &&
    validForMs > 0 &&
    validForMs <= 86400000 &&
    sourceReason === null;
  const state = !verified
    ? ("unverified" as const)
    : ageMs > validForMs
      ? ("stale" as const)
      : acquisitionMode === "on_change"
        ? ("held" as const)
        : ("current" as const);
  return {
    state,
    acquisitionMode,
    sampleAt: typeof at === "number" ? at : null,
    ageMs,
    validForMs: typeof validForMs === "number" ? validForMs : null,
    reason: !verified
      ? (sourceReason ?? evidence?.reason ?? "measurement_not_verified")
      : state === "stale"
        ? "maximum_value_age_exceeded"
        : null,
  };
}

/** Communication keepalives do not renew a measurement's bounded validity. */
export function currentSample(
  reading: SampleValidityInput,
  now = Date.now(),
): boolean {
  const state = sampleValidity(reading, now).state;
  return state === "current" || state === "held";
}
