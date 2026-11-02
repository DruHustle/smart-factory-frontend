import { sql } from "drizzle-orm";
import type { ApplicationDatabase } from "./database-scope";
import type { SourceContinuity } from "../shared/measurements";

/** Communication history is separate from acquisition time and never renews a value. */
export async function sourceContinuity(
  db: Pick<ApplicationDatabase, "execute">,
  sourceIds: number[],
): Promise<Map<number, SourceContinuity>> {
  const ids = [...new Set(sourceIds.filter(Number.isSafeInteger))];
  if (!ids.length) return new Map();
  const rows = await db.execute(sql`
    select d.id, d.status='offline' or coalesce(p.status='offline',false) as offline,
      d.metadata->'commissioning'->>'revision' as revision,
      greatest(
        (select max(o.occurred_at) from gateway_observations o
          where o.device_id=d.id and o.current_eligible and o.reported_status='offline'),
        (select max(o.occurred_at) from gateway_observations o
          where o.device_id=p.id and o.current_eligible and o.reported_status='offline')
      ) as interrupted
    from devices d left join devices p
      on d.metadata->'commissioning'->>'route'='gateway'
      and p."deviceId"=d.metadata->'commissioning'->>'gatewayId'
      and p."isDemo"=d."isDemo"
    where d.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )})`);
  return new Map(
    rows.map((row) => [
      Number(row.id),
      {
        offline: row.offline === true,
        interruptedAt: row.interrupted == null ? null : Number(row.interrupted),
        commissioningRevision:
          row.revision == null ? null : Number(row.revision),
      },
    ]),
  );
}

export async function annotateSourceContinuity<T extends { deviceId: number }>(
  db: Pick<ApplicationDatabase, "execute">,
  rows: T[],
) {
  const continuity = await sourceContinuity(
    db,
    rows.map((row) => row.deviceId),
  );
  return rows.map((row) => ({
    ...row,
    sourceContinuity: continuity.get(row.deviceId) ?? null,
  }));
}
