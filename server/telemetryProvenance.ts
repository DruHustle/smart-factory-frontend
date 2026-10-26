/** Smart Factory ingress policy 1. App-owned, independent of optional export. */
import { z } from "zod";
export const PROVENANCE_MAX_BYTES = 8192;
const identifier = z.string().regex(/^[A-Za-z0-9:_.-]{1,128}$/);
const utcPattern =
  /^(?!0000)([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|\+00:00)$/;
function utc(value: string) {
  const m = utcPattern.exec(value);
  if (!m) return null;
  const parts = m.slice(1, 7).map(Number),
    millis = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
  const d = new Date(0);
  d.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  d.setUTCHours(parts[3], parts[4], parts[5], millis);
  if (
    [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ].some((n, i) => n !== parts[i])
  )
    return null;
  return d.toISOString();
}
const receiptTime = z
  .string()
  .max(35)
  .regex(utcPattern)
  .transform((value, ctx) => {
    const result = utc(value);
    if (!result) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid UTC receipt calendar time",
      });
      return z.NEVER;
    }
    return result;
  });
export const provenanceSchema = z
  .object({
    mode: z.enum(["live", "simulated", "replay"]),
    scenarioRunId: identifier.optional(),
    replayRunId: identifier.optional(),
    sessionId: identifier.optional(),
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
    gatewayReceivedAt: receiptTime,
    sourceEvents: z
      .array(
        z
          .object({
            id: identifier,
            origin: z.literal("source"),
            code: identifier,
            state: z.enum(["active", "cleared"]),
            componentId: z.uuid().transform((s) => s.toLowerCase()),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.mode === "simulated" && !p.scenarioRunId)
      ctx.addIssue({
        code: "custom",
        path: ["scenarioRunId"],
        message: "Simulated input requires scenarioRunId",
      });
    if (p.mode === "replay" && !p.replayRunId)
      ctx.addIssue({
        code: "custom",
        path: ["replayRunId"],
        message: "Replay input requires replayRunId",
      });
    if (p.mode !== "replay" && p.replayRunId)
      ctx.addIssue({
        code: "custom",
        path: ["replayRunId"],
        message: "Replay identity requires replay mode",
      });
    if (Buffer.byteLength(JSON.stringify(p), "utf8") > PROVENANCE_MAX_BYTES)
      ctx.addIssue({
        code: "custom",
        message: "Canonical provenance exceeds 8192 bytes",
      });
  });
