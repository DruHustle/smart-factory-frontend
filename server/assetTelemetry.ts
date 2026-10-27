import { and, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { assets, type Asset } from "../drizzle/schema";
import { visibleRecordSql } from "./demoData";
import {
  defaultEvidenceScope,
  evidenceSql,
  metricSql,
  type EvidenceScope,
} from "./evidenceScope";
import { metrics, type Metric } from "../shared/measurements";

type Averages = {
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgVibration: number | null;
  avgPower: number | null;
  avgPressure: number | null;
  avgRpm: number | null;
};
type Trend = {
  firstHalfMean: number;
  recentHalfMean: number;
  changePercent: number | null;
} | null;
type Summary = Averages & {
  sampleCount: number;
  peakTemperature: number | null;
  peakVibration: number | null;
  peakPower: number | null;
  peakPressure: number | null;
  peakRpm: number | null;
  latestReadingAt: number | null;
  longestGapMs: number | null;
  metricCounts: Record<Metric, number>;
  trends: { temperature: Trend; vibration: Trend; pressure: Trend };
};
type IncidentCounts = {
  activeCritical: number;
  activeWarning: number;
  eventsInPeriod: number;
};
type AssetRecord = Pick<
  Asset,
  | "id"
  | "assetId"
  | "name"
  | "assetType"
  | "manufacturer"
  | "location"
  | "zone"
  | "lifecycleStage"
  | "isDemo"
>;
export type AssetAnalytics = {
  overall: Summary & {
    alerts: IncidentCounts;
    assetSignals: Record<string, number>;
  };
  timeline: (Averages & {
    timestamp: number;
    count: number;
    assetSignals: Record<string, number>;
  })[];
  assets: (AssetRecord &
    Summary & {
      alerts: IncidentCounts;
      assetSignals: {
        name: string;
        average: null;
        unit: null;
        latest: number;
        latestAt: number;
      }[];
    })[];
  metadata: {
    scope: EvidenceScope;
    intervalMs: number;
    requestedIntervalMs: number;
    total: number;
    returned: number;
    hasMore: boolean;
    truncated: boolean;
    detailLimit: number;
    unitPolicy: string;
    unclassifiedPolicy: string;
    signalDetailLimitPerAsset?: number;
    signalDetails?: {
      assetId: string;
      total: number;
      returned: number;
      truncated: boolean;
    }[];
  };
};
const emptyIncidents = (): IncidentCounts => ({
  activeCritical: 0,
  activeWarning: 0,
  eventsInPeriod: 0,
});
const title = (m: string) => m[0].toUpperCase() + m.slice(1);
const numeric = (v: unknown) => (v == null ? null : Number(v));
function summary(row?: Record<string, unknown>): Summary {
  const output: any = {
    sampleCount: Number(row?.sampleCount ?? 0),
    latestReadingAt: numeric(row?.latestReadingAt),
    longestGapMs: numeric(row?.longestGapMs),
    metricCounts: {},
    trends: {},
  };
  for (const m of metrics) {
    output[`avg${title(m)}`] = numeric(row?.[`avg${title(m)}`]);
    output[`peak${title(m)}`] = numeric(row?.[`peak${title(m)}`]);
    output.metricCounts[m] = Number(row?.[`count${title(m)}`] ?? 0);
  }
  for (const m of ["temperature", "vibration", "pressure"]) {
    const first = numeric(row?.[`early_${m}`]),
      recent = numeric(row?.[`recent_${m}`]);
    output.trends[m] =
      first == null || recent == null
        ? null
        : {
            firstHalfMean: first,
            recentHalfMean: recent,
            changePercent:
              Math.abs(first) < Number.EPSILON
                ? null
                : ((recent - first) / Math.abs(first)) * 100,
          };
  }
  return output;
}
export async function getAssetTelemetry(
  requestedAssetIds: string[],
  startTime: number,
  endTime: number,
  intervalMs = 3600000,
  scope: EvidenceScope = defaultEvidenceScope(),
): Promise<AssetAnalytics> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const bucketMs = Math.max(intervalMs, Math.ceil((endTime - startTime) / 600));
  const records = requestedAssetIds.length
    ? await db
        .select({
          id: assets.id,
          assetId: assets.assetId,
          name: assets.name,
          assetType: assets.assetType,
          manufacturer: assets.manufacturer,
          location: assets.location,
          zone: assets.zone,
          lifecycleStage: assets.lifecycleStage,
          isDemo: assets.isDemo,
        })
        .from(assets)
        .where(
          and(
            inArray(assets.assetId, requestedAssetIds),
            visibleRecordSql(assets.isDemo),
          ),
        )
    : [];
  const assetIds = records.map((a) => a.assetId);
  const metadata = {
    scope,
    requestedIntervalMs: intervalMs,
    intervalMs: bucketMs,
    detailLimit: 0,
    truncated: false,
    returned: 0,
    total: 0,
    hasMore: false,
    unclassifiedPolicy:
      "Only explicitly reviewed legacy sources enter operational scope; missing historical provenance remains unclassified.",
    unitPolicy:
      "Only good-quality sf-units-v1 canonical values enter averages. Unknown or incompatible units remain unavailable.",
  };
  if (!assetIds.length)
    return {
      overall: {
        ...summary(),
        alerts: emptyIncidents(),
        assetSignals: {} as Record<string, number>,
      },
      timeline: [] as (Averages & {
        timestamp: number;
        count: number;
        assetSignals: Record<string, number>;
      })[],
      assets: [] as ((typeof records)[number] &
        Summary & {
          alerts: IncidentCounts;
          assetSignals: {
            name: string;
            average: null;
            unit: null;
            latest: number;
            latestAt: number;
          }[];
        })[],
      metadata,
    };
  const selected = sql`r."assetId" in (${sql.join(
    assetIds.map((id) => sql`${id}`),
    sql`,`,
  )}) and r.timestamp>=${startTime} and r.timestamp<=${endTime} and ${evidenceSql(scope, sql`r.integration`)} and exists(select 1 from devices d where d.id=r."deviceId" and ${visibleRecordSql(sql`d."isDemo"`)})`;
  const normalize = sql.join(
    metrics.map((m) => sql`${metricSql(m)} as ${sql.identifier("v_" + m)}`),
    sql`, `,
  );
  const aggregates = sql.join(
    metrics.flatMap((m) => [
      sql`avg(${sql.identifier("v_" + m)}) as ${sql.identifier("avg" + title(m))}`,
      sql`max(${sql.identifier("v_" + m)}) as ${sql.identifier("peak" + title(m))}`,
      sql`count(${sql.identifier("v_" + m)})::int as ${sql.identifier("count" + title(m))}`,
    ]),
    sql`, `,
  );
  const trends = sql.join(
    ["temperature", "vibration", "pressure"].flatMap((m) => [
      sql`avg(${sql.identifier("v_" + m)}) filter(where timestamp<first_at+(last_at-first_at)/2) as ${sql.identifier("early_" + m)}`,
      sql`avg(${sql.identifier("v_" + m)}) filter(where timestamp>=first_at+(last_at-first_at)/2) as ${sql.identifier("recent_" + m)}`,
    ]),
    sql`, `,
  );
  return db.transaction(
    async (tx) => {
      const rows = await tx.execute(
        sql`with samples as materialized(select r.*,${normalize}, floor(r.timestamp::numeric/${bucketMs})*${bucketMs} as bucket from sensor_readings r where ${selected}), ordered as(select *,timestamp-lag(timestamp) over(partition by "assetId" order by timestamp,id) as gap,min(timestamp) over(partition by "assetId") as first_at,max(timestamp) over(partition by "assetId") as last_at from samples) select "assetId",bucket,grouping("assetId") as ag,grouping(bucket) as bg,count(*)::int as "sampleCount",max(timestamp) as "latestReadingAt",max(gap) as "longestGapMs",${aggregates},${trends} from ordered group by grouping sets((),("assetId"),(bucket))`,
      );
      const overallRow = rows.find((r) => r.ag === 1 && r.bg === 1),
        byAsset = new Map(
          rows.filter((r) => r.ag === 0).map((r) => [String(r.assetId), r]),
        );
      const incidentRows = await tx.execute(
        sql`select al."assetId",count(*) filter(where al.status<>'resolved' and al.severity='critical')::int as "activeCritical",count(*) filter(where al.status<>'resolved' and al.severity='warning')::int as "activeWarning",count(*) filter(where al."createdAt">=${new Date(startTime).toISOString()}::timestamptz)::int as "eventsInPeriod" from alerts al where al."assetId" in (${sql.join(
          assetIds.map((id) => sql`${id}`),
          sql`,`,
        )}) and al."createdAt"<=${new Date(endTime).toISOString()}::timestamptz and exists(select 1 from devices d where d.id=al."deviceId" and ${visibleRecordSql(sql`d."isDemo"`)}) group by al."assetId"`,
      );
      const byIncident = new Map(
        incidentRows.map((r) => [
          String(r.assetId),
          {
            activeCritical: Number(r.activeCritical),
            activeWarning: Number(r.activeWarning),
            eventsInPeriod: Number(r.eventsInPeriod),
          },
        ]),
      );
      const totals = incidentRows.reduce<IncidentCounts>(
        (a, r) => ({
          activeCritical: a.activeCritical + Number(r.activeCritical),
          activeWarning: a.activeWarning + Number(r.activeWarning),
          eventsInPeriod: a.eventsInPeriod + Number(r.eventsInPeriod),
        }),
        emptyIncidents(),
      );
      const signalRows = await tx.execute(
        sql`with observed_signals as(select r."assetId",r.timestamp,r.id,s.key as name,case when jsonb_typeof(s.value)='number' then s.value::text::double precision else null end as value,row_number() over(partition by r."assetId",s.key order by r.timestamp desc,r.id desc) as latest_order from sensor_readings r cross join lateral jsonb_each(coalesce(r."assetSignals",'{}'::jsonb)) s where ${selected} and jsonb_typeof(s.value)='number'), summaries as(select "assetId",name,null::double precision as average,max(value) filter(where latest_order=1) as latest,max(timestamp) as "latestAt" from observed_signals group by "assetId",name), ranked as(select *,row_number() over(partition by "assetId" order by name) as rn,count(*) over(partition by "assetId") as signal_count from summaries) select * from ranked where rn<=32`,
      );

      const overall = summary(overallRow),
        observedTimeline = rows
          .filter((r) => r.bg === 0)
          .map((r) => ({
            ...summary(r),
            timestamp: Number(r.bucket),
            count: Number(r.sampleCount),
            assetSignals: {} as Record<string, number>,
          }))
          .sort((a, b) => a.timestamp - b.timestamp);
      const buckets = new Map(observedTimeline.map((b) => [b.timestamp, b]));
      const timeline = overall.sampleCount
        ? Array.from(
            {
              length: Math.min(
                601,
                Math.floor(endTime / bucketMs) -
                  Math.floor(startTime / bucketMs) +
                  1,
              ),
            },
            (_, n) => {
              const timestamp =
                (Math.floor(startTime / bucketMs) + n) * bucketMs;
              return (
                buckets.get(timestamp) ?? {
                  ...summary(),
                  timestamp,
                  count: 0,
                  assetSignals: {},
                }
              );
            },
          )
        : [];
      const signalDetails = records.map((a) => {
        const found = signalRows.filter((s) => s.assetId === a.assetId),
          total = Number(found[0]?.signal_count ?? 0);
        return {
          assetId: a.assetId,
          total,
          returned: found.length,
          truncated: total > found.length,
        };
      });
      return {
        overall: {
          ...overall,
          alerts: totals,
          assetSignals: {} as Record<string, number>,
        },
        timeline,
        assets: records
          .map((a) => ({
            ...a,
            ...summary(byAsset.get(a.assetId)),
            alerts: byIncident.get(a.assetId) ?? emptyIncidents(),
            assetSignals: signalRows
              .filter((s) => s.assetId === a.assetId)
              .map((s) => ({
                name: String(s.name),
                average: null,
                unit: null,
                latest: Number(s.latest),
                latestAt: Number(s.latestAt),
              })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        metadata: {
          ...metadata,
          total: overall.sampleCount,
          returned: timeline.length,
          signalDetailLimitPerAsset: 32,
          signalDetails,
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
