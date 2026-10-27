import { demoDataEnabled } from "../demoData";
import { reserve } from "./quota";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  baselineInput,
  sanitize,
  canonical,
  digest,
  type Evidence,
  ownedEventTypes,
  SecurityError,
  sourceInput,
  ruleInput,
} from "./contract";
import { z } from "zod";
export type Conn = { execute: (q: any) => Promise<any> };
export async function database() {
  const d = await getDb();
  if (!d) throw new SecurityError(503, "security_unavailable");
  return d;
}
export async function rows<T = Record<string, any>>(
  c: Conn,
  q: ReturnType<typeof sql>,
): Promise<T[]> {
  return (await c.execute(q)) as T[];
}
let writing = false;
const waiters: Array<() => void> = [];
/** Acquire a bounded in-process queue before borrowing a primary DB connection. */
export async function securityTransaction<T>(
  work: (tx: Conn) => Promise<T>,
): Promise<T> {
  if (writing) {
    if (waiters.length >= 16)
      throw new SecurityError(429, "security_backpressure");
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else writing = true;
  try {
    const db = await database();
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='1500ms'`);
      await tx.execute(sql`set local statement_timeout='5000ms'`);
      return work(tx);
    });
  } finally {
    const next = waiters.shift();
    if (next) next();
    else writing = false;
  }
}
export const enabled = () => process.env.SECURITY_ENABLED !== "false";
export const targetKey = (t: { kind: string; id: number | null }) =>
  `${t.kind}:${t.id ?? "application"}`;
export const defaults = [
  ["authentication-burst", 5, 300],
  ["authorization-burst", 3, 300],
  ["certificate-expiry", 30, 86400],
  ["configuration-drift", 1, 86400],
  ["unrecognized-identity", 1, 3600],
  ["collector-coverage", 3, 3600],
  ["integrity-change", 1, 86400],
  ["reported-vulnerability", 1, 86400],
  ["plaintext-transport", 1, 3600],
] as const;
export async function audit(
  c: Conn,
  action: string,
  actor: number | null,
  detail: unknown,
  finding: string | null = null,
  source: string | null = null,
) {
  await reserve(c, Buffer.byteLength(JSON.stringify(detail)) + 256);
  await c.execute(
    sql`insert into security_audit(action,actor_id,detail,finding_id,source_id) values(${action},${actor},${JSON.stringify(detail)}::jsonb,${finding},${source})`,
  );
}
export async function initialize() {
  if (!enabled()) return;
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    await tx.execute(sql`select pg_advisory_xact_lock(2026102701)`);
    for (const [id, threshold, windowSeconds] of defaults)
      await tx.execute(
        sql`insert into security_rules(id,version,settings,active) values(${id},1,${JSON.stringify({ threshold, windowSeconds, enabled: true })}::jsonb,true) on conflict(id,version) do nothing`,
      );
    for (const [key, namespace] of [
      ["node-app", "smart-factory-native"],
      ["dotnet-services", "smart-factory-dotnet"],
    ]) {
      const policy = {
        targets: [{ kind: "application", id: null }],
        modes: ["live", "simulated", "replay"],
        types: ownedEventTypes,
        inputs: [],
        connections: [],
        expectedIntervalSeconds: key === "node-app" ? 300 : 0,
      };
      await tx.execute(
        sql`insert into security_sources(id,name,namespace,system_key,policy) values(${randomUUID()},${key},${namespace},${key},${JSON.stringify(policy)}::jsonb) on conflict(namespace) do nothing`,
      );
    }
  });

}
export async function validateTarget(
  c: Conn,
  t: { kind: string; id: number | null },
) {
  if (t.kind === "application" && t.id === null) return;
  const found =
    t.kind === "asset"
      ? await rows(
          c,
          sql`select id from assets where id=${t.id} and "isDemo"=false`,
        )
      : await rows(
          c,
          sql`select id from devices where id=${t.id} and "isDemo"=false`,
        );
  if (!found.length) throw new SecurityError(422, "unregistered_target");
}
export async function createSource(
  input: z.infer<typeof sourceInput>,
  actor: number,
) {
  if (input.namespace.startsWith("smart-factory-"))
    throw new SecurityError(422, "reserved_namespace");
  const db = await database(),
    id = randomUUID(),
    token = `sfsec.${id}.${randomBytes(32).toString("base64url")}`;
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    await tx.execute(sql`select pg_advisory_xact_lock(2026102701)`);
    if (
      (await rows(tx, sql`select id from security_sources limit 101`)).length >=
      100
    )
      throw new SecurityError(429, "source_capacity");
    for (const t of input.targets) await validateTarget(tx, t);
    if (
      (
        await rows(
          tx,
          sql`select id from security_sources where namespace=${input.namespace}`,
        )
      ).length
    )
      throw new SecurityError(409, "namespace_exists");
    await reserve(tx, Buffer.byteLength(JSON.stringify(input)) + 512);
    await tx.execute(
      sql`insert into security_sources(id,name,namespace,token_hash,policy,created_by) values(${id},${input.name},${input.namespace},${digest(token)},${JSON.stringify(input)}::jsonb,${actor})`,
    );
    await audit(
      tx,
      "source_created",
      actor,
      { name: input.name, namespace: input.namespace, targets: input.targets },
      null,
      id,
    );
  });
  return { id, token }; // One-time return; callers must not persist this in browser storage.
}
export async function sourceCredential(token: string) {
  const m = /^sfsec\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || !z.uuid().safeParse(m[1]).success)
    throw new SecurityError(401, "invalid_source_credential");
  const [s] = await rows(
    await database(),
    sql`select * from security_sources where id=${m[1]} and active=true and system_key is null`,
  );
  const provided = Buffer.from(digest(token)),
    expected = Buffer.from(s?.token_hash ?? "0".repeat(64));
  if (!s || !timingSafeEqual(provided, expected))
    throw new SecurityError(401, "invalid_source_credential");
  return s;
}
export async function credentialAction(
  id: string,
  action: "revoke" | "rotate",
  actor: number,
) {
  const token = `sfsec.${id}.${randomBytes(32).toString("base64url")}`;
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const changed = await rows(
      tx,
      sql`update security_sources set token_hash=${action === "rotate" ? digest(token) : null},active=${action === "rotate"} where id=${id} and system_key is null returning id`,
    );
    if (!changed.length) throw new SecurityError(404, "source_not_found");
    await audit(tx, `source_${action}`, actor, {}, null, id);
  });
  return { token: action === "rotate" ? token : undefined };
}
export async function proposeBaseline(
  input: z.infer<typeof baselineInput>,
  actor: number,
) {
  input = { ...input, reason: sanitize(input.reason) };
  const db = await database(),
    id = randomUUID();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    if (
      !(
        await rows(
          tx,
          sql`select id from security_sources where id=${input.sourceId} and is_demo=false`,
        )
      ).length
    )
      throw new SecurityError(404, "source_not_found");
    await reserve(tx, Buffer.byteLength(JSON.stringify(input)) + 512);
    if (
      (
        await rows(
          tx,
          sql`select id from security_baselines where source_id=${input.sourceId} limit 100`,
        )
      ).length >= 100
    )
      throw new SecurityError(429, "baseline_capacity");
    await tx.execute(
      sql`insert into security_baselines(id,source_id,revision,settings,proposed_by) values(${id},${input.sourceId},${input.revision},${JSON.stringify(input)}::jsonb,${actor})`,
    );
    await audit(
      tx,
      "baseline_proposed",
      actor,
      { id, revision: input.revision },
      null,
      input.sourceId,
    );
  });
  return { id };
}
export async function approveBaseline(id: string, actor: number) {
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [b] = await rows(
      tx,
      sql`update security_baselines set approved_by=${actor},approved_at=now() where id=${id} and approved_at is null returning source_id,revision`,
    );
    if (!b)
      throw new SecurityError(409, "baseline_already_reviewed_or_missing");
    await audit(
      tx,
      "baseline_approved",
      actor,
      { id, revision: b.revision },
      null,
      b.source_id,
    );
  });
  return { approved: true };
}
export async function activateRule(
  input: z.infer<typeof ruleInput>,
  actor: number,
) {
  input = { ...input, reason: sanitize(input.reason) };
  const db = await database();
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    await tx.execute(sql`select pg_advisory_xact_lock(2026102701)`);
    const [last] = await rows(
      tx,
      sql`select version from security_rules where id=${input.id} order by version desc limit 1`,
    );
    await tx.execute(
      sql`update security_rules set active=false where id=${input.id}`,
    );
    const version = (last?.version ?? 0) + 1;
    if (version > 100) throw new SecurityError(429, "rule_version_capacity");
    await tx.execute(
      sql`insert into security_rules(id,version,settings,active,actor_id) values(${input.id},${version},${JSON.stringify(input)}::jsonb,true,${actor})`,
    );
    await audit(tx, "rule_version_activated", actor, {
      id: input.id,
      version,
      settings: input,
    });
    return { version };
  });
}
export async function mapIdentity(
  input: {
    sourceId: string;
    namespace: string;
    assetRef: string;
    componentRef: string | null;
    target: { kind: string; id: number | null };
    installedComponentId?: string;
  },
  actor: number,
) {
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [s] = await rows(
      tx,
      sql`select * from security_sources where id=${input.sourceId} and is_demo=false for update`,
    );
    if (
      !s ||
      !s.policy.targets.some(
        (t: any) => canonical(t) === canonical(input.target),
      )
    )
      throw new SecurityError(403, "outside_source_scope");
    await validateTarget(tx, input.target);
    if (input.installedComponentId) {
      if (input.target.kind !== "asset")
        throw new SecurityError(422, "component_requires_asset");
      const match = await rows(
        tx,
        sql`select w.id from equipment_workspaces w join assets a on a.id=w.asset_id where a.id=${input.target.id} and exists(select 1 from jsonb_array_elements(w.components) p where p->>'installedComponentId'=${input.installedComponentId})`,
      );
      if (!match.length) throw new SecurityError(422, "component_not_in_asset");
    }
    const [existing] = await rows(
      tx,
      sql`select id from security_mappings where source_id=${input.sourceId} and namespace=${input.namespace} and asset_ref=${input.assetRef} and component_ref=${input.componentRef ?? ""}`,
    );
    if (!existing) {
      const [{ total, per_source }] = await rows(
        tx,
        sql`select count(*)::int as total,count(*) filter(where source_id=${input.sourceId})::int as per_source from security_mappings`,
      );
      if (total >= 10000 || per_source >= 1000)
        throw new SecurityError(429, "mapping_capacity");
      await reserve(tx, Buffer.byteLength(JSON.stringify(input)) + 512);
    }
    await tx.execute(
      sql`insert into security_mappings(id,source_id,namespace,asset_ref,component_ref,target,installed_component_id,reviewed_by) values(${randomUUID()},${input.sourceId},${input.namespace},${input.assetRef},${input.componentRef ?? ""},${JSON.stringify(input.target)}::jsonb,${input.installedComponentId ?? null},${actor}) on conflict(source_id,namespace,asset_ref,component_ref) do update set target=excluded.target,installed_component_id=excluded.installed_component_id,reviewed_by=excluded.reviewed_by,reviewed_at=now()`,
    );
    await audit(
      tx,
      "identity_mapping_reviewed",
      actor,
      input,
      null,
      input.sourceId,
    );
  });
  return { mapped: true };
}
export async function ingest(sourceId: string, events: Evidence[]) {
  if (!enabled()) throw new SecurityError(503, "security_disabled");
  const db = await database();
  return securityTransaction((tx) => ingestInTransaction(tx, sourceId, events));
}
/** Caller supplies the existing application transaction; trusted review context never comes from the wire. */
export async function ingestInTransaction(
  tx: Conn,
  sourceId: string,
  events: Evidence[],
  reviewedTarget?: { kind: string; id: number | null },
) {
  if (!enabled()) throw new SecurityError(503, "security_disabled");
  await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
  // Bounded serialized quota accounting also makes conflicting retries atomic.
  const [source] = await rows(
    tx,
    sql`select * from security_sources where id=${sourceId} for update`,
  );
  if (!source?.active) throw new SecurityError(403, "source_inactive");
  const [policy] = await rows(
    tx,
    sql`select retention_days from security_usage where singleton=true`,
  );
  const [quota] = await rows(
    tx,
    sql`select count(*)::int as count from security_events where source_id=${sourceId}`,
  );
  const accepted = [];
  const latestByStream = new Map<string, Date | null>();
  for (const e of events) {
    if (
      e.producerNamespace !== source.namespace ||
      !source.policy.modes.includes(e.mode) ||
      !source.policy.types.includes(e.eventType)
    )
      throw new SecurityError(403, "outside_source_scope");
    const hash = digest(e),
      [prior] = await rows(
        tx,
        sql`select id,fingerprint from security_events where source_id=${sourceId} and source_event_id=${e.sourceEventId}`,
      );
    if (prior) {
      if (prior.fingerprint !== hash)
        throw new SecurityError(409, "event_identity_conflict");
      accepted.push({ sourceEventId: e.sourceEventId, status: "duplicate" });
      continue;
    }
    if (
      quota.count + accepted.filter((a) => a.status === "accepted").length >=
      10000
    )
      throw new SecurityError(429, "source_capacity");
    let target = null,
      component = null,
      association = "unmapped";
    if (e.assetRef) {
      const [mapping] = await rows(
        tx,
        sql`select * from security_mappings where source_id=${sourceId} and namespace=${e.assetRef.namespace} and asset_ref=${e.assetRef.assetId} and component_ref=${e.assetRef.componentId ?? ""}`,
      );
      if (mapping) {
        target = mapping.target;
        component = mapping.installed_component_id;
        association = "reviewed";
      }
    } else if (
      reviewedTarget &&
      source.policy.targets.some(
        (t: any) => canonical(t) === canonical(reviewedTarget),
      )
    ) {
      target = reviewedTarget;
      association = "reviewed_import";
    } else if (source.policy.targets.length === 1) {
      target = source.policy.targets[0];
      association = "source_scope";
    }
    await reserve(tx, Buffer.byteLength(canonical(e)) + 512, 1);
    const stream = `${e.mode}:${e.scenarioRunId ?? e.replayRunId ?? ""}`;
    if (!latestByStream.has(stream)) {
      const [latest] = await rows(
        tx,
        sql`select max(occurred_at) as at from security_events where source_id=${sourceId} and mode=${e.mode} and clock_skew=false and coalesce(envelope->>'scenarioRunId',envelope->>'replayRunId','')=${e.scenarioRunId ?? e.replayRunId ?? ""}`,
      );
      latestByStream.set(stream, latest.at ? new Date(latest.at) : null);
    }
    const latest = latestByStream.get(stream);
    const id = randomUUID(),
      occurred = new Date(e.occurredAt),
      now = new Date(),
      skew = occurred.getTime() > now.getTime() + 300000;
    await tx.execute(
      sql`insert into security_events(id,source_id,source_event_id,fingerprint,envelope,event_type,mode,quality,target,installed_component_id,association,occurred_at,expires_at,clock_skew,late,bytes) values(${id},${sourceId},${e.sourceEventId},${hash},${JSON.stringify(e)}::jsonb,${e.eventType},${e.mode},${e.quality},${target ? JSON.stringify(target) : null}::jsonb,${component},${association},${occurred.toISOString()},now()+(${policy.retention_days}*interval '1 day'),${skew},${latest ? occurred < latest : false},${Buffer.byteLength(canonical(e))})`,
    );
    const { evaluate } = await import("./rules");
    await evaluate(
      tx,
      source,
      {
        id,
        envelope: e,
        target,
        installed_component_id: component,
        clock_skew: skew,
      },
      now,
    );
    accepted.push({ sourceEventId: e.sourceEventId, status: "accepted" });
    if (!skew && (!latest || occurred > latest))
      latestByStream.set(stream, occurred);
    if (e.mode === "live") {
      await tx.execute(
        sql`update security_sources set last_received_at=now(),latest_event_at=case when ${!skew} then greatest(latest_event_at,${occurred.toISOString()}::timestamptz) else latest_event_at end,last_error=${skew ? "clock_skew" : null} where id=${sourceId}`,
      );
      source.latest_event_at =
        source.latest_event_at && new Date(source.latest_event_at) > occurred
          ? source.latest_event_at
          : occurred;
    }
  }
  return { accepted };
}
