import { sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import {
  envelope,
  ownedEnvelope,
  eventTypes,
  SecurityError,
  type Evidence,
} from "./contract";
import {
  database,
  enabled,
  initialize,
  ingest,
  rows,
  audit,
  securityTransaction,
} from "./store";
import { finding } from "./rules";
let inFlight = 0,
  failed = 0,
  lastFailure: string | null = null;
export const captureHealth = () => ({ pending: inFlight, failed, lastFailure });
export function principal(value: string) {
  return (
    "sha256:" +
    createHmac("sha256", process.env.JWT_SECRET ?? "local-no-identity-key")
      .update(value.trim().toLowerCase())
      .digest("hex")
  );
}
export async function nativeEvent(
  type: keyof typeof import("./contract").profiles,
  attributes: Record<string, unknown>,
  summary: string,
) {
  if (!enabled()) return;
  if (inFlight >= 8) {
    failed++;
    lastFailure = "capture_backpressure";
    return;
  }
  inFlight++;
  try {
    const db = await database();
    const mode = process.env.SECURITY_NATIVE_MODE ?? "live",
      run = process.env.SECURITY_SCENARIO_RUN_ID;
    const event = ownedEnvelope.parse({
      schemaVersion: eventTypes.includes(type as any)
        ? "ot-security-evidence/v1"
        : "smart-factory-ot-observation/v1",
      producerNamespace: "smart-factory-native",
      sourceEventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      mode,
      scenarioRunId: mode === "simulated" ? run : undefined,
      replayRunId:
        mode === "replay" ? process.env.SECURITY_REPLAY_RUN_ID : undefined,
      eventType: type,
      assetRef: null,
      summary,
      quality: "good",
      producerVersion: "smart-factory-node-1",
      attributes,
    });
    // Persistent app-owned outbox. Evidence capture failure never changes the real auth/control decision.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='1500ms'`);
      await tx.execute(sql`select pg_advisory_xact_lock(2026102704)`);
      await tx.execute(
        sql`delete from security_outbox where id in (select id from security_outbox where delivered_at is not null order by delivered_at limit 1000) and (select count(*) from security_outbox)>=10000`,
      );
      const [{ count }] = await rows(
        tx,
        sql`select count(*)::int as count from security_outbox where delivered_at is null`,
      );
      if (count >= 10000) throw new Error("capture_capacity");
      await tx.execute(
        sql`insert into security_outbox(id,producer,event_type,attributes,occurred_at) values(${event.sourceEventId},'node-app',${type},${JSON.stringify(event)}::jsonb,${event.occurredAt})`,
      );
    });
  } catch {
    failed++;
    lastFailure = "capture_unavailable";
  } finally {
    inFlight--;
  }
}
export async function drainOutbox() {
  const db = await database(),
    pending = await rows(
      db,
      sql`select * from security_outbox where delivered_at is null and quarantined_at is null and next_attempt<=now() order by occurred_at limit 100`,
    );
  for (const item of pending) {
    const [source] = await rows(
      db,
      sql`select id,namespace from security_sources where system_key=${item.producer}`,
    );
    try {
      if (!source) throw new SecurityError(422, "unknown_internal_producer");
      const input = item.attributes;
      const parsed = ownedEnvelope.safeParse(input);
      if (!parsed.success)
        throw new SecurityError(422, "invalid_internal_event");
      await ingest(source.id, [parsed.data]);
      await db.execute(
        sql`update security_outbox set delivered_at=now(),error_code=null where id=${item.id}`,
      );
    } catch (error) {
      const permanent =
          error instanceof SecurityError &&
          [401, 403, 409, 413, 422].includes(error.status),
        attempts = item.attempts + 1;
      await db.execute(
        sql`update security_outbox set attempts=${attempts},next_attempt=now()+(${Math.min(300, 2 ** Math.min(8, attempts))}*interval '1 second'),quarantined_at=case when ${permanent || attempts >= 12} then now() else null end,error_code=${permanent ? "permanent_event_rejection" : attempts >= 12 ? "retry_exhausted" : "transient_unconfirmed"} where id=${item.id}`,
      );
    }
  }
}
export async function sweep() {
  if (!enabled()) return;
  await initialize();
  await drainOutbox();
  const db = await database(),
    now = new Date();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    await tx.execute(sql`select pg_advisory_xact_lock(2026102703)`);
    await tx.execute(
      sql`update security_findings set condition_active=false where condition_active=true and condition_until<now()`,
    );
    const expired = await rows(
      tx,
      sql`update security_findings set status='open',risk_until=null,version=version+1 where status='accepted_risk' and risk_until<now() returning id,source_id`,
    );
    for (const f of expired)
      await audit(tx, "risk_acceptance_expired", null, {}, f.id, f.source_id);
    const [rule] = await rows(
      tx,
      sql`select * from security_rules where id='collector-coverage' and active=true`,
    );
    if (!rule?.settings.enabled) return;
    const sources = await rows(
      tx,
      sql`select * from security_sources where active=true and is_demo=false and system_key is null limit 100`,
    );
    for (const source of sources) {
      if (
        !source.policy.modes.includes("live") ||
        !source.policy.expectedIntervalSeconds
      )
        continue;
      const interval = source.policy.expectedIntervalSeconds,
        reference = source.last_received_at ?? source.created_at;
      if (
        now.getTime() - new Date(reference).getTime() <=
        interval * rule.settings.threshold * 1000
      )
        continue;
      const [recent] = await rows(
        tx,
        sql`select last_seen from security_findings where source_id=${source.id} and rule_id='collector-coverage' order by last_seen desc limit 1`,
      );
      if (
        recent &&
        now.getTime() - new Date(recent.last_seen).getTime() < interval * 1000
      )
        continue;
      const observation = {
        schemaVersion: "smart-factory-receiver-observation/v1",
        mode: "live",
        occurredAt: now.toISOString(),
        receiverObservedAt: now.toISOString(),
        lastReceiptAt: source.last_received_at,
        configuredExpectedIntervalSeconds: interval,
        summary:
          "No receipt from this configured security source inside its expected interval.",
      };
      const e = {
        id: randomUUID(),
        envelope: observation as unknown as Evidence,
        target:
          source.policy.targets.length === 1 ? source.policy.targets[0] : null,
        installed_component_id: null,
        clock_skew: false,
      };
      await finding(
        tx,
        source,
        rule,
        e,
        {
          title: "Security source evidence is missing or stale",
          category: "coverage",
          severity: "low",
          confidence: "receiver_observed",
          observed: { lastReceiptAt: source.last_received_at },
          expected: {
            intervalSeconds: interval,
            graceIntervals: rule.settings.threshold,
          },
          checks: [
            "Check source connectivity, collector state and durable queue.",
            "Coverage loss is not proof of intrusion.",
          ],
        },
        [e],
        now,
      );
    }
  });
}
export function startSecurity() {
  let busy = false,
    lastHealth = 0;
  const run = async () => {
    if (busy || !enabled()) return;
    busy = true;
    try {
      await sweep();
      if (Date.now() - lastHealth >= 300000) {
        lastHealth = Date.now();
        await nativeEvent(
          "collector.health",
          { state: "online", expectedIntervalSeconds: 300 },
          "Application security collector is running.",
        );
      }
    } catch {
      lastFailure = "security_sweep_unavailable";
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void run(), 10000);
  timer.unref();
  void run();
  let reportBusy = false;
  const reportTimer = setInterval(async () => {
    if (reportBusy || !enabled()) return;
    reportBusy = true;
    try {
      await (await import("./report-worker")).processReportChunk();
    } catch {
      lastFailure = "report_processing_unavailable";
    } finally {
      reportBusy = false;
    }
  }, 1000);
  reportTimer.unref();
  return () => {
    clearInterval(timer);
    clearInterval(reportTimer);
  };
}
