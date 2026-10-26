import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { demoDataEnabled } from "./demoData";
import { observedStatus, type InventoryItem } from "../shared/inventory";
import { router, viewerProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
export const inventoryFilter = z.object({
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
const projection = () => sql`with inventory as (
 select 'asset:'||a.id as ref,'asset' as kind,a.id::text as id,a.name,a."assetId" as identifier,a."assetType"::text as "itemType",a.location,a.zone,
 exists(select 1 from asset_devices c where c."assetId"=a.id) as configured,
 case when exists(select 1 from asset_devices c where c."assetId"=a.id and c.protocol='mqtt_direct') then 'Direct MQTT' when exists(select 1 from asset_devices c where c."assetId"=a.id) then 'Linked devices' else 'Not configured' end as route,
 null::text as reported,(select case when bool_and(c.protocol='ada031_v4_serial') then 120000::bigint else null end from asset_devices c where c."assetId"=a.id) as "freshnessMs",(select max(c."lastSeen") from asset_devices c where c."assetId"=a.id) as "lastObserved",r.timestamp as "sampleAt",coalesce(r.integration->>'mode',case when a."isDemo" then 'simulated' else 'unknown' end) as mode,
 coalesce(r.integration->>'sourceQuality','unknown') as quality,a."lifecycleStage"::text as lifecycle,true as aas,w.id::text as "equipmentId",null::text as firmware
 from assets a left join equipment_workspaces w on w.asset_id=a.id and (not w.is_demo or ${demoDataEnabled()}) and (w.is_demo or ${process.env.ENABLE_DEMO_ACCOUNTS !== "true"})
 left join lateral(select timestamp,integration from sensor_readings where "assetId"=a."assetId" order by timestamp desc limit 1) r on true
 where (not a."isDemo" or ${demoDataEnabled()}) and not exists(select 1 from equipment_workspaces sw where sw.asset_id=a.id and sw.is_standalone=true)
 union all
 select 'device:'||d.id,'device',d.id::text,d.name,d."deviceId",d.type::text,d.location,d.zone,
 coalesce(d.metadata->>'connectionMode','') in ('direct_mqtt','gateway'),
 case when d.metadata->>'gatewayId' is not null then 'Via gateway: '||(d.metadata->>'gatewayId') when d.metadata->>'connectionMode'='direct_mqtt' then 'Direct MQTT' when d.type='gateway' and d.metadata->>'connectionMode'='gateway' then 'Gateway uplink' else 'Not configured' end,
 d.status::text,case when d.metadata->>'freshnessMs' ~ '^[0-9]{1,9}$' then (d.metadata->>'freshnessMs')::bigint when d.metadata->>'connectionMode'='gateway' then 120000 else null end,
 d."lastSeen",r.timestamp,coalesce(r.integration->>'mode',case when d."isDemo" then 'simulated' else 'unknown' end),
 coalesce(d.metadata->>'sensorStatus','unknown'),null,false,null,d."firmwareVersion"
 from devices d left join lateral(select timestamp,integration from sensor_readings where "deviceId"=d.id order by timestamp desc limit 1) r on true where (not d."isDemo" or ${demoDataEnabled()})
 union all
 select 'equipment:'||w.id,'equipment',w.id::text,a.name,a."assetId",'3D equipment',a.location,a.zone,
 exists(select 1 from asset_devices c where c."assetId"=a.id),'Local observations',null,null,null,r.timestamp,coalesce(r.integration->>'mode',case when w.kind='simulated' then 'simulated' else 'unknown' end),'unknown',a."lifecycleStage"::text,false,w.id::text,null
 from equipment_workspaces w join assets a on a.id=w.asset_id left join lateral(select timestamp,integration from sensor_readings where "assetId"=a."assetId" order by timestamp desc limit 1) r on true
 where w.is_standalone=true and (not w.is_demo or ${demoDataEnabled()}) and (w.is_demo or ${process.env.ENABLE_DEMO_ACCOUNTS !== "true"})
), observed as(select *,case when reported in ('maintenance','error') then reported when "lastObserved" is null then 'unknown' when reported='offline' then 'offline' when "freshnessMs" is null or "lastObserved">now() then 'unknown' when "lastObserved">=now()-"freshnessMs"*interval '1 millisecond' then 'live' else 'stale' end as status from inventory)`;
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
  const where = sql`${viewCondition(f.view)} and (name ilike ${term} or identifier ilike ${term}) and (${f.zone}='' or zone=${f.zone}) and (${f.status}='all' or status=${f.status}) and (${f.mode}='all' or mode=${f.mode}) and (${f.capability}='all' or (${f.capability}='aas' and aas) or (${f.capability}='3d' and "equipmentId" is not null))`;
  const rows = await db.execute(
    sql`${projection()} select * from observed where ${where} order by ${f.sort === "recent" ? sql`"sampleAt" desc nulls last, name,ref` : sql`lower(name),ref`} limit ${f.pageSize} offset ${f.page * f.pageSize}`,
  );
  const [counts] = await db.execute(
    sql`${projection()} select count(*)::int as total from observed where ${where}`,
  );
  const groups = await db.execute(
    sql`${projection()} select kind,"itemType",("equipmentId" is not null) as equipment,count(*)::int as count from observed group by kind,"itemType",("equipmentId" is not null)`,
  );
  return { items: rows.map(normalize), total: Number(counts.total), groups };
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
