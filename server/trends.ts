import { sql } from "drizzle-orm";
import { getDb, getDeviceById } from "./db";
import { visibleRecordSql } from "./demoData";
import {
  evidenceSql,
  metricSql,
  defaultEvidenceScope,
  type EvidenceScope,
} from "./evidenceScope";
import { canonicalUnits, type Metric } from "../shared/measurements";
/** Full-range SQL summaries with at most 601 display buckets, including empty gaps. */
export async function observationTrend(input: {
  deviceId?: number;
  assetIds?: string[];
  metric: Metric;
  startTime: number;
  endTime: number;
  intervalMs?: number;
  scope?: EvidenceScope;
}) {
  const db = await getDb();
  if (!db) throw Error("Database unavailable");
  const scope = input.scope ?? defaultEvidenceScope(),
    intervalMs = Math.max(
      input.intervalMs ?? 60000,
      Math.ceil((input.endTime - input.startTime) / 600),
    );
  if (input.deviceId && !(await getDeviceById(input.deviceId)))
    throw Error("Observation source unavailable");
  const subject = input.deviceId
    ? sql`r."deviceId"=${input.deviceId}`
    : sql`r."assetId" in (${sql.join(
        (input.assetIds ?? []).map((id) => sql`${id}`),
        sql`,`,
      )})`;
  const [result] = await db.execute(
    sql`with observations as materialized(select r.id,r.timestamp,${metricSql(input.metric)} as value from sensor_readings r where ${subject} and r.timestamp>=${input.startTime} and r.timestamp<=${input.endTime} and ${evidenceSql(scope, sql`r.integration`)} and exists(select 1 from devices d where d.id=r."deviceId" and ${visibleRecordSql(sql`d."isDemo"`)}) and (r."assetId" is null or exists(select 1 from assets a where a."assetId"=r."assetId" and ${visibleRecordSql(sql`a."isDemo"`)}))), buckets as(select floor((timestamp-${input.startTime})::numeric/${intervalMs})::int as bucket,avg(value) as value,count(value)::int as count from observations group by 1), summary as(select count(*)::int as total,count(value)::int as verified,min(value) as min,max(value) as max,avg(value) as average from observations), series as(select n as bucket,${input.startTime}::bigint+n::bigint*${intervalMs} as timestamp from generate_series(0,floor((${input.endTime}::bigint-${input.startTime}::bigint)::numeric/${intervalMs})::int) n) select summary.*,(select value from observations where value is not null order by timestamp desc,id desc limit 1) as latest,(select max(timestamp) from observations where value is not null) as "latestAt",coalesce((select jsonb_agg(jsonb_build_object('timestamp',s.timestamp,'value',b.value,'count',coalesce(b.count,0)) order by s.timestamp) from series s left join buckets b using(bucket)),'[]'::jsonb) as buckets from summary`,
  );
  const number = (v: unknown) => (v == null ? null : Number(v));
  return {
    scope,
    metric: input.metric,
    unit: canonicalUnits[input.metric],
    startTime: input.startTime,
    endTime: input.endTime,
    intervalMs,
    total: Number(result.total),
    verified: Number(result.verified),
    unverified: Number(result.total) - Number(result.verified),
    statisticsComplete: true as const,
    truncated: false as const,
    summary: {
      min: number(result.min),
      max: number(result.max),
      average: number(result.average),
      latest: number(result.latest),
      latestAt: number(result.latestAt),
    },
    buckets: result.buckets as {
      timestamp: number;
      value: number | null;
      count: number;
    }[],
  };
}
