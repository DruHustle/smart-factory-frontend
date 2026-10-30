import { evidenceSql } from "./evidenceScope";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { visibleRecordSql } from "./demoData";
import { observedStatus, type InventoryItem } from "../shared/inventory";
import { router, viewerProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { deviceFreshnessSql } from "./deviceFreshness";
export const inventoryFilter = z.object({
  factoryId: z.uuid().optional(),
  unassignedOnly: z.boolean().optional(),
  search: z.string().trim().max(100).default(""),
  view: z
    .enum(["all", "assets", "devices", "gateways", "equipment"])
    .default("all"),
  zone: z.string().max(100).default(""),
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
  mode: z
    .enum(["all", "live", "simulated", "replay", "unknown"])
    .default("all"),
  capability: z.enum(["all", "aas", "3d"]).default("all"),
  sort: z.enum(["name", "recent"]).default("name"),
  page: z.number().int().min(0).max(100000).default(0),
  pageSize: z.number().int().min(1).max(50).default(25),
});
type Filter = z.infer<typeof inventoryFilter>;
// Three authoritative tables, no replicated inventory. All lists and lookups are bounded.
const projection = (mode: Filter["mode"] = "all") => sql`with inventory as (
 select 'asset:'||a.id as ref,'asset' as kind,a.id::text as id,a.name,a."assetId" as identifier,a."assetType"::text as "itemType",a.location,a.zone,
 exists(select 1 from asset_devices c where c."assetId"=a.id) as configured,
 case when exists(select 1 from asset_devices c where c."assetId"=a.id and c.protocol='mqtt_direct') then 'Direct MQTT' when exists(select 1 from asset_devices c where c."assetId"=a.id) then 'Linked devices' else 'Not configured' end as route,
 null::text as reported,(select case when bool_and(c.protocol='ada031_v4_serial') then 120000::bigint else null end from asset_devices c where c."assetId"=a.id) as "freshnessMs",(select max(c."lastSeen") from asset_devices c where c."assetId"=a.id) as "lastObserved",r.timestamp as "sampleAt",coalesce(r.integration->>'mode','unknown') as mode,
 coalesce(r.integration->>'sourceQuality','unknown') as quality,a."lifecycleStage"::text as lifecycle,true as aas,w.id::text as "equipmentId",null::text as firmware,r.measurements,r.values,r.integration->'evidence' as evidence,a."isDemo" as "isDemo"
 from assets a left join equipment_workspaces w on w.asset_id=a.id and ${visibleRecordSql(sql`w.is_demo`)}
 left join lateral(select timestamp,integration,measurements,jsonb_build_object('temperature',temperature,'humidity',humidity,'vibration',vibration,'power',power,'pressure',pressure,'rpm',rpm) as values from sensor_readings where exists(select 1 from devices observed_source where observed_source.id=sensor_readings."deviceId" and ${visibleRecordSql(sql`observed_source."isDemo"`)}) and "assetId"=a."assetId" and timestamp<=${Date.now()} and ${evidenceSql(mode, sql`integration`)} order by timestamp desc,id desc limit 1) r on true
 where ${visibleRecordSql(sql`a."isDemo"`)} and not exists(select 1 from equipment_workspaces sw where sw.asset_id=a.id and sw.is_standalone=true)
 union all
 select 'device:'||d.id,'device',d.id::text,d.name,d."deviceId",d.type::text,d.location,d.zone,
 coalesce(d.metadata->>'connectionMode','') in ('direct_mqtt','gateway'),
 case when d.metadata->>'gatewayId' is not null then 'Via gateway: '||(d.metadata->>'gatewayId') when d.metadata->>'connectionMode'='direct_mqtt' then 'Direct MQTT' when d.type='gateway' and d.metadata->>'connectionMode'='gateway' then 'Gateway uplink' else 'Not configured' end,
 d.status::text,${deviceFreshnessSql(sql`d.metadata`)},
 d."lastSeen",r.timestamp,coalesce(r.integration->>'mode','unknown'),
 coalesce(r.integration->>'sourceQuality','unknown'),null,false,null,d."firmwareVersion",r.measurements,r.values,r.integration->'evidence',d."isDemo"
 from devices d left join lateral(select timestamp,integration,measurements,jsonb_build_object('temperature',temperature,'humidity',humidity,'vibration',vibration,'power',power,'pressure',pressure,'rpm',rpm) as values from sensor_readings where ("assetId" is null or exists(select 1 from assets observed_asset where observed_asset."assetId"=sensor_readings."assetId" and ${visibleRecordSql(sql`observed_asset."isDemo"`)})) and "deviceId"=d.id and timestamp<=${Date.now()} and ${evidenceSql(mode, sql`integration`)} order by timestamp desc,id desc limit 1) r on true where ${visibleRecordSql(sql`d."isDemo"`)}
 union all
 select 'equipment:'||w.id,'equipment',w.id::text,a.name,a."assetId",'3D equipment',a.location,a.zone,
 exists(select 1 from asset_devices c where c."assetId"=a.id),'Local observations',null,null,null,r.timestamp,coalesce(r.integration->>'mode','unknown'),'unknown',a."lifecycleStage"::text,false,w.id::text,null,r.measurements,r.values,r.integration->'evidence',w.is_demo
 from equipment_workspaces w join assets a on a.id=w.asset_id left join lateral(select timestamp,integration,measurements,jsonb_build_object('temperature',temperature,'humidity',humidity,'vibration',vibration,'power',power,'pressure',pressure,'rpm',rpm) as values from sensor_readings where exists(select 1 from devices observed_source where observed_source.id=sensor_readings."deviceId" and ${visibleRecordSql(sql`observed_source."isDemo"`)}) and "assetId"=a."assetId" and timestamp<=${Date.now()} and ${evidenceSql(mode, sql`integration`)} order by timestamp desc,id desc limit 1) r on true
 where w.is_standalone=true and ${visibleRecordSql(sql`w.is_demo`)} and ${visibleRecordSql(sql`a."isDemo"`)}
), observed as materialized(select *,case when reported in ('maintenance','error') then reported when "lastObserved" is null or "lastObserved">now() then 'unknown' when reported='offline' then 'offline' when "freshnessMs" is null then 'unknown' when "lastObserved">=now()-"freshnessMs"*interval '1 millisecond' then 'live' else 'stale' end as status from inventory)`;
const viewCondition = (view: Filter["view"]) =>
  view === "all"
    ? sql`true`
    : view === "assets"
      ? sql`kind='asset'`
      : view === "devices"
        ? sql`kind='device' and "itemType"<>'gateway'`
        : view === "gateways"
          ? sql`kind='device' and "itemType"='gateway'`
          : sql`"equipmentId" is not null`;
const normalize = (r: any): InventoryItem => ({
  ...r,
  lastObserved: r.lastObserved ? new Date(r.lastObserved).toISOString() : null,
  sampleAt: r.sampleAt == null ? null : Number(r.sampleAt),
  freshnessMs: r.freshnessMs == null ? null : Number(r.freshnessMs),
  status: observedStatus(r),
});
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        "Inventory is unavailable. Try again when the data service is ready.",
    });
  return db;
}
export async function listInventory(f: Filter) {
  const db = await database();
  const term = "%" + f.search.replace(/[\\%_]/g, "\\$&") + "%";
  const factoryWhere = f.factoryId
    ? sql`exists(select 1 from factory_items fi where fi.factory_id=${f.factoryId} and fi.ref=observed.ref)`
    : sql`true`;
  const assignmentWhere = f.unassignedOnly
    ? sql`not exists(select 1 from factory_items fi where fi.ref=observed.ref)`
    : sql`true`;
  const scopeWhere = sql`${factoryWhere} and ${assignmentWhere} and (name ilike ${term} or identifier ilike ${term} or exists(select 1 from factory_items fi where fi.ref=observed.ref and fi.inventory_tag ilike ${term})) and (${f.zone}='' or zone=${f.zone}) and (${f.status}='all' or status=${f.status}) and (${f.mode}='all' or mode=${f.mode}) and (${f.capability}='all' or (${f.capability}='aas' and aas) or (${f.capability}='3d' and "equipmentId" is not null))`;
  const where = sql`${viewCondition(f.view)} and ${scopeWhere}`;
  const [result] = await db.execute(
    sql`${projection(f.mode)}, filtered as(select * from observed where ${where}), paged as(select filtered.*,(select fi.inventory_tag from factory_items fi where fi.ref=filtered.ref) as "factoryTag",(select fi.factory_id from factory_items fi where fi.ref=filtered.ref) as "factoryId" from filtered order by ${f.sort === "recent" ? sql`"sampleAt" desc nulls last,name,ref` : sql`lower(name),ref`} limit ${f.pageSize} offset ${f.page * f.pageSize}), grouped as(select kind,"itemType",("equipmentId" is not null) as equipment,count(*)::int as count from observed where ${scopeWhere} group by kind,"itemType",("equipmentId" is not null)) select coalesce((select jsonb_agg(p) from paged p),'[]'::jsonb) as items,(select count(*)::int from filtered) as total,coalesce((select jsonb_agg(g) from grouped g),'[]'::jsonb) as groups`,
  );
  return {
    items: (result.items as any[]).map(normalize),
    total: Number(result.total),
    groups: result.groups as {
      kind: string;
      itemType: string;
      equipment: boolean;
      count: number;
    }[],
  };
}
/** Resolve a bounded set of authoritative typed records under the current visibility policy. */
export async function inventoryItemsByRefs(
  refs: string[],
): Promise<InventoryItem[]> {
  if (!refs.length) return [];
  if (refs.length > 5000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select at most 5,000 inventory items.",
    });
  const db = await database();
  const rows = await db.execute(
    sql`${projection()} select * from observed where ref in (${sql.join(
      refs.map((ref) => sql`${ref}`),
      sql`,`,
    )})`,
  );
  return rows.map(normalize);
}

export const inventoryRouter = router({
  list: viewerProcedure
    .input(inventoryFilter)
    .query(({ input }) => listInventory(input)),
  item: viewerProcedure
    .input(
      z.object({
        ref: z
          .string()
          .regex(/^(asset:[1-9]\d*|device:[1-9]\d*|equipment:[a-f0-9-]{36})$/),
      }),
    )
    .query(async ({ input }) => {
      const db = await database();
      const [row] = await db.execute(
        sql`${projection()} select * from observed where ref=${input.ref} limit 1`,
      );
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Item not found or unavailable in this workspace.",
        });
      return normalize(row);
    }),
});
