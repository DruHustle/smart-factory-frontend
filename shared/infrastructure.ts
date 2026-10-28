import { z } from "zod";

export const healthStates = [
  "healthy",
  "degraded",
  "unavailable",
  "stale",
  "unknown",
  "not_configured",
] as const;
export const healthState = z.enum(healthStates);
export type HealthState = z.infer<typeof healthState>;
const at = z.string().datetime();
export const serviceEvidence = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().max(100),
    state: healthState,
    dimension: z.enum([
      "liveness",
      "readiness",
      "reachability",
      "subscription",
      "heartbeat",
      "delivery",
      "coverage",
    ]),
    configured: z.boolean(),
    source: z.string().max(120),
    scope: z.string().max(140),
    observedAt: at.nullable(),
    collectedAt: at,
    lastSuccessAt: at.nullable(),
    freshForSeconds: z.number().int().positive(),
    reason: z.string().max(96),
    explanation: z.string().max(400),
    latencyMs: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export type ServiceEvidence = z.infer<typeof serviceEvidence>;
export const resourceEvidence = z
  .object({
    id: z.string().max(64),
    name: z.string().max(120),
    scope: z.string().max(120),
    unit: z.enum(["bytes", "ms", "CPU ms/s", "%", "connections"]),
    value: z.number().finite().nonnegative().nullable(),
    observedAt: at.nullable(),
    explanation: z.string().max(350),
  })
  .strict();
export type ResourceEvidence = z.infer<typeof resourceEvidence>;
export const queueEvidence = z
  .object({
    id: z.string().max(64),
    name: z.string().max(100),
    scope: z.string().max(120),
    state: healthState,
    pending: z.number().int().nonnegative().nullable(),
    quarantined: z.number().int().nonnegative().nullable(),
    failed: z.number().int().nonnegative().nullable(),
    oldestAcceptedAt: at.nullable(),
    oldestAgeSeconds: z.number().nonnegative().nullable(),
    observedAt: at.nullable(),
    collectedAt: at,
    explanation: z.string().max(400),
  })
  .strict();
export type QueueEvidence = z.infer<typeof queueEvidence>;
export const recoveryReceipt = z
  .object({
    kind: z.enum(["backup", "restore"]),
    receiptId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    observedAt: at,
    outcome: z.enum(["verified", "failed"]),
    source: z.enum(["operator-verifier", "disposable-restore-drill"]),
    scope: z.enum([
      "dashboard-database",
      "telemetry-database",
      "device-database",
      "application-databases",
    ]),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
  })
  .strict();
export type RecoveryReceipt = z.infer<typeof recoveryReceipt>;
export const healthSnapshot = z
  .object({
    version: z.literal(1),
    collectedAt: at,
    synthetic: z.boolean(),
    stale: z.boolean(),
    services: z.array(serviceEvidence).max(24),
    dependencies: z
      .array(
        z
          .object({
            from: z.string().max(64),
            to: z.string().max(64),
            label: z.string().max(120),
          })
          .strict(),
      )
      .max(32),
    resources: z.array(resourceEvidence).max(24),
    queues: z.array(queueEvidence).max(8),
    collectors: z
      .array(
        z
          .object({
            id: z.string().max(64),
            name: z.string().max(255),
            active: z.boolean(),
            state: healthState,
            observedAt: at.nullable(),
            collectedAt: at,
            freshForSeconds: z.number().int().min(30).max(86400),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    release: z
      .object({
        frontend: z.string().nullable(),
        api: z.string().nullable(),
        backend: z.string().nullable(),
        edgeSource: z.string().nullable(),
        schema: z.string().nullable(),
        compatible: z.boolean().nullable(),
      })
      .strict(),
    recovery: z.array(recoveryReceipt).max(4),
    coverage: z
      .object({
        mode: z.enum(["demand", "scheduled", "simulation"]),
        intervalSeconds: z.number().int().positive(),
        historyDays: z.number().int().positive(),
        independentMonitor: z.enum(["unknown", "configured"]),
        explanation: z.string().max(500),
      })
      .strict(),
  })
  .strict();
export type HealthSnapshot = z.infer<typeof healthSnapshot>;
export type HealthEvent = {
  id: string;
  serviceId: string;
  name: string;
  previous: HealthState | null;
  state: HealthState;
  at: string;
  kind: "transition" | "incident" | "recovery";
  reason: string;
};
export type HealthHistoryPoint = {
  at: string;
  services: Array<{ id: string; state: HealthState }>;
  resources: Array<{ id: string; value: number | null }>;
  queues: Array<{ id: string; pending: number | null; state: HealthState }>;
};
export type InfrastructureView = {
  snapshot: HealthSnapshot;
  history: HealthHistoryPoint[];
  events: HealthEvent[];
  historyWindow: {
    from: string;
    to: string;
    returned: number;
    points: number;
    coveredSlots: number;
    expected: number;
    gaps: number;
    availabilityPercent: null;
  };
  policy: {
    observationIntervalSeconds: number;
    alertAfterSeconds: number;
    recoveryAfterSeconds: number;
    backlogWarning: number;
    oldestWarningSeconds: number;
    memoryWarningBytes: number;
  };
};

/** A future timestamp cannot establish a current observation. */
export function freshEvidence(
  at: string | null,
  seconds: number,
  now = Date.now(),
) {
  const age = at === null ? NaN : now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= seconds * 1000;
}

/** Refreshing the UI never makes last-known evidence current. Counts remain inspectable. */
export function ageSnapshot(
  snapshot: HealthSnapshot,
  now = Date.now(),
): HealthSnapshot {
  return {
    ...snapshot,
    stale:
      snapshot.stale ||
      !freshEvidence(
        snapshot.collectedAt,
        snapshot.coverage.intervalSeconds * 2,
        now,
      ),
    services: snapshot.services.map((s) =>
      s.configured &&
      (!freshEvidence(s.collectedAt, s.freshForSeconds, now) ||
        (s.observedAt !== null &&
          !freshEvidence(s.observedAt, s.freshForSeconds, now)) ||
        (s.observedAt === null &&
          ["healthy", "degraded", "unavailable"].includes(s.state)))
        ? {
            ...s,
            state: "stale",
            reason: "EVIDENCE_EXPIRED",
            latencyMs: null,
            explanation:
              "Last-known evidence is outside its freshness policy; it does not establish the current service state.",
          }
        : s,
    ),
    resources: snapshot.resources.map((r) =>
      r.value !== null && !freshEvidence(r.observedAt, 90, now)
        ? {
            ...r,
            value: null,
            explanation:
              "Last-known measurement expired. Its observation timestamp is retained; no current value is established.",
          }
        : r,
    ),
    queues: snapshot.queues.map((q) =>
      !freshEvidence(q.collectedAt, 90, now) ||
      (q.observedAt !== null && !freshEvidence(q.observedAt, 90, now))
        ? {
            ...q,
            state: "stale",
            explanation: q.explanation,
          }
        : q,
    ),
    collectors: snapshot.collectors.map((c) =>
      c.active &&
      (!freshEvidence(c.collectedAt, c.freshForSeconds, now) ||
        (c.observedAt !== null &&
          !freshEvidence(c.observedAt, c.freshForSeconds, now)))
        ? { ...c, state: "stale" }
        : c,
    ),
  };
}
