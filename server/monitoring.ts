import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Device } from "./db";
import { visibleRecordSql } from "./demoData";
import { deviceWithCurrentStatus } from "./deviceConnectivity";
import { deviceFreshnessSql } from "./deviceFreshness";
export const monitoringInput = z.object({
  search: z.string().trim().max(100).default(""),
  type: z
    .enum(["all", "gateway", "edge_device", "sensor", "actuator", "controller"])
    .default("all"),
  status: z
    .enum([
      "all",
      "live",
      "stale",
      "offline",
      "unknown",
      "maintenance",
      "error",
    ])
    .default("all"),
  page: z.number().int().min(0).max(100000).default(0),
  pageSize: z.number().int().min(1).max(50).default(25),
});
export const deviceProjection = () =>
  sql`with source as(select d.*,${deviceFreshnessSql(sql`d.metadata`)} as freshness from devices d where ${visibleRecordSql(sql`d."isDemo"`)}), observed as(select *,case when status in ('maintenance','error') then status::text when "lastSeen" is null or "lastSeen">now() then 'unknown' when status='offline' then 'offline' when freshness is null then 'unknown' when "lastSeen">=now()-freshness*interval '1 millisecond' then 'live' else 'stale' end as observed from source)`;
export async function monitoringPage(input: z.infer<typeof monitoringInput>) {
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const term = "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%";
  const [result] = await db.execute(
    sql`${deviceProjection()}, filtered as(select * from observed where (${input.type}='all' or type::text=${input.type}) and (${input.status}='all' or observed=${input.status}) and (name ilike ${term} or "deviceId" ilike ${term} or zone ilike ${term} or location ilike ${term})), paged as(select * from filtered order by lower(name),id limit ${input.pageSize} offset ${input.page * input.pageSize}) select coalesce((select jsonb_agg(p) from paged p),'[]'::jsonb) as items,(select count(*)::int from filtered) as total`,
  );
  const items = (result.items as any[]).map((r) =>
    deviceWithCurrentStatus({
      ...r,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
      lastSeen: r.lastSeen ? new Date(r.lastSeen) : null,
    } as Device),
  );
  return {
    items,
    total: Number(result.total),
    page: input.page,
    pageSize: input.pageSize,
    returned: items.length,
    hasMore: (input.page + 1) * input.pageSize < Number(result.total),
    truncated: false,
  };
}
export async function deviceStats() {
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const rows = await db.execute(
    sql`${deviceProjection()} select type,observed,count(*)::int as count from observed group by type,observed`,
  );
  const stats = {
    total: 0,
    online: 0,
    offline: 0,
    stale: 0,
    unknown: 0,
    maintenance: 0,
    error: 0,
    byType: {} as Record<string, number>,
  };
  for (const row of rows) {
    const count = Number(row.count),
      key =
        row.observed === "live"
          ? "online"
          : (String(row.observed) as
              | "offline"
              | "stale"
              | "unknown"
              | "maintenance"
              | "error");
    stats.total += count;
    stats[key] += count;
    stats.byType[String(row.type)] =
      (stats.byType[String(row.type)] ?? 0) + count;
  }
  return stats;
}
