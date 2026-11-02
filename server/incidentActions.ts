import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getAlertById, getDb, visibleAlertEntitiesCondition } from "./db";
import {
  incidentFactoryCondition,
  validateIncidentFactoryScope,
} from "./incidentFactoryScope";

type ActionStatus = "open" | "in_progress" | "completed";
export type ActionInput = {
  id: number;
  title: string;
  ownerId: number;
  dueDate: string | null;
};
type ActionUpdate = {
  id: number;
  actionId: number;
  expectedVersion: number;
  ownerId: number;
  dueDate: string | null;
  status: ActionStatus;
  outcome: string | null;
};

export async function incidentActionQueue(
  page: number,
  pageSize: number,
  factoryId?: string,
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  await validateIncidentFactoryScope(db, factoryId);
  const rows = await db.execute(sql`
    select a.id, a.alert_id as "incidentId", a.title, a.owner_id as "ownerId",
      u.name as "ownerName", a.due_date::text as "dueDate", a.status,
      d.name as "deviceName"
    from incident_actions a join alerts on alerts.id=a.alert_id
      join devices d on d.id=alerts."deviceId"
      left join users u on u.id=a.owner_id
    where a.status in ('open','in_progress') and ${visibleAlertEntitiesCondition()}
      and ${incidentFactoryCondition(factoryId)}
    order by a.due_date asc nulls last, a.id desc limit ${pageSize + 1} offset ${page * pageSize}`);
  return {
    items: rows.slice(0, pageSize) as unknown as {
      id: number;
      incidentId: number;
      title: string;
      ownerId: number | null;
      ownerName: string | null;
      dueDate: string | null;
      status: "open" | "in_progress";
      deviceName: string | null;
    }[],
    hasMore: rows.length > pageSize,
  };
}

async function visibleIncident(id: number) {
  if (!(await getAlertById(id)))
    throw new TRPCError({ code: "NOT_FOUND", message: "Incident unavailable" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
}

/** The parent incident supplies asset identity, evidence and visibility. */
export async function incidentActions(id: number, after = 0) {
  const db = await visibleIncident(id);
  const rows = await db.execute(sql`
    select a.id, a.alert_id as "incidentId", a.title, a.owner_id as "ownerId",
      u.name as "ownerName", a.due_date::text as "dueDate", a.status,
      a.outcome, a.version, a.created_at as "createdAt", a.updated_at as "updatedAt"
    from incident_actions a left join users u on u.id=a.owner_id
    where a.alert_id=${id} and (${after}=0 or a.id<${after})
    order by a.id desc limit 51`);
  const items = rows.slice(0, 50);
  return {
    items: items as unknown as {
      id: number;
      incidentId: number;
      title: string;
      ownerId: number | null;
      ownerName: string | null;
      dueDate: string | null;
      status: ActionStatus;
      outcome: string | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
    }[],
    hasMore: rows.length > 50,
    nextCursor: rows.length > 50 ? Number(items.at(-1)!.id) : null,
  };
}

async function validateOwner(
  tx: { execute: (query: any) => Promise<any> },
  ownerId: number,
) {
  const [owner] = await tx.execute(sql`
    select id from users where id=${ownerId} and role='engineer'
      and disabled_at is null and password_change_required=false`);
  if (!owner)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select an active engineer or technician.",
    });
}

export async function createIncidentAction(
  input: ActionInput,
  actorId: number,
) {
  const db = await visibleIncident(input.id);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from alerts where id=${input.id} for update`,
    );
    await validateOwner(tx, input.ownerId);
    const [count] = await tx.execute(
      sql`select count(*)::int as n from incident_actions where alert_id=${input.id}`,
    );
    if (Number(count.n) >= 1000)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This incident has reached its action limit.",
      });
    const [action] = await tx.execute(sql`
      insert into incident_actions(alert_id,title,owner_id,due_date,created_by)
      values(${input.id},${input.title},${input.ownerId},${input.dueDate}::date,${actorId}) returning id`);
    const actionId = Number(action.id);
    const detail = {
      text: `Action created: ${input.title}`,
      action: {
        id: actionId,
        ownerId: input.ownerId,
        dueDate: input.dueDate,
        status: "open",
      },
    };
    await tx.execute(
      sql`insert into incident_activity(alert_id,kind,actor_id,detail) values(${input.id},'note',${actorId},${JSON.stringify(detail)}::jsonb)`,
    );
    return { id: actionId };
  });
}

export async function updateIncidentAction(
  input: ActionUpdate,
  actorId: number,
) {
  const db = await visibleIncident(input.id);
  return db.transaction(async (tx) => {
    await validateOwner(tx, input.ownerId);
    const [action] = await tx.execute(sql`
      update incident_actions set owner_id=${input.ownerId}, due_date=${input.dueDate}::date,
        status=${input.status}, outcome=${input.outcome}, version=version+1, updated_at=now()
      where id=${input.actionId} and alert_id=${input.id} and version=${input.expectedVersion}
      returning id,title,version`);
    if (!action)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Action changed or is unavailable. Reload and try again.",
      });
    const detail = {
      text: `Action updated: ${action.title}`,
      action: {
        id: input.actionId,
        ownerId: input.ownerId,
        dueDate: input.dueDate,
        status: input.status,
        outcome: input.outcome,
        version: Number(action.version),
      },
    };
    await tx.execute(
      sql`insert into incident_activity(alert_id,kind,actor_id,detail) values(${input.id},'note',${actorId},${JSON.stringify(detail)}::jsonb)`,
    );
    return { id: input.actionId, version: Number(action.version) };
  });
}
