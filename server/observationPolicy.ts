import { z } from "zod";
import {
  canonicalUnits,
  convertMeasurement,
  metrics,
  sourceUnits,
  type Metric,
  type Measurements,
} from "../shared/measurements";
export const wireIdentifier = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/,
    "Use 1–64 letters, numbers, dots, colons, underscores or hyphens; start with a letter or number.",
  );
export const unitInput = z
  .object(
    Object.fromEntries(
      metrics.map((metric) => [
        metric,
        z.enum(sourceUnits[metric] as [string, ...string[]]).optional(),
      ]),
    ) as Record<Metric, z.ZodOptional<z.ZodEnum<any>>>,
  )
  .strict();
const mappingEvidence = z
  .object({
    rawValue: z
      .number()
      .finite()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    rawUnit: z.enum(["register", "native"]),
    scale: z.number().finite().min(-1e9).max(1e9),
    offset: z.number().finite().min(-1e9).max(1e9),
    version: z.literal("sf-mapping-v1"),
  })
  .strict();
export const mappingEvidenceInput = z
  .object({
    temperature: mappingEvidence.optional(),
    humidity: mappingEvidence.optional(),
    vibration: mappingEvidence.optional(),
    power: mappingEvidence.optional(),
    pressure: mappingEvidence.optional(),
    rpm: mappingEvidence.optional(),
  })
  .strict();
export const commissioningInput = z
  .object({
    route: z.enum(["direct", "gateway", "unconfigured"]),
    gatewayId: wireIdentifier.optional(),
    freshnessSeconds: z.number().int().min(5).max(86400).optional(),
    maxLatenessSeconds: z.number().int().min(5).max(3600).default(120),
    clockSkewSeconds: z.number().int().min(0).max(60).default(30),
    legacyCurrent: z.boolean().default(false),
    legacyUnits: unitInput.default({}),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.route === "gateway" && !v.gatewayId)
      c.addIssue({
        code: "custom",
        path: ["gatewayId"],
        message: "A parent gateway is required.",
      });
  });
export type Commissioning = z.infer<typeof commissioningInput> & {
  revision: number;
  reviewedAt: string;
  reviewedBy: number;
};
export class TelemetryPolicyError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function normalizeMeasurements(
  input: Partial<Record<Metric, number | null | undefined>> & {
    mapping?: Partial<
      Record<Metric, import("../shared/measurements").MappingEvidence>
    >;
    units?: Partial<Record<Metric, string>>;
    sensorStatus?: string;
    integration?: unknown;
  },
  policy?: Commissioning,
) {
  const provenance = input.integration as
    | { sourceQuality?: "good" | "bad" | "uncertain" | "unknown" }
    | undefined;
  const values: Partial<Record<Metric, number | null>> = {},
    measurements: Measurements = {};
  for (const metric of metrics) {
    const value = input[metric];
    if (value == null) {
      values[metric] = null;
      continue;
    }
    const mapping = input.mapping?.[metric];
    if (
      mapping &&
      Math.abs(mapping.rawValue * mapping.scale + mapping.offset - value) >
        Math.max(1e-6, Math.abs(value) * 1e-9)
    )
      throw new TelemetryPolicyError("mapping_arithmetic_mismatch");
    const unit =
      input.units?.[metric] ??
      (policy?.legacyCurrent ? policy.legacyUnits?.[metric] : undefined);
    let canonicalValue: number | null = null;
    try {
      if (unit) canonicalValue = convertMeasurement(metric, value, unit);
    } catch {
      throw new TelemetryPolicyError("unsupported_or_incompatible_unit");
    }
    const quality =
      input.sensorStatus === "read_error"
        ? "bad"
        : (provenance?.sourceQuality ?? "unknown");
    measurements[metric] = {
      ...(mapping ? { mapping } : {}),
      sourceValue: value,
      sourceUnit: unit ?? null,
      canonicalValue,
      canonicalUnit: unit ? canonicalUnits[metric] : null,
      conversionVersion: unit ? "sf-units-v1" : null,
      quality,
    };
    values[metric] = quality === "bad" ? null : (canonicalValue ?? value);
  }
  return { values, measurements };
}
export function currentObservation(
  input: {
    timestamp: number;
    integration?: unknown;
    sensorStatus?: string;
    transportRetained?: boolean;
    transportRetainVerified?: boolean;
  },
  policy: Commissioning | undefined,
  lastAt: number | null,
  now = Date.now(),
) {
  const p = input.integration as
    | {
        mode?: string;
        sourceQuality?: string;
        sourceConnection?: string;
        retained?: boolean;
        gatewayReceivedAt?: string;
      }
    | undefined;
  const reason =
    !policy || policy.route === "unconfigured"
      ? "not_commissioned"
      : p?.mode && p.mode !== "live"
        ? "non_operational_mode"
        : !p && !policy.legacyCurrent
          ? "unclassified_source"
          : p && p.sourceQuality !== "good"
            ? "source_quality"
            : p && p.sourceConnection !== "online"
              ? "source_connection"
              : input.sensorStatus === "read_error"
                ? "sensor_read_error"
                : input.transportRetainVerified === false
                  ? "transport_flags_unverified"
                  : p?.retained || input.transportRetained
                    ? "retained_delivery"
                    : p?.gatewayReceivedAt &&
                        Date.parse(p.gatewayReceivedAt) >
                          now + policy.clockSkewSeconds * 1000
                      ? "gateway_clock_skew"
                      : input.timestamp > now + policy.clockSkewSeconds * 1000
                        ? "clock_skew"
                        : now - input.timestamp >
                            policy.maxLatenessSeconds * 1000
                          ? "late_history"
                          : lastAt != null && input.timestamp <= lastAt
                            ? "out_of_order"
                            : null;
  return {
    eligible: reason === null,
    reason,
    policyVersion: "current-observation-v1",
    validForMs: policy?.freshnessSeconds
      ? policy.freshnessSeconds * 1000
      : null,
    legacyReviewed: !p && !!policy?.legacyCurrent,
  };
}
