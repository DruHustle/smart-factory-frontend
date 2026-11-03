import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAlertById, getDb, visibleAlertEntitiesCondition } from "../db";
import { demoOnlyRead } from "../demoData";
import { inventoryItemsByRefs } from "../inventory";
import { incidentFactoryCondition } from "../incidentFactoryScope";
import {
  analyseProduction,
  defaultOperationsConfiguration,
  operationsConfiguration,
  productionPeriod,
  resolveShift,
  siteTimeZone,
  type HandoverNote,
  type OperationScenario,
  type OperationsConfiguration,
  type OperationsSummary,
  type ProductionRecord,
  type ProductionPeriod,
} from "../../shared/operations";
import { demoOperations } from "./demo";

type Actor = { id: number; name: string | null };
type Scope = { factoryId?: string };
type Queryable = { execute: (...args: any[]) => Promise<any> };
const actorName = (actor: Actor) =>
  (actor.name?.trim() || `Account ${actor.id}`).slice(0, 320);
const scopeKey = (input: Scope) => input.factoryId ?? "installation";
const timezoneKey = (scope: string) => `ot-timezone:${scope}`;
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        "Operations storage is unavailable. Your unsaved input is retained.",
    });
  return db;
}
async function validateScope(db: Queryable, input: Scope) {
  if (!input.factoryId) return "Installation";
  const [factory] = await db.execute(
    sql`select name from factories where id=${input.factoryId}::uuid`,
  );
  if (!factory)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The selected factory is unavailable.",
    });
  return String(factory.name);
}
function requireOperationalWrite() {
  if (demoOnlyRead())
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Recorded scenarios are read-only. Select Live data for operational records.",
    });
}
async function configuration(db: Queryable, scope: string) {
  const [row] = await db.execute(
    sql`select configuration,version from ot_operations_configuration where scope=${scope}`,
  );
  return row
    ? {
        configuration: operationsConfiguration.parse(row.configuration),
        version: Number(row.version),
      }
    : null;
}
async function provisionalTimeZone(db: Queryable, scope: string) {
  const [row] = await db.execute(
    sql`select value from system_settings where key=${timezoneKey(scope)}`,
  );
  return row
    ? siteTimeZone.parse(row.value)
    : defaultOperationsConfiguration.timeZone;
}
async function audit(
  db: Queryable,
  scope: string,
  kind: string,
  detail: unknown,
  actor: Actor,
) {
  await db.execute(
    sql`insert into ot_operations_activity(scope,kind,detail,actor_id,actor_name) values(${scope},${kind},${JSON.stringify(detail)}::jsonb,${actor.id},${actorName(actor)})`,
  );
}
export async function operationsSummary(
  input: Scope & {
    at?: number;
    startTime?: number;
    endTime?: number;
    scenario?: OperationScenario;
  },
): Promise<OperationsSummary> {
  const db = await database();
  if (demoOnlyRead()) {
    const [showcase] = await db.execute(
      sql`select value from system_settings where key='showcase_v1'`,
    );
    return demoOperations(
      input.scenario ?? "healthy",
      (showcase?.value as import("../../shared/showcase").Showcase) ?? null,
      input.startTime != null && input.endTime != null
        ? { startTime: input.startTime, endTime: input.endTime }
        : undefined,
    );
  }
  const label = await validateScope(db, input),
    scope = scopeKey(input),
    saved = await configuration(db, scope);
  const config = saved?.configuration ?? {
    ...defaultOperationsConfiguration,
    timeZone: await provisionalTimeZone(db, scope),
    boundaryLabel: label,
  };
  const at = input.at ?? Date.now(),
    shift = resolveShift(config, at),
    startTime = input.startTime ?? shift.startTime,
    endTime = input.endTime ?? Math.min(shift.endTime, Date.now());
  const rows = await db.execute(
    sql`select id,input,boundary_label as "boundaryLabel",author_name as author,created_at as "recordedAt" from ot_production_periods where scope=${scope} and start_time<${new Date(endTime).toISOString()}::timestamptz and end_time>${new Date(startTime).toISOString()}::timestamptz order by start_time,id limit 1001`,
  );
  if (rows.length > 1000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Select a shorter period to inspect more than 1,000 production records without truncating the totals.",
    });
  const records: ProductionRecord[] = rows.map((row: any) => ({
    ...productionPeriod.parse(row.input),
    id: Number(row.id),
    boundaryLabel: String(row.boundaryLabel),
    author: String(row.author),
    recordedAt: new Date(row.recordedAt).toISOString(),
    provenance: "manual" as const,
  }));
  const prior = resolveShift(config, shift.startTime - 1);
  const noteRows = await db.execute(
    sql`select id,shift_key as "shiftKey",shift_start as "shiftStartTime",shift_end as "shiftEndTime",shift_name as "shiftName",time_zone as "timeZone",text,next_step as "nextStep",asset_refs as "assetRefs",incident_ids as "incidentIds",author_name as author,created_at as "createdAt" from ot_shift_handover where scope=${scope} and shift_start<${new Date(shift.endTime).toISOString()}::timestamptz and shift_end>${new Date(prior.startTime).toISOString()}::timestamptz order by id desc limit 51`,
  );
  const notes: HandoverNote[] = noteRows.slice(0, 50).map((n: any) => ({
    ...n,
    id: Number(n.id),
    shiftStartTime: new Date(n.shiftStartTime).getTime(),
    shiftEndTime: new Date(n.shiftEndTime).getTime(),
    createdAt: new Date(n.createdAt).toISOString(),
  }));
  const outstanding = await db.execute(
    sql`select a.id,a.alert_id as "incidentId",a.title,u.name as owner,a.due_date::text as "dueDate",a.status from incident_actions a join alerts on alerts.id=a.alert_id left join users u on u.id=a.owner_id where a.status in ('open','in_progress') and ${visibleAlertEntitiesCondition()} and ${incidentFactoryCondition(input.factoryId)} order by a.due_date asc nulls last,a.id desc limit 20`,
  );
  return {
    scope: { id: scope, label },
    configured: !!saved,
    configuration: config,
    version: saved?.version ?? 0,
    demo: false,
    shift,
    analysis: analyseProduction(
      records,
      startTime,
      endTime,
      config.boundaryLabel,
    ),
    records,
    notes,
    notesHasMore: noteRows.length > 50,
    outstanding: outstanding as unknown as OperationsSummary["outstanding"],
    evidence: null,
  };
}

export async function configureOperations(
  input: Scope & {
    expectedVersion: number;
    expectedTimeZone?: string;
    configuration: OperationsConfiguration;
  },
  actor: Actor,
) {
  requireOperationalWrite();
  const config = operationsConfiguration.parse(input.configuration),
    db = await database(),
    scope = scopeKey(input);
  return db.transaction(async (tx) => {
    await validateScope(tx, input);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ot-operations:${scope}`}))`,
    );
    const current = await configuration(tx, scope);
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Shift settings changed. Refresh before saving your changes.",
      });
    if (
      !current &&
      input.expectedTimeZone !== undefined &&
      (await provisionalTimeZone(tx, scope)) !== input.expectedTimeZone
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The site timezone changed. Refresh before saving your changes.",
      });
    const [row] = await tx.execute(
      sql`insert into ot_operations_configuration(scope,configuration,updated_by) values(${scope},${JSON.stringify(config)}::jsonb,${actor.id}) on conflict(scope) do update set configuration=excluded.configuration,version=ot_operations_configuration.version+1,updated_by=excluded.updated_by,updated_at=now() returning version`,
    );
    await audit(
      tx,
      scope,
      "configuration",
      {
        before: current?.configuration ?? null,
        after: config,
        version: Number(row.version),
      },
      actor,
    );
    return { version: Number(row.version) };
  });
}

/** Update the shared timezone without treating provisional shifts as commissioned. */
export async function setOperationsTimeZone(
  input: Scope & {
    expectedVersion: number;
    expectedTimeZone: string;
    timeZone: string;
  },
  actor: Actor,
) {
  requireOperationalWrite();
  const timeZone = siteTimeZone.parse(input.timeZone),
    db = await database(),
    scope = scopeKey(input);
  return db.transaction(async (tx) => {
    await validateScope(tx, input);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ot-operations:${scope}`}))`,
    );
    const current = await configuration(tx, scope);
    const before =
      current?.configuration.timeZone ?? (await provisionalTimeZone(tx, scope));
    if (
      (current?.version ?? 0) !== input.expectedVersion ||
      before !== input.expectedTimeZone
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Shift settings changed. Refresh before changing the timezone.",
      });
    if (before === timeZone) return { version: current?.version ?? 0 };
    let version = current?.version ?? 0;
    if (current) {
      const config = operationsConfiguration.parse({
        ...current.configuration,
        timeZone,
      });
      const [row] = await tx.execute(
        sql`update ot_operations_configuration set configuration=${JSON.stringify(config)}::jsonb,version=version+1,updated_by=${actor.id},updated_at=now() where scope=${scope} returning version`,
      );
      version = Number(row.version);
    } else {
      await tx.execute(
        sql`insert into system_settings(key,value,"updatedBy") values(${timezoneKey(scope)},${JSON.stringify(timeZone)}::jsonb,${actor.id}) on conflict(key) do update set value=excluded.value,"updatedBy"=excluded."updatedBy","updatedAt"=now()`,
      );
    }
    await audit(
      tx,
      scope,
      "timezone",
      { before, after: timeZone, version },
      actor,
    );
    return { version };
  });
}

export async function recordProduction(
  input: Scope & { expectedVersion: number; period: ProductionPeriod },
  actor: Actor,
  now = Date.now(),
) {
  requireOperationalWrite();
  const period = productionPeriod.parse(input.period),
    db = await database(),
    scope = scopeKey(input);
  if (period.endTime > now + 60000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Record observed production periods; future production cannot be entered as evidence.",
    });
  return db.transaction(async (tx) => {
    await validateScope(tx, input);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ot-operations:${scope}`}))`,
    );
    const saved = await configuration(tx, scope);
    if (!saved || saved.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Configure the production boundary and refresh its latest settings before recording a period.",
      });
    const [overlap] = await tx.execute(
      sql`select id from ot_production_periods where scope=${scope} and start_time<${new Date(period.endTime).toISOString()}::timestamptz and end_time>${new Date(period.startTime).toISOString()}::timestamptz limit 1`,
    );
    if (overlap)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This period overlaps an existing production record. Choose a separate interval; recorded evidence is never silently overwritten.",
      });
    const [row] = await tx.execute(
      sql`insert into ot_production_periods(scope,start_time,end_time,boundary_label,input,created_by,author_name) values(${scope},${new Date(period.startTime).toISOString()}::timestamptz,${new Date(period.endTime).toISOString()}::timestamptz,${saved.configuration.boundaryLabel},${JSON.stringify(period)}::jsonb,${actor.id},${actorName(actor)}) returning id`,
    );
    await audit(
      tx,
      scope,
      "production_recorded",
      {
        id: Number(row.id),
        startTime: period.startTime,
        endTime: period.endTime,
        provenance: "manual",
      },
      actor,
    );
    return { id: Number(row.id) };
  });
}

export async function addHandover(
  input: Scope & {
    expectedVersion: number;
    at: number;
    text: string;
    nextStep: string;
    assetRefs: string[];
    incidentIds: number[];
  },
  actor: Actor,
) {
  requireOperationalWrite();
  const db = await database(),
    scope = scopeKey(input);
  await validateScope(db, input);
  const saved = await configuration(db, scope);
  if (!saved || saved.version !== input.expectedVersion)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Shift settings changed. Refresh before recording this handover.",
    });
  const inventory = input.assetRefs.length
    ? await inventoryItemsByRefs(input.assetRefs)
    : [];
  if (
    inventory.length !== input.assetRefs.length ||
    inventory.some((i) => i.isDemo)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "A linked item is unavailable in the operational workspace.",
    });
  for (const id of input.incidentIds) {
    const incident = await getAlertById(id);
    if (!incident)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "A linked incident is unavailable.",
      });
    if (input.factoryId) {
      const [member] = await db.execute(
        sql`select id from alerts where alerts.id=${id} and ${incidentFactoryCondition(input.factoryId)}`,
      );
      if (!member)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "The incident does not belong to this factory.",
        });
    }
  }
  if (input.factoryId && input.assetRefs.length) {
    const members = await db.execute(
      sql`select ref from factory_items where factory_id=${input.factoryId}::uuid and ref in (${sql.join(
        input.assetRefs.map((ref) => sql`${ref}`),
        sql`,`,
      )})`,
    );
    if (members.length !== input.assetRefs.length)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "A linked item does not belong to this factory.",
      });
  }
  const shift = resolveShift(saved.configuration, input.at);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ot-operations:${scope}`}))`,
    );
    const current = await configuration(tx, scope);
    if (current?.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Shift settings changed while recording this handover. Refresh and try again.",
      });
    const [row] = await tx.execute(
      sql`insert into ot_shift_handover(scope,shift_key,shift_start,shift_end,shift_name,time_zone,text,next_step,asset_refs,incident_ids,created_by,author_name) values(${scope},${shift.key},${new Date(shift.startTime).toISOString()}::timestamptz,${new Date(shift.endTime).toISOString()}::timestamptz,${shift.name},${shift.timeZone},${input.text},${input.nextStep},${JSON.stringify(input.assetRefs)}::jsonb,${JSON.stringify(input.incidentIds)}::jsonb,${actor.id},${actorName(actor)}) returning id`,
    );
    await audit(
      tx,
      scope,
      "handover_recorded",
      {
        id: Number(row.id),
        shiftKey: shift.key,
        assetRefs: input.assetRefs,
        incidentIds: input.incidentIds,
      },
      actor,
    );
    return { id: Number(row.id), shiftKey: shift.key };
  });
}
