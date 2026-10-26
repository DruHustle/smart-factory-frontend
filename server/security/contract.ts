/** Smart Factory-owned ot-security-evidence/v1. No peer schema or runtime. */
import { z } from "zod";
import { createHash } from "node:crypto";
export const MAX_BODY = 1_048_576,
  MAX_EVENT = 8192;
export const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:@/-]+$/)
  .refine(
    (s) => !s.includes("://") && !s.includes("@"),
    "Use a symbolic reference without addresses or credentials",
  );
export const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export function sanitize(s: string) {
  return s
    .replace(
      /\b(?:bearer\s+\S+|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)/gi,
      "[redacted]",
    )
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[account]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[endpoint]")
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .trim();
}
export const utc = z
  .string()
  .max(35)
  .regex(
    /^(?!0000)(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/,
  )
  .transform((s, ctx) => {
    const m =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(s)!;
    const p = m.slice(1, 7).map(Number),
      d = new Date(0);
    d.setUTCFullYear(p[0], p[1] - 1, p[2]);
    d.setUTCHours(
      p[3],
      p[4],
      p[5],
      Number((m[7] ?? "").padEnd(3, "0").slice(0, 3)),
    );
    if (
      [
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
      ].some((n, i) => n !== p[i])
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid UTC calendar date" });
      return z.NEVER;
    }
    return d.toISOString();
  });
const hash = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/)
  .transform((s) => s.toLowerCase());
const auth = z
  .object({
    service: identifier,
    outcome: z.literal("denied"),
    reasonCode: identifier,
    principalRef: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const config = z
  .object({
    configRevision: identifier,
    baselineRevision: identifier.optional(),
    changedKeys: z.array(identifier).min(1).max(32),
  })
  .strict();
export const wireProfiles = {
  "auth.authentication_failed": auth,
  "auth.authorization_denied": auth,
  "tls.certificate_observed": z
    .object({
      endpointRef: identifier,
      notBefore: utc,
      notAfter: utc,
      fingerprintSha256: hash,
    })
    .strict()
    .refine(
      (v) => v.notAfter > v.notBefore,
      "Certificate dates must be ordered",
    ),
  "config.changed": config,
  "config.drift_observed": config,
  "identity.unrecognized": z
    .object({ inputRef: identifier, observedIdentityRef: identifier })
    .strict(),
  "collector.health": z
    .object({
      state: z.enum(["online", "offline", "degraded", "paused"]),
      expectedIntervalSeconds: z.number().int().min(1).max(86400).optional(),
    })
    .strict(),
  "software.inventory_observed": z
    .object({ inventoryRef: identifier, sha256: hash })
    .strict(),
  "integrity.change_observed": z
    .object({
      previousSha256: hash,
      currentSha256: hash,
      evidenceBasis: z.enum([
        "self_reported",
        "collector_observed",
        "verified_artifact",
      ]),
    })
    .strict(),
};
export const profiles = {
  ...wireProfiles,
  "transport.connection_observed": z
    .object({
      connectionRef: identifier,
      protocol: z.enum(["mqtt", "http"]),
      tlsActive: z.boolean(),
      evidenceBasis: z.enum(["runtime_socket", "declared_config"]),
    })
    .strict(),
  "input.rejected": z
    .object({ inputRef: identifier, reasonCode: identifier })
    .strict(),
};
export const ownedEventTypes = Object.keys(profiles) as [
  keyof typeof profiles,
  ...(keyof typeof profiles)[],
];
export const eventTypes = Object.keys(wireProfiles) as [
  keyof typeof profiles,
  ...(keyof typeof profiles)[],
];
export const baseEnvelope = z
  .object({
    schemaVersion: z.literal("ot-security-evidence/v1"),
    producerNamespace: text(64),
    sourceEventId: identifier,
    occurredAt: utc,
    mode: z.enum(["live", "simulated", "replay"]),
    eventType: z.enum(eventTypes),
    assetRef: z
      .object({
        namespace: identifier,
        assetId: identifier,
        componentId: identifier.nullable(),
      })
      .strict()
      .nullable(),
    summary: text(512).transform(sanitize),
    quality: z.enum(["good", "uncertain", "bad", "unknown"]),
    producerVersion: text(64),
    attributes: z.unknown(),
    scenarioRunId: identifier.optional(),
    replayRunId: identifier.optional(),
    producerReceivedAt: utc.optional(),
    sessionId: identifier.optional(),
    sequence: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    correlationId: identifier.optional(),
  })
  .strict();
function validateEvent(
  e: {
    mode: string;
    scenarioRunId?: string;
    replayRunId?: string;
    eventType: keyof typeof profiles;
    attributes: unknown;
  },
  ctx: z.RefinementCtx,
) {
  if (e.mode === "simulated" && !e.scenarioRunId)
    ctx.addIssue({
      code: "custom",
      path: ["scenarioRunId"],
      message: "Simulated evidence requires scenarioRunId",
    });
  if (e.mode === "replay" && !e.replayRunId)
    ctx.addIssue({
      code: "custom",
      path: ["replayRunId"],
      message: "Replay evidence requires replayRunId",
    });
  if (e.mode !== "replay" && e.replayRunId)
    ctx.addIssue({
      code: "custom",
      path: ["replayRunId"],
      message: "Replay identity requires replay mode",
    });
  const p = profiles[e.eventType].safeParse(e.attributes);
  if (!p.success)
    for (const issue of p.error.issues.slice(0, 8))
      ctx.addIssue({
        code: "custom",
        path: ["attributes", ...issue.path],
        message: "Unsupported attributes",
      });
}
export const envelope = baseEnvelope
  .superRefine(validateEvent)
  .transform((e) => ({
    ...e,
    attributes: profiles[e.eventType].parse(e.attributes) as Record<
      string,
      unknown
    >,
  }));
export const localEnvelope = baseEnvelope
  .omit({ schemaVersion: true, eventType: true, attributes: true })
  .extend({
    schemaVersion: z.literal("smart-factory-ot-observation/v1"),
    eventType: z.enum(["transport.connection_observed", "input.rejected"]),
    attributes: z.unknown(),
  })
  .strict()
  .superRefine(validateEvent)
  .transform((e) => ({
    ...e,
    attributes: profiles[e.eventType].parse(e.attributes) as Record<
      string,
      unknown
    >,
  }));
export const ownedEnvelope = z.union([envelope, localEnvelope]);
export type Evidence = z.infer<typeof ownedEnvelope>;
export type RecordedEvidence =
  | Evidence
  | (Omit<Evidence, "schemaVersion" | "mode"> & {
      schemaVersion: "smart-factory-import/v1";
      mode: "unknown";
    });
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
export function parseBatch(
  raw: Buffer,
  ndjson = false,
  owned = false,
): Evidence[] {
  if (!Buffer.isBuffer(raw)) throw new SecurityError(422, "invalid_batch");
  if (raw.length > MAX_BODY) throw new SecurityError(413, "batch_too_large");
  let records: unknown[];
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    if (ndjson) {
      const lines = decoded.trim().split(/\r?\n/);
      if (
        lines.length > 100 ||
        lines.some((l) => Buffer.byteLength(l) > MAX_EVENT)
      )
        throw new SecurityError(413, "batch_limits");
      records = lines.map((l) => JSON.parse(l));
    } else
      records = z
        .object({ events: z.array(z.unknown()).min(1).max(100) })
        .strict()
        .parse(JSON.parse(decoded)).events;
  } catch (e) {
    if (e instanceof SecurityError) throw e;
    throw new SecurityError(422, "invalid_batch");
  }
  try {
    return records.map((record) => {
      if (Buffer.byteLength(JSON.stringify(record)) > MAX_EVENT)
        throw new SecurityError(413, "event_too_large");
      const parsed = (owned ? ownedEnvelope : envelope).safeParse(record);
      if (!parsed.success) throw new SecurityError(422, "invalid_event");
      if (Buffer.byteLength(canonical(parsed.data)) > MAX_EVENT)
        throw new SecurityError(413, "event_too_large");
      return parsed.data;
    });
  } catch (e) {
    if (e instanceof SecurityError) throw e;
    throw new SecurityError(422, "invalid_event");
  }
}
export class SecurityError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export const target = z
  .object({
    kind: z.enum(["application", "asset", "device"]),
    id: z.number().int().positive().nullable(),
  })
  .strict()
  .refine((t) => (t.kind === "application" ? t.id === null : t.id !== null));
export const sourceInput = z
  .object({
    name: text(100),
    namespace: text(64),
    targets: z.array(target).min(1).max(20),
    modes: z
      .array(z.enum(["live", "simulated", "replay"]))
      .min(1)
      .max(3),
    types: z.array(z.enum(ownedEventTypes)).min(1).max(12),
    expectedIntervalSeconds: z.number().int().min(0).max(86400),
    connections: z.array(identifier).max(20).default([]),
    inputs: z
      .array(
        z
          .object({
            inputRef: identifier,
            allowedIdentities: z.array(identifier).min(1).max(100),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
export const baselineInput = z
  .object({
    sourceId: z.uuid(),
    revision: identifier,
    configRevision: identifier.optional(),
    integritySha256: hash.optional(),
    expectedTls: z.boolean().optional(),
    relevantKeys: z.array(identifier).max(32),
    reason: text(1000),
  })
  .strict();
export const ruleInput = z
  .object({
    id: z.enum([
      "authentication-burst",
      "authorization-burst",
      "certificate-expiry",
      "configuration-drift",
      "unrecognized-identity",
      "collector-coverage",
      "integrity-change",
      "reported-vulnerability",
      "plaintext-transport",
    ]),
    windowSeconds: z.number().int().min(60).max(86400),
    threshold: z.number().int().min(1).max(100),
    enabled: z.boolean(),
    reason: text(1000),
  })
  .strict();
