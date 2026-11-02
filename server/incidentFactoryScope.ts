import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { ApplicationDatabase } from "./database-scope";
import { visibleRecordSql } from "./demoData";

/** Validate the requested boundary before returning an empty scoped queue. */
export async function validateIncidentFactoryScope(
  db: Pick<ApplicationDatabase, "execute">,
  factoryId?: string,
) {
  if (!factoryId) return;
  const [factory] = await db.execute(
    sql`select id from factories where id=${factoryId}::uuid`,
  );
  if (!factory)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The selected factory is unavailable.",
    });
}

/**
 * Follow saved placement and acquisition links. An explicitly attributed event
 * cannot be moved to another asset merely because it shares an acquisition source.
 */
export function incidentFactoryCondition(factoryId?: string) {
  return factoryId
    ? sql`exists (
        select 1 from factory_items fi
        left join assets fa on fa.id=fi.asset_id
        where fi.factory_id=${factoryId}::uuid and (
          fi.device_id=alerts."deviceId"
          or (fa."assetId"=alerts."assetId" and ${visibleRecordSql(sql`fa."isDemo"`)})
          or (alerts."assetId" is null and ${visibleRecordSql(sql`fa."isDemo"`)} and exists (
            select 1 from asset_devices ad join devices sd on sd.id=ad."deviceId"
            where ad."assetId"=fi.asset_id and ad."deviceId"=alerts."deviceId"
              and sd."isDemo"=fa."isDemo"
          ))
        )
      )`
    : sql`true`;
}
