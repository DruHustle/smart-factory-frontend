import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { inventoryFilter, listInventory } from "./inventory";
import { visibleRecordSql } from "./demoData";
import type { FloorLink } from "../shared/factory-floor";

export async function factoryFloor(zone = "") {
  // One bounded statement gives a consistent complete inventory, including more
  // than one ordinary list page. The public list limit remains fifty.
  const result = await listInventory({
    ...inventoryFilter.parse({ zone, sort: "name", view: "all" }),
    pageSize: 5000,
  });
  const { items, total } = result;
  if (total > 5000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This factory has over 5,000 items. Select a zone to display its complete floor.",
    });
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Factory connections are unavailable.",
    });
  const connections = await db.execute<{
    from: string;
    to: string;
    kind: "acquisition" | "gateway";
    label: string;
  }>(sql`
    select 'device:'||d.id as "from",case when w.is_standalone then 'equipment:'||w.id else 'asset:'||a.id end as "to",'acquisition' as kind,c.protocol as label
    from asset_devices c join devices d on d.id=c."deviceId" join assets a on a.id=c."assetId"
    left join equipment_workspaces w on w.asset_id=a.id and ${visibleRecordSql(sql`w.is_demo`)}
    where (${zone}='' or a.zone=${zone} or d.zone=${zone}) and ${visibleRecordSql(sql`d."isDemo"`)} and ${visibleRecordSql(sql`a."isDemo"`)}
    union all
    select 'device:'||p.id,'device:'||d.id,'gateway','Gateway uplink'
    from devices d join devices p on p."deviceId"=d.metadata->>'gatewayId'
    where (${zone}='' or d.zone=${zone} or p.zone=${zone}) and ${visibleRecordSql(sql`d."isDemo"`)} and ${visibleRecordSql(sql`p."isDemo"`)} limit 20001`);
  if (connections.length > 20000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select a smaller factory zone to inspect its connections.",
    });
  const refs = new Set(items.map((i) => i.ref)),
    seen = new Set<string>();
  const links: FloorLink[] = connections.filter((c) => {
    const key = `${c.from}:${c.to}:${c.kind}`;
    if (
      !refs.has(c.from) ||
      !refs.has(c.to) ||
      c.from === c.to ||
      seen.has(key)
    )
      return false;
    seen.add(key);
    return true;
  });
  return {
    items,
    total,
    groups: result.groups,
    links,
    complete: true as const,
    sampledAt: new Date().toISOString(),
  };
}
export const factoryRouter = router({
  floor: viewerProcedure
    .input(
      z.object({ zone: z.string().max(100).default("") }).default({ zone: "" }),
    )
    .query(({ input }) => factoryFloor(input.zone)),
});
