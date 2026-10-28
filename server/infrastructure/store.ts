import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { individualSecurityUser } from "../security/users";
import {
  ageSnapshot,
  freshEvidence,
  healthSnapshot,
  recoveryReceipt,
  type HealthSnapshot,
  type InfrastructureView,
  type HealthEvent,
  type HealthHistoryPoint,
} from "../../shared/infrastructure";
import { boundedRead, collectInfrastructure } from "./collector";
import { monitoringInterval } from "./configuration";
import {
  healthPolicy,
  nextHealthState,
  type PersistedHealthState,
} from "./policy";

const cacheMs = 60000;
let cacheIdentity = process.env.DATABASE_URL;
let cached: HealthSnapshot | undefined,
  inFlight: Promise<HealthSnapshot> | undefined;
const date = (v: unknown) => new Date(String(v)).toISOString();
async function persist(snapshot: HealthSnapshot) {
  if (
    snapshot.services.some(
      (s) => s.id === "database" && s.state === "unavailable",
    )
  )
    return;
  const db = await getDb();
  if (!db) return;
  const policy = healthPolicy();
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout='3000ms'`);
    const rows = await tx.execute<{
        service_id: string;
        state: PersistedHealthState;
      }>(
        sql`select service_id,state from infrastructure_service_state for update`,
      ),
      previous = new Map(rows.map((r) => [r.service_id, r.state]));
    const states: Array<{ service_id: string; state: PersistedHealthState }> =
        [],
      events: Array<Record<string, unknown>> = [];
    for (const service of snapshot.services) {
      const before = previous.get(service.id),
        result = nextHealthState(
          before,
          service.state,
          snapshot.collectedAt,
          policy,
        );
      service.lastSuccessAt = result.next.lastSuccessAt;
      states.push({ service_id: service.id, state: result.next });
      for (const kind of [
        ...(result.changed ? ["transition" as const] : []),
        ...(result.notification ? [result.notification] : []),
      ])
        events.push({
          id: randomUUID(),
          service_id: service.id,
          name: service.name,
          previous_state: before?.state ?? null,
          state: service.state,
          occurred_at: snapshot.collectedAt,
          kind,
          reason: service.reason,
          dedupe_key: `${service.id}:${kind}:${service.state}:${result.next.since}`,
        });
    }
    await tx.execute(
      sql`insert into infrastructure_service_state(service_id,state) select service_id,state from jsonb_to_recordset(${JSON.stringify(states)}::jsonb) as x(service_id varchar(64),state jsonb) on conflict(service_id) do update set state=excluded.state`,
    );
    if (events.length)
      await tx.execute(
        sql`with added as(insert into infrastructure_events(id,service_id,name,previous_state,state,occurred_at,kind,reason,dedupe_key) select id,service_id,name,previous_state,state,occurred_at,kind,reason,dedupe_key from jsonb_to_recordset(${JSON.stringify(events)}::jsonb) as e(id uuid,service_id varchar(64),name varchar(100),previous_state varchar(24),state varchar(24),occurred_at timestamptz,kind varchar(24),reason varchar(96),dedupe_key varchar(200)) on conflict(dedupe_key) do nothing returning *) insert into notification_inbox("infrastructureEventId","userId",kind,title,body,"emailStatus") select e.id,u.id,'infrastructure','Infrastructure '||case when e.kind='recovery' then 'recovered' else 'needs attention' end||' · '||e.name,e.name||': '||replace(e.state,'_',' ')||'. Reason: '||e.reason,${process.env.INFRASTRUCTURE_EMAIL_ENABLED === "true" ? "pending" : "inbox_only"} from added e cross join users u where e.kind in('incident','recovery') and u.role='admin' and u.disabled_at is null and ${individualSecurityUser(sql`u`)}`,
      );
    await tx.execute(
      sql`insert into infrastructure_snapshots(collected_at,snapshot) values(${snapshot.collectedAt}::timestamptz,${JSON.stringify(snapshot)}::jsonb)`,
    );
    await tx.execute(
      sql`delete from infrastructure_snapshots where collected_at<now()-interval '24 hours' or id in(select id from infrastructure_snapshots order by collected_at desc offset 1440)`,
    );
    await tx.execute(
      sql`delete from infrastructure_events where occurred_at<now()-interval '7 days' or id in(select id from infrastructure_events order by occurred_at desc offset 500)`,
    );
    await tx.execute(
      sql`delete from infrastructure_collection_lease where claimed_at<now()-interval '1 day'`,
    );
  });
}
async function collectOrReuse(): Promise<HealthSnapshot> {
  if (cacheIdentity !== process.env.DATABASE_URL) {
    cacheIdentity = process.env.DATABASE_URL;
    cached = undefined;
    inFlight = undefined;
  }
  if (cached && freshEvidence(cached.collectedAt, cacheMs / 1000))
    return ageSnapshot(cached);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let retained: HealthSnapshot | undefined;
    try {
      const [row] = await boundedRead(
        sql`select snapshot from infrastructure_snapshots where collected_at<=${new Date().toISOString()}::timestamptz order by collected_at desc limit 1`,
      );
      const parsed = healthSnapshot.safeParse(row?.snapshot);
      if (parsed.success) retained = parsed.data;
      if (retained && freshEvidence(retained.collectedAt, cacheMs / 1000)) {
        cached = retained;
        return ageSnapshot(retained);
      }
      const lease = await boundedRead(
        sql`insert into infrastructure_collection_lease(slot) values(${Math.floor(Date.now() / cacheMs)}) on conflict(slot) do nothing returning slot`,
      );
      if (!lease.length) {
        if (retained) {
          cached = retained;
          return ageSnapshot(retained);
        }
        // Another replica owns this minute. Do not duplicate its cold probes.
        return healthSnapshot.parse({
          version: 1,
          collectedAt: new Date().toISOString(),
          synthetic: false,
          stale: true,
          services: [],
          dependencies: [],
          resources: [],
          queues: [],
          collectors: [],
          recovery: [],
          release: {
            frontend: null,
            api: null,
            backend: null,
            edgeSource: null,
            schema: null,
            compatible: null,
          },
          coverage: {
            mode: monitoringInterval() === null ? "demand" : "scheduled",
            intervalSeconds: monitoringInterval() ?? 60,
            historyDays: 1,
            independentMonitor: "unknown",
            explanation:
              "Collection is in progress on another API instance. Refresh after the collection completes; no duplicate probes were started.",
          },
        });
      }
    } catch {
      /* A database failure still permits independent process/network evidence. */
    }
    const next = await collectInfrastructure();
    try {
      await persist(next);
    } catch {
      /* In-memory last-known evidence survives a failed history write. */
    }
    cached = next;
    return ageSnapshot(next);
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
export async function infrastructureView(
  range: "2h" | "24h" = "2h",
  eventId?: string,
): Promise<InfrastructureView> {
  const snapshot = await collectOrReuse(),
    now = Date.now(),
    hours = range === "24h" ? 24 : 2,
    from = new Date(now - hours * 3600000).toISOString(),
    to = new Date(now).toISOString(),
    bucketSeconds = hours === 24 ? 720 : 60;
  let history: HealthHistoryPoint[] = [],
    events: HealthEvent[] = [],
    count = 0,
    coveredSlots = 0;
  const databaseUnavailable = snapshot.services.some(
    (s) => s.id === "database" && s.state === "unavailable",
  );
  try {
    if (databaseUnavailable) throw Error("DATABASE_UNAVAILABLE");
    const rows = await boundedRead(
      sql`with scoped as(select snapshot,collected_at,floor(extract(epoch from (collected_at-${from}::timestamptz))/${snapshot.coverage.intervalSeconds}) as slot,date_bin(${bucketSeconds + " seconds"}::interval,collected_at,${from}::timestamptz) as bucket from infrastructure_snapshots where collected_at>=${from}::timestamptz and collected_at<${to}::timestamptz) select (array_agg(snapshot order by collected_at desc))[1] as snapshot,count(*)::int as samples,(select count(distinct slot)::int from scoped) as covered_slots from scoped group by bucket order by bucket limit 120`,
    );
    history = rows.flatMap((r) => {
      count += Number(r.samples);
      coveredSlots = Number(r.covered_slots);
      const p = healthSnapshot.safeParse(r.snapshot);
      const historical = p.success
        ? ageSnapshot(p.data, Date.parse(p.data.collectedAt))
        : null;
      return historical
        ? [
            {
              at: historical.collectedAt,
              services: historical.services.map((s) => ({
                id: s.id,
                state: s.state,
              })),
              resources: historical.resources.map((s) => ({
                id: s.id,
                value: s.value,
              })),
              queues: historical.queues.map((s) => ({
                id: s.id,
                pending: ["stale", "unknown", "not_configured"].includes(
                  s.state,
                )
                  ? null
                  : s.pending,
                state: s.state,
              })),
            },
          ]
        : [];
    });
  } catch {}
  try {
    if (databaseUnavailable) throw Error("DATABASE_UNAVAILABLE");
    const rows = await boundedRead(
      sql`select id,service_id,name,previous_state,state,occurred_at,kind,reason from infrastructure_events where occurred_at>=${from}::timestamptz and occurred_at<=${to}::timestamptz order by occurred_at desc limit 100`,
    );
    if (
      eventId &&
      /^[a-f0-9-]{36}$/i.test(eventId) &&
      !rows.some((r) => r.id === eventId)
    ) {
      const linked = await boundedRead(
        sql`select id,service_id,name,previous_state,state,occurred_at,kind,reason from infrastructure_events where id::text=${eventId} and occurred_at<=${to}::timestamptz limit 1`,
      );
      if (linked.length) {
        if (rows.length === 100) rows.pop();
        rows.unshift(linked[0]);
      }
    }
    events = rows.map((r) => ({
      id: String(r.id),
      serviceId: String(r.service_id),
      name: String(r.name),
      previous: r.previous_state as HealthEvent["previous"],
      state: r.state as HealthEvent["state"],
      at: date(r.occurred_at),
      kind: r.kind as HealthEvent["kind"],
      reason: String(r.reason),
    }));
  } catch {}
  const expected = Math.ceil(
    (hours * 3600) / snapshot.coverage.intervalSeconds,
  );
  return {
    snapshot,
    history,
    events,
    historyWindow: {
      from,
      to,
      returned: count,
      points: history.length,
      coveredSlots,
      expected,
      gaps: Math.max(0, expected - coveredSlots),
      availabilityPercent: null,
    },
    policy: healthPolicy(),
  };
}
export function installRecoveryEvidence(app: Express) {
  app.post("/api/internal/recovery-status", async (req, res) => {
    const expected = Buffer.from(
        process.env.INFRASTRUCTURE_RECOVERY_TOKEN ?? "",
      ),
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
      await storeRecoveryEvidence(req.body);
      return res.status(202).json({ status: "accepted" });
    } catch {
      return res
        .status(400)
        .json({ error: "Recovery receipt could not be accepted" });
    }
  });
}
export async function storeRecoveryEvidence(value: unknown) {
  const receipt = recoveryReceipt.parse(value);
  if (Date.parse(receipt.observedAt) > Date.now() + 60000)
    throw Error("Future recovery receipt");
  if (
    receipt.kind === "restore" &&
    receipt.source !== "disposable-restore-drill"
  )
    throw Error("A backup is not a restore verification");
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const existing = await db.execute(
    sql`select receipt from infrastructure_recovery_receipts where receipt_id=${receipt.receiptId}`,
  );
  if (existing.length) {
    if (
      JSON.stringify(recoveryReceipt.parse(existing[0].receipt)) !==
      JSON.stringify(receipt)
    )
      throw Error("Retained receipt conflict");
    return;
  }
  const inserted = await db.execute(
    sql`insert into infrastructure_recovery_receipts(receipt_id,kind,observed_at,receipt) values(${receipt.receiptId},${receipt.kind},${receipt.observedAt}::timestamptz,${JSON.stringify(receipt)}::jsonb) on conflict(receipt_id) do nothing returning receipt_id`,
  );
  if (!inserted.length) {
    const [winner] = await db.execute(
      sql`select receipt from infrastructure_recovery_receipts where receipt_id=${receipt.receiptId}`,
    );
    if (
      !winner ||
      JSON.stringify(recoveryReceipt.parse(winner.receipt)) !==
        JSON.stringify(receipt)
    )
      throw Error("Retained receipt conflict");
  }
}
let scheduled: ReturnType<typeof setTimeout> | undefined;
export function startInfrastructureMonitoring() {
  const seconds = monitoringInterval();
  if (seconds === null) return;
  const run = async () => {
    try {
      await collectOrReuse();
    } catch {
    } finally {
      scheduled = setTimeout(run, seconds * 1000);
      scheduled.unref();
    }
  };
  scheduled = setTimeout(run, seconds * 1000);
  scheduled.unref();
}
