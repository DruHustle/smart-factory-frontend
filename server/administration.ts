import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { visibleRecordSql } from "./demoData";
export async function auditPage(page:number,search:string) {
  const db=await getDb();if(!db)throw Error("Database unavailable");
  const term="%"+search.replace(/[\\%_]/g,"\\$&")+"%";
  const [result]=await db.execute(sql`with history as(
    select 'asset-revision:'||v.id as id,v."createdAt" as occurred_at,'Asset revision '||v.version||' · '||v."changeType" as action,coalesce(u.name,'System') as actor,a.name as target,'asset:'||a.id as ref from asset_versions v join assets a on a.id=v."assetId" left join users u on u.id=v."changedBy" where ${visibleRecordSql(sql`a."isDemo"`)}
    union all select 'asset-lifecycle:'||l.id,l."createdAt",'Lifecycle · '||l."toStage",coalesce(u.name,'System'),a.name,'asset:'||a.id from asset_lifecycle_events l join assets a on a.id=l."assetId" left join users u on u.id=l."changedBy" where ${visibleRecordSql(sql`a."isDemo"`)}
    union all select 'security-audit:'||s.id,s.created_at,replace(s.action,'_',' '),coalesce(u.name,'System'),'Security investigation',null from security_audit s left join users u on u.id=s.actor_id
    union all select 'native-event:'||e.id,e.occurred_at,replace(e.event_type,'.',' '),'Application audit','Access / configuration',null from security_events e join security_sources s on s.id=e.source_id where s.namespace='smart-factory-native' and ${visibleRecordSql(sql`s.is_demo`)} and e.event_type in('config.changed','auth.authentication_failed','auth.authorization_denied')
  ), filtered as(select * from history where action ilike ${term} or actor ilike ${term} or target ilike ${term}), paged as(select * from filtered order by occurred_at desc,id limit 25 offset ${page*25}) select coalesce((select jsonb_agg(p) from paged p),'[]'::jsonb) as items,(select count(*)::int from filtered) as total`);
  return {items:result.items as {id:string;occurred_at:string;action:string;actor:string;target:string;ref:string|null}[],total:Number(result.total),page,pageSize:25,hasMore:(page+1)*25<Number(result.total),scope:"Stored asset revisions, lifecycle decisions, security workflow and native access/configuration events. No completeness claim for activity not recorded by these sources."};
}
export async function connectionSummary(){
  const db=await getDb();if(!db)throw Error("Database unavailable");
  const rows=await db.execute<{protocol:string;count:number;lastObserved:string|null}>(sql`select c.protocol,count(*)::int as count,max(c."lastSeen") as "lastObserved" from asset_devices c join assets a on a.id=c."assetId" join devices d on d.id=c."deviceId" where ${visibleRecordSql(sql`a."isDemo"`)} and ${visibleRecordSql(sql`d."isDemo"`)} group by c.protocol order by c.protocol`);
  return {profiles:rows,aasProvisioningConfigured:!!process.env.AAS_PROVISIONING_API_URL,onesaEnabled:process.env.ONESA_ENABLED==="true"};
}
