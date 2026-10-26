import { individualSecurityUser } from "./users";
import type {
  FindingRecord,
  AuditRecord,
  EvidenceSnapshot,
  InventoryRecord,
  EventRecord,
} from "./models";
import { reserve } from "./quota";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  audit,
  enabled,
  database,
  rows,
  targetKey,
  validateTarget,
  ingestInTransaction,
  securityTransaction,
} from "./store";
import {
  SecurityError,
  sanitize,
  type RecordedEvidence,
  envelope,
  digest,
  canonical,
  utc,
  parseBatch,
} from "./contract";
import { parseReport } from "./reports";
import { finding } from "./rules";
export const filters = z
  .object({
    page: z.number().int().min(0).max(200).default(0),
    search: z.string().max(100).default(""),
    sourceId: z.uuid().optional(),
    mode: z.enum(["live", "simulated", "replay", "unknown"]).optional(),
    severity: z.enum(["critical", "high", "medium", "low"]).optional(),
    since: utc.optional(),
    status: z
      .enum([
        "open",
        "acknowledged",
        "investigating",
        "resolved",
        "accepted_risk",
        "dismissed",
      ])
      .optional(),
    targetKind: z.enum(["asset", "device", "application"]).optional(),
    targetId: z.number().int().positive().optional(),
  })
  .strict();
export type Filters = z.infer<typeof filters>;
export function scopeCondition(demo: boolean) {
  return demo ? sql`s.is_demo=true` : sql`true`;
}
function conditions(f: Filters, demo: boolean, kind: "events" | "findings") {
  const col = kind === "events" ? sql`e` : sql`f`;
  return sql`${scopeCondition(demo)} and (${f.since ?? null}::timestamptz is null or ${kind === "events" ? sql`e.ingested_at` : sql`f.last_seen`}>=${f.since ?? null}::timestamptz) and (${f.sourceId ?? null}::uuid is null or ${col}.source_id=${f.sourceId ?? null}) and (${f.mode ?? null}::text is null or ${col}.mode=${f.mode ?? null}) and (${f.targetKind ?? null}::text is null or ${col}.target->>'kind'=${f.targetKind ?? null}) and (${f.targetId ?? null}::text is null or ${col}.target->>'id'=${f.targetId?.toString() ?? null})`;
}
export async function overview(demo: boolean) {
  const db = await database(),
    visible = scopeCondition(demo);
  const counts = await rows(
    db,
    sql`select f.severity,count(*)::int as count from security_findings f join security_sources s on s.id=f.source_id where ${visible} and f.status not in ('resolved','dismissed','accepted_risk') group by severity`,
  );
  const modeCounts = await rows(
    db,
    sql`select f.mode,count(*)::int as count from security_findings f join security_sources s on s.id=f.source_id where ${visible} and f.status not in ('resolved','dismissed','accepted_risk') group by f.mode order by f.mode`,
  );
  const sources = await rows(
    db,
    sql`select id,name,active,policy,last_received_at,latest_event_at,created_at from security_sources s where ${visible} order by name limit 100`,
  );
  const freshness: Record<string, any>[] = sources.map((s) => ({
    ...s,
    state: !s.active
      ? "paused"
      : !s.policy.expectedIntervalSeconds
        ? "event-driven"
        : !s.last_received_at
          ? "missing"
          : Date.now() - new Date(s.last_received_at).getTime() >
              s.policy.expectedIntervalSeconds * 3000
            ? "stale"
            : "receiving",
  }));
  const activity = await rows(
    db,
    sql`select e.id,e.event_type,e.mode,e.quality,e.occurred_at,e.ingested_at from security_events e join security_sources s on s.id=e.source_id where ${visible} order by ingested_at desc limit 10`,
  );
  const [{ affected }] = await rows(
    db,
    sql`select count(distinct f.target::text)::int as affected from security_findings f join security_sources s on s.id=f.source_id where ${visible} and f.target is not null and f.condition_active=true`,
  );
  return {
    counts,
    modeCounts,
    sources: freshness.map((s) => ({
      id: String(s.id),
      name: String(s.name),
      active: Boolean(s.active),
      state: String(s.state),
      last_received_at: s.last_received_at as Date | string | null,
      latest_event_at: s.latest_event_at as Date | string | null,
      expectedIntervalSeconds: Number(s.policy.expectedIntervalSeconds),
    })),
    activity,
    affected,
    coverage: {
      configured: sources.length,
      receiving: freshness.filter((s) => s.state === "receiving").length,
      stale: freshness.filter((s) => ["stale", "missing"].includes(s.state))
        .length,
    },
    explanation:
      "Coverage denominator is configured security sources, not a percentage of secure assets. Receiving evidence does not prove secure controls. Priority is severity (0–4) plus reviewed criticality (0–2); confidence remains separate.",
  };
}
export async function events(
  f: Filters,
  demo: boolean,
  redacted: boolean,
): Promise<{ items: EventRecord[]; hasMore: boolean }> {
  const data = await rows<EventRecord>(
    await database(),
    sql`select e.*,s.name as source_name from security_events e join security_sources s on s.id=e.source_id where ${conditions(f, demo, "events")} and (${f.search}='' or position(lower(${f.search}) in lower(e.envelope->>'summary'))>0 or position(lower(${f.search}) in lower(e.event_type))>0) order by e.ingested_at desc,e.id limit 51 offset ${f.page * 50}`,
  );
  return {
    items: data.slice(0, 50).map((e) =>
      redacted
        ? {
            ...e,
            envelope: {
              eventType: e.event_type,
              summary: "Redacted security evidence",
              mode: e.mode,
              quality: e.quality,
            },
            fingerprint: undefined,
          }
        : e,
    ),
    hasMore: data.length > 50,
  };
}
export async function findings(f: Filters, demo: boolean, incidents = false) {
  const data = await rows<FindingRecord>(
    await database(),
    sql`select f.*,s.name as source_name,i.id as incident_id,i.assigned_to,u.name as assignee,p.criticality from security_findings f join security_sources s on s.id=f.source_id left join security_incidents i on i.finding_id=f.id left join users u on u.id=i.assigned_to left join security_posture p on p.target_key=concat(f.target->>'kind',':',coalesce(f.target->>'id','application')) where ${conditions(f, demo, "findings")} and (${f.severity ?? null}::text is null or f.severity=${f.severity ?? null}) and (${f.status ?? null}::text is null or f.status=${f.status ?? null}) and (${!incidents} or i.id is not null) and (${f.search}='' or position(lower(${f.search}) in lower(f.title))>0) order by f.last_seen desc,f.id limit 51 offset ${f.page * 50}`,
  );
  return {
    items: data.slice(0, 50).map((f) => ({
      ...f,
      priority:
        (
          { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as Record<
            string,
            number
          >
        )[f.severity] +
        ({ high: 2, medium: 1, low: 0, unknown: 0 } as Record<string, number>)[
          f.criticality ?? "unknown"
        ],
    })),
    hasMore: data.length > 50,
  };
}
export async function detail(id: string, demo: boolean, redacted: boolean) {
  const db = await database(),
    [f] = await rows<FindingRecord>(
      db,
      sql`select f.*,s.name as source_name,i.id as incident_id,i.assigned_to,u.name as assignee from security_findings f join security_sources s on s.id=f.source_id left join security_incidents i on i.finding_id=f.id left join users u on u.id=i.assigned_to where f.id=${id} and ${scopeCondition(demo)}`,
    );
  if (!f) throw new SecurityError(404, "finding_not_found");
  const evidence = redacted
    ? []
    : await rows<EvidenceSnapshot>(
        db,
        sql`select * from security_finding_evidence where finding_id=${id} order by created_at,event_id limit 104`,
      );
  const timeline = await rows<AuditRecord>(
    db,
    sql`select id,action,detail,created_at from security_audit where finding_id=${id} order by id desc limit 100`,
  );
  return {
    ...f,
    evidence,
    timeline: redacted
      ? timeline.map((v) => ({ ...v, detail: { redacted: true } }))
      : timeline,
    evidenceLimit: 104,
    additionalObservations: Math.max(0, f.occurrences - evidence.length),
  };
}
export async function sources(demo: boolean, admin: boolean) {
  const db = await database(),
    items = await rows(
      db,
      sql`select id,name,namespace,system_key,active,is_demo,policy,last_received_at,latest_event_at,last_error,created_at from security_sources s where ${scopeCondition(demo)} order by created_at limit 100`,
    );
  const rules = await rows(
    db,
    sql`select * from security_rules order by id,version desc limit 200`,
  );
  const baselines = await rows(
    db,
    sql`select b.* from security_baselines b join security_sources s on s.id=b.source_id where ${scopeCondition(demo)} order by created_at desc limit 100`,
  );
  const limits = admin
    ? (
        await rows(db, sql`select * from security_usage where singleton=true`)
      )[0]
    : null;
  const imports = await rows(
    db,
    sql`select i.id,i.source_id,i.original_sha256,i.producer_version,i.produced_at,i.target,i.provenance,i.processing_cursor,i.processing_attempts,i.next_attempt,i.processing_state,i.last_error,i.created_at from security_imports i join security_sources s on s.id=i.source_id where ${scopeCondition(demo)} order by i.created_at desc limit 100`,
  );
  const mappings = admin
    ? await rows(
        db,
        sql`select m.* from security_mappings m join security_sources s on s.id=m.source_id where ${scopeCondition(demo)} order by reviewed_at desc limit 100`,
      )
    : [];
  return {
    limits,
    imports,
    mappings,
    items: items.map((s) =>
      admin
        ? s
        : {
            ...s,
            policy: {
              targets: s.policy.targets,
              modes: s.policy.modes,
              types: s.policy.types,
              expectedIntervalSeconds: s.policy.expectedIntervalSeconds,
            },
          },
    ),
    rules: admin ? rules : rules.map(({ actor_id, ...r }) => r),
    baselines: admin
      ? baselines
      : baselines.map(({ proposed_by, approved_by, ...b }) => b),
  };
}
export async function posture(demo: boolean, redacted = false) {
  const db = await database();
  const inventory = await rows<InventoryRecord>(
    db,
    sql`select 'asset' as kind,id,"assetId" as external_id,name,zone,null::text as firmware_version from assets where (${demo}=false or "isDemo"=true) union all select 'device',id,"deviceId",name,zone,"firmwareVersion" from devices where (${demo}=false or "isDemo"=true) order by kind,id limit 1000`,
  );
  const connections = await rows(
    db,
    sql`select ad.id,ad."assetId" as asset_id,ad."deviceId" as device_id,ad.protocol,ad."createdAt" as declared_at,case when lower(coalesce(ad.endpoint,'')) like 'mqtts://%' or lower(coalesce(ad.endpoint,'')) like 'https://%' then 'TLS endpoint scheme declared; runtime unverified' when lower(coalesce(ad.endpoint,'')) like 'mqtt://%' or lower(coalesce(ad.endpoint,'')) like 'http://%' then 'plaintext endpoint scheme declared; path protection unknown' else 'transport security unknown' end as transport_declaration from asset_devices ad join assets a on a.id=ad."assetId" where (${demo}=false or a."isDemo"=true) order by ad.id limit 5000`,
  );
  const reviewed = await rows(
    db,
    sql`select * from security_posture limit 1000`,
  );
  const observations = await rows(
    db,
    sql`select distinct on(e.target::text,e.event_type) e.target,e.event_type,e.mode,e.quality,e.occurred_at,e.ingested_at,e.envelope->'attributes' as fact,e.clock_skew from security_events e join security_sources s on s.id=e.source_id where ${scopeCondition(demo)} and e.target is not null order by e.target::text,e.event_type,e.occurred_at desc limit 5000`,
  );
  const affected = await findings(filters.parse({}), demo);
  const inventories = await rows(
    db,
    sql`select i.id,i.target,i.provenance,i.producer_version,i.produced_at,i.created_at,i.original_sha256,i.report from security_imports i join security_sources s on s.id=i.source_id where ${scopeCondition(demo)} order by i.created_at desc limit 100`,
  );
  return {
    items: inventory.map((i) => {
      const t = { kind: i.kind, id: i.id },
        r = reviewed.find((p) => p.target_key === targetKey(t));
      return {
        ...i,
        review: r ?? null,
        declaredConnections: connections
          .filter((c) =>
            i.kind === "asset" ? c.asset_id === i.id : c.device_id === i.id,
          )
          .map((c) => ({
            ...c,
            authentication:
              "unknown; no independently verified authentication control",
          })),
        criticality: r?.criticality ?? "unknown",
        inventories: inventories
          .filter((r) => targetKey(r.target) === targetKey(t))
          .slice(0, 5)
          .map((r) => ({
            id: r.id,
            mode: r.provenance.mode,
            producedAt: r.produced_at,
            producerVersion: r.producer_version,
            sha256: r.original_sha256,
            packages: r.report.Results.flatMap((v: any) =>
              v.Vulnerabilities.map((p: any) => ({
                name: p.PkgName,
                version: p.InstalledVersion,
              })),
            ).slice(0, 20),
          })),
        versionBasis: i.firmware_version
          ? "declared registry value"
          : "unknown",
        observations: observations
          .filter((o) => targetKey(o.target) === targetKey(t))
          .map((o) => (redacted ? { ...o, fact: { redacted: true } } : o)),
        findings: affected.items.filter(
          (f) => f.target && targetKey(f.target) === targetKey(t),
        ),
      };
    }),
    scopeNote:
      "Registry firmware/zone values are declarations. Runtime facts retain their source, quality, mode and time. Missing control/version evidence is unknown; no Secure score is computed.",
  };
}
export const actionInput = z
  .object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    action: z.enum([
      "acknowledge",
      "assign",
      "investigate",
      "note",
      "resolve",
      "accept_risk",
      "dismiss",
    ]),
    reason: z.string().trim().min(5).max(2000),
    assignee: z.number().int().positive().optional(),
    riskUntil: utc.optional(),
    evidenceIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict();
export async function act(
  input: z.infer<typeof actionInput>,
  actor: { id: number; role: string },
) {
  const db = await database();
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [f] = await rows(
      tx,
      sql`select * from security_findings where id=${input.id} for update`,
    );
    if (!f) throw new SecurityError(404, "finding_not_found");
    if (f.version !== input.expectedVersion)
      throw new SecurityError(409, "investigation_version_conflict");
    let [incident] = await rows(
      tx,
      sql`select * from security_incidents where finding_id=${input.id}`,
    );
    const admin = actor.role === "admin",
      engineer = actor.role === "engineer";
    if (input.action !== "acknowledge" && !admin && !engineer)
      throw new SecurityError(403, "engineering_access_required");
    if (input.action === "accept_risk" && !admin)
      throw new SecurityError(403, "risk_acceptance_requires_admin");
    if (!incident) {
      incident = { id: randomUUID(), assigned_to: engineer ? actor.id : null };
      await tx.execute(
        sql`insert into security_incidents(id,finding_id,assigned_to) values(${incident.id},${input.id},${incident.assigned_to})`,
      );
    }
    if (
      !admin &&
      engineer &&
      input.action !== "acknowledge" &&
      incident.assigned_to !== actor.id
    )
      throw new SecurityError(403, "assigned_engineer_required");
    if (input.action === "assign") {
      const assignee = input.assignee ?? actor.id;
      if (!admin && assignee !== actor.id)
        throw new SecurityError(403, "self_assignment_only");
      if (
        !(
          await rows(
            tx,
            sql`select id from users where id=${assignee} and role in ('engineer','admin') and ${individualSecurityUser()}`,
          )
        ).length
      )
        throw new SecurityError(422, "invalid_assignee");
      await tx.execute(
        sql`update security_incidents set assigned_to=${assignee} where id=${incident.id}`,
      );
    }
    for (const eventId of input.evidenceIds)
      if (
        !(
          await rows(
            tx,
            sql`select event_id from security_finding_evidence where finding_id=${input.id} and event_id=${eventId}`,
          )
        ).length
      )
        throw new SecurityError(422, "evidence_outside_finding");
    if (input.action === "resolve" && !input.evidenceIds.length)
      throw new SecurityError(422, "resolution_requires_evidence_reference");
    if (
      input.action === "accept_risk" &&
      (!input.riskUntil ||
        Date.parse(input.riskUntil) <= Date.now() ||
        Date.parse(input.riskUntil) > Date.now() + 30 * 86400000)
    )
      throw new SecurityError(422, "risk_expiry_must_be_within_30_days");
    if (
      ["resolved", "dismissed", "accepted_risk"].includes(f.status) &&
      ["acknowledge", "investigate", "resolve", "dismiss"].includes(
        input.action,
      )
    )
      throw new SecurityError(
        409,
        "closed_investigation_requires_new_evidence",
      );
    const state =
      (
        {
          acknowledge: "acknowledged",
          investigate: "investigating",
          resolve: "resolved",
          accept_risk: "accepted_risk",
          dismiss: "dismissed",
        } as Record<string, string>
      )[input.action] ?? f.status;
    await tx.execute(
      sql`update security_findings set status=${state},risk_until=${input.action === "accept_risk" ? input.riskUntil : state === "accepted_risk" ? f.risk_until : null},version=version+1 where id=${input.id}`,
    );
    await audit(
      tx,
      `investigation_${input.action}`,
      actor.id,
      {
        reason: sanitize(input.reason),
        evidenceIds: input.evidenceIds,
        assignee: input.assignee ?? null,
        status: state,
        conditionRemainsActive: f.condition_active,
        riskUntil: input.riskUntil ?? null,
      },
      input.id,
      f.source_id,
    );
    return { id: input.id, status: state, version: f.version + 1 };
  });
}
export async function reviewPosture(
  input: {
    target: { kind: string; id: number | null };
    zone: string;
    criticality: string;
    reason: string;
  },
  actor: number,
) {
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    await validateTarget(tx, input.target);
    await tx.execute(
      sql`insert into security_posture(target_key,target,zone,criticality,reason,reviewed_by) values(${targetKey(input.target)},${JSON.stringify(input.target)}::jsonb,${sanitize(input.zone)},${input.criticality},${sanitize(input.reason)},${actor}) on conflict(target_key) do update set zone=excluded.zone,criticality=excluded.criticality,reason=excluded.reason,reviewed_by=excluded.reviewed_by,reviewed_at=now()`,
    );
    await audit(tx, "posture_reviewed", actor, {
      ...input,
      zone: sanitize(input.zone),
      reason: sanitize(input.reason),
    });
  });
  return { reviewed: true };
}
export async function importReport(
  raw: string,
  sourceId: string,
  target: { kind: string; id: number | null },
  actor: number,
  provenance: {
    mode: "live" | "simulated" | "replay" | "unknown";
    producerVersion: string;
    runId?: string;
  },
) {
  if (!enabled()) throw new SecurityError(503, "security_disabled");
  const parsed = parseReport(raw),
    db = await database();
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [s] = await rows(
      tx,
      sql`select * from security_sources where id=${sourceId} and active=true and is_demo=false and system_key is null for update`,
    );
    if (
      !s ||
      !s.policy.types.includes("software.inventory_observed") ||
      !s.policy.targets.some((t: any) => canonical(t) === canonical(target))
    )
      throw new SecurityError(403, "import_outside_source_scope");
    await validateTarget(tx, target);
    const [prior] = await rows(
      tx,
      sql`select id,target,provenance from security_imports where source_id=${sourceId} and original_sha256=${parsed.sha256}`,
    );
    if (prior) {
      if (
        canonical(prior.target) !== canonical(target) ||
        canonical(prior.provenance) !== canonical(provenance)
      )
        throw new SecurityError(409, "report_context_conflict");
      return { id: prior.id, duplicate: true };
    }
    const [{ count, bytes }] = await rows(
      tx,
      sql`select count(*)::int as count,coalesce(sum(bytes),0)::bigint as bytes from security_imports`,
    );
    if (count >= 100 || Number(bytes) + parsed.bytes > 64 * 1024 * 1024)
      throw new SecurityError(429, "import_capacity");
    await reserve(tx, parsed.bytes + 512, 0, 1);
    const id = randomUUID();
    const [rule] = await rows(
      tx,
      sql`select * from security_rules where id='reported-vulnerability' and active=true`,
    );
    const common = {
      producerNamespace: s.namespace,
      sourceEventId: `inventory-${id}`,
      occurredAt: parsed.report.CreatedAt,
      eventType: "software.inventory_observed" as const,
      assetRef: null,
      summary: "A reviewed Trivy inventory report was imported.",
      quality: "uncertain" as const,
      producerVersion: provenance.producerVersion,
      attributes: { inventoryRef: id, sha256: parsed.sha256 },
    };
    if (
      provenance.mode !== "unknown" &&
      !s.policy.modes.includes(provenance.mode)
    )
      throw new SecurityError(403, "import_mode_outside_source_scope");
    const e: RecordedEvidence =
      provenance.mode === "unknown"
        ? {
            ...common,
            schemaVersion: "smart-factory-import/v1",
            mode: "unknown",
          }
        : envelope.parse({
            ...common,
            schemaVersion: "ot-security-evidence/v1",
            mode: provenance.mode,
            scenarioRunId:
              provenance.mode === "simulated" ? provenance.runId : undefined,
            replayRunId:
              provenance.mode === "replay" ? provenance.runId : undefined,
          });
    const event = {
      id: randomUUID(),
      envelope: e,
      target,
      installed_component_id: null,
      clock_skew: Date.parse(parsed.report.CreatedAt) > Date.now() + 300000,
    };
    if (e.mode !== "unknown") {
      await ingestInTransaction(tx, sourceId, [e], target);
      const [stored] = await rows(
        tx,
        sql`select id from security_events where source_id=${sourceId} and source_event_id=${e.sourceEventId}`,
      );
      event.id = stored.id;
    }
    await tx.execute(
      sql`insert into security_imports(id,source_id,original_sha256,producer_version,produced_at,target,report,provenance,matching_method,actor_id,bytes,rule_version,event_snapshot,evidence_id,processing_state) values(${id},${sourceId},${parsed.sha256},${provenance.producerVersion},${parsed.report.CreatedAt},${JSON.stringify(target)}::jsonb,${JSON.stringify(parsed.report)}::jsonb,${JSON.stringify(provenance)}::jsonb,'reviewed_artifact_scope; scanner-reported package/version',${actor},${parsed.bytes},${rule.version},${JSON.stringify(e)}::jsonb,${event.id},${event.clock_skew ? "clock_skew" : rule.settings.enabled ? "queued" : "policy_disabled"})`,
    );
    await audit(
      tx,
      "report_imported",
      actor,
      {
        id,
        sha256: parsed.sha256,
        target,
        matchingMethod: "reviewed_artifact_scope",
      },
      null,
      sourceId,
    );
    return { id, duplicate: false, clockSkew: event.clock_skew };
  });
}
export async function importEvidence(
  raw: string,
  ndjson: boolean,
  sourceId: string,
  actor: number,
) {
  const batch = parseBatch(Buffer.from(raw, "utf8"), ndjson);
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [source] = await rows(
      tx,
      sql`select id from security_sources where id=${sourceId} and active=true and system_key is null and is_demo=false`,
    );
    if (!source)
      throw new SecurityError(403, "reviewed_import_source_required");
    const result = await ingestInTransaction(tx, sourceId, batch);
    await audit(
      tx,
      "evidence_file_imported",
      actor,
      {
        accepted: result.accepted.length,
        duplicate: result.accepted.filter((e) => e.status === "duplicate")
          .length,
      },
      null,
      sourceId,
    );
    return result;
  });
}
export async function exportEvents(
  f: Filters,
  demo: boolean,
  format: "json" | "ndjson" | "csv",
) {
  const page = await events(f, demo, false),
    eligible = page.items.filter(
      (e) =>
        e.association !== "unmapped" &&
        e.mode !== "unknown" &&
        e.envelope.schemaVersion === "ot-security-evidence/v1",
    );
  const values = eligible.map((e) => envelope.parse(e.envelope)),
    cell = (s: unknown) =>
      '"' +
      String(s ?? "")
        .replace(/^[=+\-@\t\r]/, "'$&")
        .replaceAll('"', '""') +
      '"';
  const body =
    format === "csv"
      ? [
          "sourceEventId,eventType,occurredAt,mode,quality,summary",
          ...values.map((e) =>
            [
              e.sourceEventId,
              e.eventType,
              e.occurredAt,
              e.mode,
              e.quality,
              e.summary,
            ]
              .map(cell)
              .join(","),
          ),
        ].join("\n")
      : format === "ndjson"
        ? values.map((v) => JSON.stringify(v)).join("\n")
        : JSON.stringify({ events: values }, null, 2);
  return {
    body,
    omitted: page.items.length - values.length,
    hasMore: page.hasMore,
    reason:
      "Unreviewed mappings, unknown provenance and application-specific extensions are omitted from strict v1 export.",
    format,
  };
}
export async function purgeExpired(actor: number, reason: string) {
  const db = await database();
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const deleted = await rows(
      tx,
      sql`delete from security_events where id in(select id from security_events where expires_at<now() order by expires_at limit 1000) returning id,bytes`,
    );
    await tx.execute(
      sql`update security_usage set bytes=greatest(0,bytes-${deleted.reduce((n, e) => n + e.bytes + 512, 0)}),events=greatest(0,events-${deleted.length}) where singleton=true`,
    );
    await audit(tx, "expired_evidence_purged", actor, {
      count: deleted.length,
      reason: sanitize(reason),
      findingSnapshotsRetained: true,
    });
    return { deleted: deleted.length };
  });
}

export async function equipmentOverlay(id: string, demo: boolean) {
  const db = await database(),
    [equipment] = await rows(
      db,
      sql`select id,asset_id,components from equipment_workspaces where id=${id} and (${demo}=false or is_demo=true)`,
    );
  if (!equipment) throw new SecurityError(404, "equipment_not_found");
  const mappedFindings = await rows<FindingRecord>(
    db,
    sql`select f.* from security_findings f join security_sources s on s.id=f.source_id where ${scopeCondition(demo)} and f.target->>'kind'='asset' and f.target->>'id'=${String(equipment.asset_id)} and f.installed_component_id is not null order by f.last_seen desc,f.id limit 201`,
  );
  const [{ unmapped }] = await rows(
    db,
    sql`select count(*)::int as unmapped from security_findings f join security_sources s on s.id=f.source_id where ${scopeCondition(demo)} and f.target->>'kind'='asset' and f.target->>'id'=${String(equipment.asset_id)} and f.installed_component_id is null`,
  );
  const componentIds = new Set(
    equipment.components.map((p: any) => p.installedComponentId),
  );
  return {
    assetId: equipment.asset_id,
    truncated: mappedFindings.length > 200,
    mapped: mappedFindings
      .slice(0, 200)
      .filter(
        (f) =>
          f.installed_component_id &&
          componentIds.has(f.installed_component_id),
      )
      .map((f) => ({
        id: f.id,
        title: f.title,
        componentId: f.installed_component_id!,
        mode: f.mode,
        severity: f.severity,
        status: f.status,
      })),
    unmapped,
  };
}
export async function equipmentForFinding(id: string, demo: boolean) {
  const d = await detail(id, demo, true);
  if (!d.installed_component_id || d.target?.kind !== "asset") return null;
  const [e] = await rows(
    await database(),
    sql`select id from equipment_workspaces where asset_id=${d.target.id} and (${demo}=false or is_demo=true) and exists(select 1 from jsonb_array_elements(components) p where p->>'installedComponentId'=${d.installed_component_id})`,
  );
  return e
    ? { equipmentId: String(e.id), componentId: d.installed_component_id }
    : null;
}

export async function observeCertificate(
  input: {
    sourceId: string;
    endpointRef: string;
    pem: string;
    mode: "live" | "simulated" | "replay";
    runId?: string;
  },
  actor: number,
) {
  if (/PRIVATE\s+KEY/i.test(input.pem) || Buffer.byteLength(input.pem) > 65536)
    throw new SecurityError(422, "public_certificate_only");
  let certificate: import("node:crypto").X509Certificate;
  try {
    const { X509Certificate } = await import("node:crypto");
    certificate = new X509Certificate(input.pem);
  } catch {
    throw new SecurityError(422, "invalid_public_certificate");
  }
  const db = await database();
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [s] = await rows(
      tx,
      sql`select * from security_sources where id=${input.sourceId} and active=true and is_demo=false and system_key is null`,
    );
    if (!s || !s.policy.connections?.includes(input.endpointRef))
      throw new SecurityError(422, "connection_reference_unreviewed");
    const e = envelope.parse({
      schemaVersion: "ot-security-evidence/v1",
      producerNamespace: s.namespace,
      sourceEventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      mode: input.mode,
      scenarioRunId: input.mode === "simulated" ? input.runId : undefined,
      replayRunId: input.mode === "replay" ? input.runId : undefined,
      eventType: "tls.certificate_observed",
      assetRef: null,
      summary:
        "A user supplied a public certificate for an explicitly configured connection reference. Connection trust is unverified.",
      quality: "good",
      producerVersion: "smart-factory-public-certificate-parser-1",
      attributes: {
        endpointRef: input.endpointRef,
        notBefore: new Date(certificate.validFrom).toISOString(),
        notAfter: new Date(certificate.validTo).toISOString(),
        fingerprintSha256: certificate.fingerprint256
          .replaceAll(":", "")
          .toLowerCase(),
      },
    });
    const result = await ingestInTransaction(tx, s.id, [e]);
    await audit(
      tx,
      "public_certificate_observed",
      actor,
      {
        endpointRef: input.endpointRef,
        fingerprintSha256: e.attributes.fingerprintSha256,
        mode: input.mode,
      },
      null,
      s.id,
    );
    return result;
  });
}
export async function reportDetail(
  id: string,
  demo: boolean,
  redacted: boolean,
) {
  const [r] = await rows(
    await database(),
    sql`select i.* from security_imports i join security_sources s on s.id=i.source_id where i.id=${id} and ${scopeCondition(demo)}`,
  );
  if (!r) throw new SecurityError(404, "report_not_available");
  return redacted
    ? {
        id: r.id,
        sha256: r.original_sha256,
        target: r.target,
        provenance: r.provenance,
        producerVersion: r.producer_version,
        producedAt: r.produced_at,
        ingestedAt: r.created_at,
        matchingMethod: r.matching_method,
        report: { redacted: true },
      }
    : {
        id: r.id,
        sha256: r.original_sha256,
        target: r.target,
        provenance: r.provenance,
        producerVersion: r.producer_version,
        producedAt: r.produced_at,
        ingestedAt: r.created_at,
        matchingMethod: r.matching_method,
        report: r.report,
        processingState: r.processing_state,
        processedCandidates: r.processing_cursor,
        ruleVersion: r.rule_version,
      };
}
export async function retention(days: number, reason: string, actor: number) {
  const db = await database();
  await securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [before] = await rows(
      tx,
      sql`select retention_days from security_usage where singleton=true`,
    );
    await tx.execute(
      sql`update security_usage set retention_days=${days} where singleton=true`,
    );
    await audit(tx, "future_evidence_retention_changed", actor, {
      previous: before.retention_days,
      days,
      reason: sanitize(reason),
      existingExpiryUnchanged: true,
    });
  });
  return { days };
}

export async function retryReport(id: string, reason: string, actor: number) {
  return securityTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(2026102702)`);
    const [r] = await rows(
      tx,
      sql`update security_imports set processing_state='queued',processing_attempts=0,next_attempt=now(),last_error=null where id=${id} and processing_state in ('failed','quarantined') returning source_id`,
    );
    if (!r) throw new SecurityError(404, "quarantined_report_required");
    await audit(
      tx,
      "report_retry_authorized",
      actor,
      { id, reason: sanitize(reason) },
      null,
      r.source_id,
    );
    return { queued: true };
  });
}
