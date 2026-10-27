import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, getDeviceById } from "./db";
import { sensorReadings } from "../drizzle/schema";
import { evidenceSql, defaultEvidenceScope, metricSql, type EvidenceScope } from "./evidenceScope";
import { canonicalUnits, metrics, type Metric } from "../shared/measurements";
export type ReadingSummary = { total:number; scope:EvidenceScope; statisticsComplete:true; metrics:Record<Metric,{min:number;max:number;avg:number;count:number;unit:string}|null> };
export async function deviceReadingSummary(deviceId:number,startTime:number,endTime:number,scope:EvidenceScope=defaultEvidenceScope()):Promise<ReadingSummary> {
  const db=await getDb();if(!db)throw Error("Database unavailable");
  if(!await getDeviceById(deviceId))throw Error("Device unavailable");
  const columns=sql.join(metrics.flatMap(m=>[sql`min(${metricSql(m)}) as ${sql.identifier(m+"_min")}`,sql`max(${metricSql(m)}) as ${sql.identifier(m+"_max")}`,sql`avg(${metricSql(m)}) as ${sql.identifier(m+"_avg")}`,sql`count(${metricSql(m)})::int as ${sql.identifier(m+"_count")}`]),sql`, `);
  const [row]=await db.execute(sql`select count(*)::int as total,${columns} from sensor_readings r where r."deviceId"=${deviceId} and r.timestamp>=${startTime} and r.timestamp<=${endTime} and ${evidenceSql(scope,sql`r.integration`)} and (r."assetId" is null or exists(select 1 from assets a where a."assetId"=r."assetId" and a."isDemo"=(select "isDemo" from devices where id=${deviceId})))`);
  return {total:Number(row.total),scope,statisticsComplete:true,metrics:Object.fromEntries(metrics.map(m=>[m,Number(row[m+"_count"])?{min:Number(row[m+"_min"]),max:Number(row[m+"_max"]),avg:Number(row[m+"_avg"]),count:Number(row[m+"_count"]),unit:canonicalUnits[m]}:null])) as ReadingSummary["metrics"]};
}
