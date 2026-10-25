import { z } from "zod";

import { provenanceSchema } from "./onesa/normalize";

export const edgeTelemetrySchema = z.object({
  integration: provenanceSchema.nullish().transform(value => value ?? undefined),
  deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/),
  gatewayId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/).optional(),
  assetId: z.string().min(1).max(128).refine((id) => !/[\u0000-\u001f\u007f]/.test(id)).nullable().optional(),
  ingestionId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  assetSignals: z.record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    // Arduino uptime/cycle counters are uint32 values. Keep support for signed
    // process signals while accepting the controller's complete counter range.
    z.number().finite().min(-1_000_000_000).max(4_294_967_295),
  ).nullish().transform((signals) => signals ?? undefined)
    .refine((signals) => !signals || Object.keys(signals).length <= 32, "At most 32 named asset signals are accepted"),
  // System.Text.Json includes nullable DTO properties as JSON null. Normalize
  // those wire values to absence so non-sensor asset telemetry is accepted.
  sensorType: z.string().trim().min(1).max(64).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).nullish().transform((value) => value ?? undefined),
  sensorStatus: z.enum(["ok", "read_error"]).nullish().transform((value) => value ?? undefined),
  timestamp: z.union([z.number().int().positive().max(8_640_000_000_000_000), z.string().datetime({ offset: true })]),
  temperature: z.number().finite().min(-1e9).max(1e9).nullable().optional(),
  // Relative humidity is a percentage; rejecting impossible values prevents a
  // malformed edge sample from polluting charts, thresholds, and reports.
  humidity: z.number().finite().min(0).max(100).nullable().optional(),
  vibration: z.number().finite().min(-1e9).max(1e9).nullable().optional(),
  power: z.number().finite().min(-1e9).max(1e9).nullable().optional(),
  pressure: z.number().finite().min(-1e9).max(1e9).nullable().optional(),
  rpm: z.number().finite().min(-1e9).max(1e9).nullable().optional(),
}).superRefine((sample, context) => {
  if (sample.sensorType !== "DHT11") return;
  if (!sample.sensorStatus) {
    context.addIssue({ code: "custom", path: ["sensorStatus"], message: "DHT11 samples require sensorStatus" });
    return;
  }
  const hasTemperature = sample.temperature != null;
  const hasHumidity = sample.humidity != null;
  if (sample.sensorStatus === "ok" && (!hasTemperature || !hasHumidity)) {
    context.addIssue({ code: "custom", path: ["sensorStatus"], message: "A healthy DHT11 sample requires temperature and humidity" });
  }
  if (sample.sensorStatus === "read_error" && (hasTemperature || hasHumidity)) {
    context.addIssue({ code: "custom", path: ["sensorStatus"], message: "A failed DHT11 read must not report temperature or humidity" });
  }
});
