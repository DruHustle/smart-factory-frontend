import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
const count = z.number().int().min(0).max(2147483647);
export const workerReceipt = z
  .object({
    worker: z.literal("telemetry"),
    source: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    runtime: z.string().max(32),
    contractVersion: z.literal(2),
    migrationsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    mqttSubscribed: z.boolean(),
    observedAt: z.string().datetime(),
    pending: count,
    quarantined: count,
    failedAttempts: count,
    oldestPendingAt: z.string().datetime().nullable(),
    notificationReady: z.boolean().nullable().optional(),
    resources: z
      .object({
        residentBytes: z.number().int().nonnegative(),
        cpuMsPerSecond: z.number().finite().nonnegative().nullable(),
        databaseQueryMs: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export async function storeWorkerReceipt(value: unknown) {
  const report = workerReceipt.parse(value);
  if (Math.abs(Date.now() - Date.parse(report.observedAt)) > 60000)
    throw Error("Worker receipt clock outside policy");
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  await db.execute(
    sql`insert into runtime_worker_status(worker,report) values('telemetry',${JSON.stringify(report)}::jsonb) on conflict(worker) do update set report=excluded.report,received_at=now() where runtime_worker_status.report->>'observedAt' < excluded.report->>'observedAt'`,
  );
}
export async function telemetryWorkerReceipt() {
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const [row] = await db.execute(
    sql`select report,received_at from runtime_worker_status where worker='telemetry'`,
  );
  if (!row) return null;
  const report = workerReceipt.parse(row.report),
    receivedAt = new Date(String(row.received_at));
  return {
    ...report,
    receivedAt: receivedAt.toISOString(),
    fresh:
      Date.now() - receivedAt.getTime() >= 0 &&
      Date.now() - receivedAt.getTime() < 90000 &&
      Date.now() - Date.parse(report.observedAt) >= 0 &&
      Date.now() - Date.parse(report.observedAt) < 90000,
  };
}
export function installOperatingEvidence(app: Express) {
  app.post("/api/internal/worker-status", async (req, res) => {
    const expected = Buffer.from(process.env.INGESTION_API_TOKEN ?? ""),
      given = Buffer.from(
        (req.header("authorization") ?? "").replace(/^Bearer /, ""),
      );
    if (
      expected.length < 32 ||
      given.length !== expected.length ||
      !timingSafeEqual(expected, given)
    )
      return res.status(401).json({ error: "Unauthorized service" });
    try {
      await storeWorkerReceipt(req.body);
      return res.status(202).json({ status: "accepted" });
    } catch {
      return res
        .status(400)
        .json({ error: "Worker status could not be accepted" });
    }
  });
}
export async function operatingEvidence() {
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const [queue] = await db.execute(
    sql`select count(*) filter(where delivered_at is null and quarantined_at is null)::int as pending,case when count(*) filter(where delivered_at is null and quarantined_at is null and accepted_at is null)>0 then null else min(accepted_at) filter(where delivered_at is null and quarantined_at is null) end as oldest,count(*) filter(where quarantined_at is not null)::int as quarantined from security_outbox`,
  );
  const [ingress] = await db.execute(
    sql`select count(*)::int as quarantined,max(last_received_at) as latest from telemetry_rejections`,
  );
  const [email] = await db.execute(
    sql`select count(*) filter(where "emailStatus"='pending')::int as pending,count(*) filter(where "emailStatus"='failed')::int as failed,min("createdAt") filter(where "emailStatus"='pending') as oldest from notification_inbox`,
  );
  const collectors = await db.execute(
    sql`select name,active,last_received_at,latest_event_at,last_error,policy->>'staleAfterSeconds' as stale_seconds from security_sources where is_demo=false order by name limit 100`,
  );
  return {
    runtime: await (await import("./runtimeContract")).getRuntimeContract(),
    worker: await telemetryWorkerReceipt(),
    security: queue,
    ingress,
    email,
    collectors,
    backup: {
      state: "unknown" as const,
      lastVerifiedRestoreAt: null,
      description:
        "No verified backup or restore receipt has been supplied to this installation.",
    },
  };
}
