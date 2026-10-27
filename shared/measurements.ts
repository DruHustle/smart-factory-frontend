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

/** A recent gateway heartbeat does not make an older measurement current. */
export function currentSample(
  reading: {
    timestamp?: number | null;
    sampleAt?: number | null;
    mode?: string;
    evidence?: unknown;
    integration?: unknown;
  },
  now = Date.now(),
): boolean {
  const metadata = reading.integration as
      | {
          mode?: string;
          evidence?: { eligible?: boolean; validForMs?: number | null };
        }
      | undefined,
    evidence = (reading.evidence ?? metadata?.evidence) as
      | { eligible?: boolean; validForMs?: number | null }
      | undefined,
    at = reading.timestamp ?? reading.sampleAt,
    mode = reading.mode ?? metadata?.mode;
  return (
    mode === "live" &&
    evidence?.eligible === true &&
    typeof at === "number" &&
    typeof evidence.validForMs === "number" &&
    evidence.validForMs > 0 &&
    at <= now &&
    now - at <= evidence.validForMs
  );
}
