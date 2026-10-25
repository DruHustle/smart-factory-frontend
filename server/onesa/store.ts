import { artifactStatus } from "./model";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { integrationConfig, type Config } from "./config";
import {
  CONTRACT,
  registrationSchema,
  mappingSchema,
  type Registration,
  type Mapping,
} from "./contract";
import { normalize, freshness, type SourceSample } from "./normalize";
export type Executor = { execute: (query: SQL) => PromiseLike<unknown> };
export async function rows<T = Record<string, unknown>>(
  tx: Executor,
  q: SQL,
): Promise<T[]> {
  return (await tx.execute(q)) as T[];
}
export async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}
const fingerprint = (c: Config) =>
  createHash("sha256").update(c.url).digest("hex");
export async function ensureScope(tx: Executor, c: Config) {
  let [r] = await rows(
    tx,
    sql`select * from onesa_installation where singleton=true`,
  );
  if (!r) {
    await tx.execute(
      sql`insert into onesa_installation (installation_id,workspace_id,destination_fingerprint) values (${c.installationId},${c.workspaceId},${fingerprint(c)}) on conflict do nothing`,
    );
    [r] = await rows(
      tx,
      sql`select * from onesa_installation where singleton=true`,
    );
  }
  if (
    r.installation_id !== c.installationId ||
    r.workspace_id !== c.workspaceId ||
    r.destination_fingerprint !== fingerprint(c)
  )
    throw new Error(
      "Persisted integration scope differs; explicit migration required",
    );
  return r;
}
export let captureFailures = 0;
/** Called in an isolated savepoint inside the existing telemetry transaction. */
export async function capture(tx: Executor, sample: SourceSample) {
  const c = integrationConfig();
  if (!c) return;
  await tx.execute(sql`select pg_advisory_xact_lock(202610251)`);
  await ensureScope(tx, c);
  await tx.execute(
    sql`delete from onesa_outbox where id in (select id from onesa_outbox where state='acknowledged' order by id limit 100) and (select count(*) from onesa_outbox)>=${c.maxRows}`,
  );
  const [{ n }] = await rows<{ n: string }>(
    tx,
    sql`select count(*) as n from onesa_outbox`,
  );
  if (Number(n) >= c.maxRows) {
    await tx.execute(
      sql`update onesa_installation set discarded=discarded+1,last_error='queue_capacity'`,
    );
    return;
  }
  const [equipment] = await rows(
    tx,
    sql`select * from onesa_equipment where external_asset_id=${sample.assetId ?? ""} and device_id=${sample.deviceId}`,
  );
  const sourceId = sample.ingestionId!;
  const snapshot = {
    sample,
    registration: equipment?.registration ?? null,
    mapping: equipment?.mapping ?? null,
    version: equipment?.version ?? 0,
    scope: { installationId: c.installationId, workspaceId: c.workspaceId },
  };
  const inserted = await rows(
    tx,
    sql`insert into onesa_outbox (source_id,equipment_id,payload) values (${sourceId},${equipment?.equipment_id ?? null},${JSON.stringify(snapshot)}::jsonb) on conflict do nothing returning id`,
  );
  if (inserted.length)
    await tx.execute(sql`update onesa_installation set captured=captured+1`);
}
export function recordCaptureFailure() {
  captureFailures += 1;
  console.warn(
    "[Onesa] Optional capture unavailable; local telemetry preserved.",
  );
}
export async function previewRegistration(
  input: Registration,
  executor?: Executor,
) {
  const r = registrationSchema.parse(input);
  const db = executor ?? (await database());
  const [existing] = await rows(
    db,
    sql`select * from onesa_equipment where equipment_id=${r.equipmentId}`,
  );
  if (
    existing &&
    (existing.external_asset_id !== r.externalAssetId ||
      existing.device_id !== r.deviceId)
  )
    throw new Error("Immutable source identity conflict");
  const [collision] = await rows(
    db,
    sql`select equipment_id from onesa_equipment where external_asset_id=${r.externalAssetId} and equipment_id<>${r.equipmentId}`,
  );
  if (collision)
    throw new Error(
      "External identifier already registered; reconcile existing identity",
    );
  if (existing) {
    const old = registrationSchema.parse(existing.registration);
    if (
      JSON.stringify(
        old.components.map((c) => [c.componentId, c.parentComponentId]),
      ) !==
      JSON.stringify(
        r.components.map((c) => [c.componentId, c.parentComponentId]),
      )
    )
      throw new Error(
        "Component hierarchy is immutable; retire and explicitly migrate components",
      );
  }
  return {
    before: existing?.registration ?? null,
    after: r,
    expectedVersion: Number(existing?.version ?? 0),
    consumerRegistration: "unavailable" as const,
    ownership: "Source metadata only; no Onesa fields are overwritten",
  };
}
export async function saveRegistration(
  input: Registration,
  expectedVersion: number,
  actor: number,
) {
  const preview = await previewRegistration(input);
  if (preview.expectedVersion !== expectedVersion)
    throw new Error("Registration revision conflict");
  const db = await database();
  return db.transaction(async (tx) => {
    const c = integrationConfig();
    if (!c) throw new Error("Integration is disabled");
    await ensureScope(tx, c);
    await tx.execute(sql`select pg_advisory_xact_lock(202610252)`);
    const current = await previewRegistration(input, tx);
    if (current.expectedVersion !== expectedVersion)
      throw new Error("Registration revision conflict");
    const [r] = await rows(
      tx,
      sql`insert into onesa_equipment (equipment_id,external_asset_id,device_id,registration,updated_by,version) values (${input.equipmentId},${input.externalAssetId},${input.deviceId},${JSON.stringify(input)}::jsonb,${actor},1)
 on conflict (equipment_id) do update set registration=excluded.registration,version=onesa_equipment.version+1,updated_by=excluded.updated_by,updated_at=now() where onesa_equipment.version=${expectedVersion} returning version`,
    );
    if (!r) throw new Error("Registration revision conflict");
    await tx.execute(
      sql`insert into onesa_audit (actor,action,equipment_id,version) values (${actor},'registration',${input.equipmentId},${Number(r.version)})`,
    );
    return { version: Number(r.version) };
  });
}
export async function previewMapping(input: Mapping, executor?: Executor) {
  const m = mappingSchema.parse(input),
    c = integrationConfig();
  if (!c) throw new Error("Integration is disabled");
  const db = executor ?? (await database());
  await ensureScope(db, c);
  const [equipment] = await rows(
    db,
    sql`select * from onesa_equipment where equipment_id=${m.equipmentId}`,
  );
  if (!equipment) throw new Error("Register source equipment first");
  if (Number(equipment.version) !== m.expectedVersion)
    throw new Error("Mapping revision conflict");
  const r = registrationSchema.parse(equipment.registration);
  if (
    m.targets.length !== r.components.length ||
    r.components.some(
      (n) => !m.targets.some((t) => t.componentId === n.componentId),
    )
  )
    throw new Error("Every source component needs exactly one mapping");
  const others = await rows(
    db,
    sql`select mapping from onesa_equipment where equipment_id<>${m.equipmentId} and mapping is not null`,
  );
  for (const o of others) {
    const other = mappingSchema.parse(o.mapping);
    if (
      other.targets.some((t) =>
        m.targets.some((n) => n.equipmentId === t.equipmentId),
      )
    )
      throw new Error(
        "Target equipment already belongs to a different installed instance",
      );
  }
  return {
    before: equipment.mapping ?? null,
    after: m,
    workspaceId: c.workspaceId,
    consumerRegistration: "unavailable" as const,
    warning:
      "Proposed mapping only. Consumer authorization and registration acceptance remain pending.",
  };
}
export async function saveMapping(input: Mapping, actor: number) {
  const db = await database();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(202610252)`);
    // Serialize the cross-instance target check with every mapping writer.
    await previewMapping(input, tx);
    const [r] = await rows(
      tx,
      sql`update onesa_equipment set mapping=${JSON.stringify(input)}::jsonb,retired=${input.retired},version=version+1,updated_by=${actor},updated_at=now() where equipment_id=${input.equipmentId} and version=${input.expectedVersion} returning version`,
    );
    if (!r) throw new Error("Mapping revision conflict");
    await tx.execute(
      sql`insert into onesa_audit (actor,action,equipment_id,version) values (${actor},'mapping',${input.equipmentId},${Number(r.version)})`,
    );
    return { version: Number(r.version) };
  });
}
export async function normalizeCaptured(tx: Executor, c: Config) {
  const pending = await rows(
    tx,
    sql`select * from onesa_outbox where state='captured' order by id limit ${c.batchSize}`,
  );
  for (const r of pending) {
    try {
      const p = r.payload as {
        sample: SourceSample;
        registration: unknown;
        mapping: unknown;
        version: number;
        scope: { installationId: string; workspaceId: string };
      };
      if (!p.registration || !p.mapping) throw new Error("missing_mapping");
      if (
        p.scope.installationId !== c.installationId ||
        p.scope.workspaceId !== c.workspaceId
      )
        throw new Error("scope_conflict");
      const events = normalize(
        p.sample,
        registrationSchema.parse(p.registration),
        mappingSchema.parse(p.mapping),
        p.scope,
        p.version,
      );
      if (!events.length) throw new Error("no_observations");
      await tx.execute(sql`select pg_advisory_xact_lock(202610251)`);
      const [{ n }] = await rows<{ n: string }>(
        tx,
        sql`select count(*) as n from onesa_outbox`,
      );
      if (Number(n) + events.length - 1 > c.maxRows)
        throw new Error("queue_event_capacity");
      await tx.execute(
        sql`update onesa_outbox set payload=${JSON.stringify([events[0]])}::jsonb,state='pending',normalized=true where id=${r.id as number}`,
      );
      for (const event of events.slice(1))
        await tx.execute(
          sql`insert into onesa_outbox (source_id,equipment_id,payload,state,normalized,created_at) values (${event.eventId},${event.equipmentId},${JSON.stringify([event])}::jsonb,'pending',true,${new Date(r.created_at as string).toISOString()}::timestamptz) on conflict do nothing`,
        );
    } catch {
      await tx.execute(
        sql`update onesa_outbox set state='quarantine',error_code='normalization_or_mapping' where id=${r.id as number}`,
      );
      await tx.execute(
        sql`update onesa_installation set quarantined=quarantined+1,last_error='normalization_or_mapping'`,
      );
    }
  }
}
export async function retryQuarantine(actor: number) {
  const c = integrationConfig();
  if (!c) throw new Error("Integration is disabled");
  const db = await database();
  return db.transaction(async (tx) => {
    await ensureScope(tx, c);
    // Original normalized payloads retain their captured mapping. Only never-normalized
    // unmapped captures may take the now-approved mapping, with an audit entry.
    const records = await rows(
      tx,
      sql`select * from onesa_outbox where state='quarantine' and created_at>now()-(${c.retentionHours}*interval '1 hour') order by id limit 100 for update`,
    );
    for (const r of records) {
      let payload = r.payload;
      if (!r.normalized) {
        const p = payload as { sample: SourceSample };
        const [e] = await rows(
          tx,
          sql`select * from onesa_equipment where external_asset_id=${p.sample.assetId ?? ""} and device_id=${p.sample.deviceId}`,
        );
        payload = {
          ...p,
          registration: e?.registration ?? null,
          mapping: e?.mapping ?? null,
          version: e?.version ?? 0,
        };
      }
      await tx.execute(
        sql`update onesa_outbox set state=${r.normalized ? "pending" : "captured"},payload=${JSON.stringify(payload)}::jsonb,attempts=0,next_attempt=now(),error_code=null where id=${r.id as number}`,
      );
    }
    await tx.execute(
      sql`update onesa_outbox set next_attempt=now() where state='pending'`,
    );
    await tx.execute(
      sql`update onesa_installation set suspended=false,last_error=null`,
    );
    await tx.execute(
      sql`insert into onesa_audit (actor,action) values (${actor},'retry_and_resume')`,
    );
    return { retried: records.length };
  });
}
export async function status() {
  let c: Config | null;
  try {
    c = integrationConfig();
  } catch {
    return {
      state: "Not configured",
      schema: CONTRACT,
      compatibility: "proposed",
      error: "Invalid approved integration configuration",
    };
  }
  if (!c)
    return { state: "Disabled", schema: CONTRACT, compatibility: "proposed" };
  const db = await database();
  const s = await ensureScope(db, c);
  const counts = await rows<{ state: string; n: string }>(
    db,
    sql`select state,count(*) as n from onesa_outbox group by state`,
  );
  const equipment = await rows(
    db,
    sql`select * from onesa_equipment order by external_asset_id`,
  );
  const [last] = await rows(
    db,
    sql`select payload from onesa_outbox where normalized=true order by id desc limit 1`,
  );
  const events = (last?.payload ??
    []) as import("./contract").IntegrationEvent[];
  const backlog = counts
    .filter((r) => r.state !== "acknowledged")
    .reduce((n, r) => n + Number(r.n), 0);
  const ack = s.last_ack ? new Date(s.last_ack as string).getTime() : 0;
  const quarantined = counts.reduce(
    (n, r) => n + (r.state === "quarantine" ? Number(r.n) : 0),
    0,
  );
  const attention = await rows(
    db,
    sql`select distinct payload->'sample'->>'deviceId' as device_id,payload->'sample'->>'assetId' as asset_id,error_code from onesa_outbox where state='quarantine' and normalized=false limit 20`,
  );
  const state =
    s.suspended || s.last_error || quarantined
      ? "Error"
      : ack && backlog
        ? "Delayed"
        : ack
          ? "Connected"
          : "Connecting";
  return {
    state,
    schema: CONTRACT,
    compatibility: "proposed",
    destination: c.origin,
    workspaceId: c.workspaceId,
    installationId: c.installationId,
    lastAcknowledgment: s.last_ack as string | null,
    lastTransport: s.last_transport as string | null,
    backlog,
    counts,
    discarded: Number(s.discarded),
    captureFailures,
    error: (s.last_error ?? (quarantined ? "quarantined_records" : null)) as
      | string
      | null,
    quarantined,
    sourcesRequiringAttention: attention.map((r) => ({
      deviceId: String(r.device_id ?? "unknown"),
      assetId: String(r.asset_id ?? "unknown"),
      reason: String(r.error_code ?? "unknown"),
    })),
    sourceConnectivity: events[0]?.sourceConnection ?? "unknown",
    streamMode: events[0]?.mode ?? "unknown",
    telemetryFreshness: events[0] ? freshness(events[0]) : "unknown",
    transport: s.last_transport ? "HTTP response received" : "No response yet",
    consumerAcknowledgment: ack
      ? "Proposed contract receipt verified"
      : "No receipt",
    equipment: equipment.map((e) => ({
      equipmentId: e.equipment_id as string,
      registration: registrationSchema.parse(e.registration),
      mapping: e.mapping ? mappingSchema.parse(e.mapping) : null,
      version: Number(e.version),
      state: e.retired
        ? "retired"
        : e.mapping
          ? "mapped (proposed)"
          : "unmapped",
    })),
    artifactStatus: await artifactStatus(),
    twinLink: null,
    consumerRegistration: "unavailable",
  };
}

/** Classified adapter history, independent of the live dashboard projections. */
export async function history() {
  const db = await database();
  const entries = await rows(
    db,
    sql`select payload,state,error_code,acknowledged_at from onesa_outbox where normalized=true order by id desc limit 100`,
  );
  return entries.flatMap((r) =>
    (r.payload as import("./contract").IntegrationEvent[]).map((e) => ({
      eventId: e.eventId,
      equipmentId: e.equipmentId,
      componentId: e.componentId,
      observedAt: e.observedAt,
      mode: e.mode,
      scenarioRunId: e.scenarioRunId,
      replayRunId: e.replayRunId,
      sourceQuality: e.sourceQuality,
      kind: e.kind,
      metric: e.metric?.metricId ?? null,
      value: e.value,
      state: r.state as string,
      error: r.error_code as string | null,
    })),
  );
}
