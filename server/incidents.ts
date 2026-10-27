import { sql } from "drizzle-orm";
import { getDb, getAlertById } from "./db";
import { TRPCError } from "@trpc/server";
export async function incidentHistory(id: number, after = 0) {
  if (!(await getAlertById(id)))
    throw new TRPCError({ code: "NOT_FOUND", message: "Incident unavailable" });
  const db = (await getDb())!,
    items = await db.execute(
      sql`select a.id,a.kind,a.detail,a.created_at as "createdAt",a.actor_id as "actorId",u.name as "actorName" from incident_activity a left join users u on u.id=a.actor_id where a.alert_id=${id} and (${after}=0 or a.id<${after}) order by a.id desc limit 51`,
    ),
    hasMore = items.length > 50,
    page = items.slice(0, 50);
  return {
    items: page as unknown as {
      id: number;
      kind: string;
      detail: { text?: string; assignedToId?: number | null };
      createdAt: Date;
      actorId: number | null;
      actorName: string | null;
    }[],
    returned: page.length,
    hasMore,
    nextCursor: hasMore ? Number(page.at(-1)!.id) : null,
  };
}
export async function addIncidentNote(
  id: number,
  text: string,
  actorId: number,
) {
  if (!(await getAlertById(id)))
    throw new TRPCError({ code: "NOT_FOUND", message: "Incident unavailable" });
  const db = (await getDb())!;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from alerts where id=${id} for update`);
    const [count] = await tx.execute(
      sql`select count(*)::int as n from incident_activity where alert_id=${id} and kind='note'`,
    );
    if (Number(count.n) >= 1000)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This investigation has reached its note limit. Export the recorded history for a continued review.",
      });
    const [row] = await tx.execute(
      sql`insert into incident_activity(alert_id,kind,actor_id,detail) values(${id},'note',${actorId},${JSON.stringify({ text })}::jsonb) returning id`,
    );
    return { id: Number(row.id) };
  });
}
