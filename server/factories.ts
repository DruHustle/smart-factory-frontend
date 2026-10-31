import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  viewerProcedure,
  engineerProcedure,
  adminProcedure,
} from "./_core/trpc";
import { getDb } from "./db";
import * as records from "./db";
import {
  currentRequestDatabase,
  withRequestDatabase,
  type ApplicationDatabase,
} from "./database-scope";
import {
  inventoryFilter,
  inventoryItemsByRefs,
  listInventory,
} from "./inventory";
import { withVisibility } from "./demoData";
import {
  factoryIdentity,
  namedFactoryDraft,
  newFactoryItem,
  type NamedFactory,
  type NamedFactoryDraft,
  type NamedFactorySummary,
  type PhysicalDimensions,
} from "../shared/named-factory";
import { layoutItemRef } from "../shared/factory-layout";
import {
  assets,
  devices,
  assetVersions,
  assetLifecycleEvents,
  assetDevices,
} from "../drizzle/schema";
import { plannedAssetShell } from "./planned-assets";
import { deleteAssetInventoryRecord } from "./inventory-deletion";

type Queryable = Pick<ApplicationDatabase, "execute">;
type Definition = {
  id: string;
  name: string;
  width: number;
  depth: number;
  zones: NamedFactoryDraft["document"]["zones"];
  version: number;
  updated_at: Date | string;
};
type Member = {
  ref: string;
  asset_id: number | null;
  device_id: number | null;
  origin: "planned" | "attached";
  inventory_tag: string;
  x: number;
  z: number;
  rotation: number;
  zone_id: string | null;
  width: number;
  depth: number;
  height: number;
};
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Factory not found in this installation.",
  });
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Factory storage is unavailable. Your draft is retained.",
    });
  return db;
}
async function definition(db: Queryable, id: string, expectedVersion?: number) {
  const [row] = await db.execute<Definition>(
    sql`select * from factories where id=${id} ${expectedVersion == null ? sql`` : sql`for no key update`}`,
  );
  if (!row) throw unavailable();
  if (expectedVersion != null && Number(row.version) !== expectedVersion)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A teammate saved a newer factory version. Reopen it before saving; your browser draft is retained.",
    });
  return row;
}
async function members(db: Queryable, id: string) {
  return db.execute<Member>(
    sql`select * from factory_items where factory_id=${id} order by ref`,
  );
}
export async function snapshot(id: string): Promise<NamedFactory> {
  const db = await database(),
    row = await definition(db, id),
    entries = await members(db, id);
  const inventory = await inventoryItemsByRefs(entries.map((p) => p.ref));
  const byRef = new Map(inventory.map((item) => [item.ref, item]));
  const draft = namedFactoryDraft.parse({
    document: {
      name: row.name,
      width: Number(row.width),
      depth: Number(row.depth),
      zones: row.zones,
      placements: entries.map((p) => ({
        ref: p.ref,
        x: Number(p.x),
        z: Number(p.z),
        rotation: Number(p.rotation),
        zoneId: p.zone_id,
      })),
    },
    dimensions: Object.fromEntries(
      entries.map((p) => [
        p.ref,
        {
          width: Number(p.width),
          depth: Number(p.depth),
          height: Number(p.height),
        },
      ]),
    ),
    tags: Object.fromEntries(entries.map((p) => [p.ref, p.inventory_tag])),
  });
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    depth: row.depth,
    version: Number(row.version),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...draft,
    total: entries.length,
    unavailableItems: entries.filter((p) => !byRef.has(p.ref)).length,
    items: entries.flatMap((p) => {
      const item = byRef.get(p.ref);
      return item
        ? [{ ...item, factoryId: id, factoryTag: p.inventory_tag }]
        : [];
    }),
  };
}
function domainError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const e = error as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code;
  if (code === "23505")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "That factory name, factory tag, device ID or equipment assignment is already in use.",
    });
  if (code === "23503")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This item still has linked records. Resolve its connections before deleting it.",
    });
  if (code === "40P01" || code === "40001")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This factory changed during the operation. Refresh and try again; your draft is retained.",
    });
  throw error;
}
async function write<T>(run: (db: Queryable) => Promise<T>): Promise<T> {
  try {
    return await (
      await database()
    ).transaction((tx) =>
      withRequestDatabase(tx, async () => {
        const result = await run(tx);
        // Check final tags after a batch, allowing two equipment tags to be swapped atomically.
        await tx.execute(sql`set constraints factory_items_tag immediate`);
        return result;
      }),
    );
  } catch (error) {
    domainError(error);
  }
}
async function resolvedInventory(refs: string[]) {
  const items = await inventoryItemsByRefs(refs);
  if (items.length !== refs.length || items.some((i) => i.isDemo))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose available operational inventory. Shared demonstration records stay in the resettable demo.",
    });
  return new Map(items.map((item) => [item.ref, item]));
}
async function attachRows(
  db: Queryable,
  id: string,
  draft: NamedFactoryDraft,
  refs: string[],
  origin: "planned" | "attached",
) {
  if (!refs.length) return;
  const allowed = await resolvedInventory(refs);
  const equipment = refs
    .filter((ref) => ref.startsWith("equipment:"))
    .map((ref) => ref.split(":")[1]);
  const backing = equipment.length
    ? await db.execute<{ id: string; asset_id: number }>(
        sql`select id::text,asset_id from equipment_workspaces where id in (${sql.join(
          equipment.map((id) => sql`${id}::uuid`),
          sql`,`,
        )})`,
      )
    : [];
  const assetsByEquipment = new Map(
    backing.map((row) => [row.id, row.asset_id]),
  );
  const rows = refs.map((ref) => {
    const item = allowed.get(ref)!,
      p = draft.document.placements.find((p) => p.ref === ref)!;
    return {
      ref,
      asset_id:
        item.kind === "asset"
          ? Number(item.id)
          : item.kind === "equipment"
            ? assetsByEquipment.get(item.id)
            : null,
      device_id: item.kind === "device" ? Number(item.id) : null,
      origin,
      inventory_tag: draft.tags[ref],
      x: p.x,
      z: p.z,
      rotation: p.rotation,
      zone_id: p.zoneId,
      ...draft.dimensions[ref],
    };
  });
  if (rows.some((row) => row.asset_id == null && row.device_id == null))
    throw unavailable();
  await db.execute(sql`insert into factory_items(ref,factory_id,asset_id,device_id,origin,inventory_tag,x,z,rotation,zone_id,width,depth,height)
    select r.ref,${id}::uuid,r.asset_id,r.device_id,r.origin,r.inventory_tag,r.x,r.z,r.rotation,r.zone_id,r.width,r.depth,r.height
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(ref text,asset_id integer,device_id integer,origin text,inventory_tag text,x double precision,z double precision,rotation double precision,zone_id uuid,width double precision,depth double precision,height double precision)`);
}
function openPosition(factory: NamedFactoryDraft, size: PhysicalDimensions) {
  const w = factory.document.width,
    d = factory.document.depth;
  const positions = [{ x: 0, z: 0 }];
  const sx = Math.max(size.width + 0.5, 1),
    sz = Math.max(size.depth + 0.5, 1);
  for (
    let z = -d / 2 + size.depth / 2 + 0.1;
    z <= d / 2 - size.depth / 2 && positions.length < 10000;
    z += sz
  )
    for (
      let x = -w / 2 + size.width / 2 + 0.1;
      x <= w / 2 - size.width / 2 && positions.length < 10000;
      x += sx
    )
      positions.push({ x, z });
  const available = positions.find(
    (point) =>
      Math.abs(point.x) + size.width / 2 <= w / 2 &&
      Math.abs(point.z) + size.depth / 2 <= d / 2 &&
      factory.document.placements.every((p) => {
        const other = factory.dimensions[p.ref],
          a = (p.rotation * Math.PI) / 180;
        const width =
          Math.abs(Math.cos(a)) * other.width +
          Math.abs(Math.sin(a)) * other.depth;
        const depth =
          Math.abs(Math.sin(a)) * other.width +
          Math.abs(Math.cos(a)) * other.depth;
        return (
          Math.abs(point.x - p.x) >= (size.width + width) / 2 + 0.2 ||
          Math.abs(point.z - p.z) >= (size.depth + depth) / 2 + 0.2
        );
      }),
  );
  if (!available)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Make room on this floor or increase its dimensions before adding this item.",
    });
  return { ...available, rotation: 0, zoneId: null };
}
const versioned = factoryIdentity;
const activityId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(
    (v) => /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n,
    "Invalid activity identity",
  );
export const factoriesRouter = router({
  list: viewerProcedure.query(async () => {
    const db = await database();
    const rows = await db.execute<Definition & { items: number }>(
      sql`select f.*,count(i.ref)::int as items from factories f left join factory_items i on i.factory_id=f.id group by f.id order by f.updated_at desc,f.id limit 100`,
    );
    return rows.map(
      (row) =>
        ({
          id: row.id,
          name: row.name,
          width: row.width,
          depth: row.depth,
          version: row.version,
          items: row.items,
          updatedAt: new Date(row.updated_at).toISOString(),
        }) satisfies NamedFactorySummary,
    );
  }),
  get: viewerProcedure
    .input(z.object({ id: z.uuid() }).strict())
    .query(async ({ input }) => {
      const db = await database();
      if (currentRequestDatabase()) return snapshot(input.id);
      return db.transaction(
        (tx) => withRequestDatabase(tx, () => snapshot(input.id)),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    }),
  available: viewerProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(100).default(""),
          page: z.number().int().min(0).max(100000).default(0),
        })
        .default({ search: "", page: 0 }),
    )
    .query(({ input }) =>
      withVisibility({ demoOnly: false, includeDemo: false }, () =>
        listInventory(
          inventoryFilter.parse({ ...input, unassignedOnly: true }),
        ),
      ),
    ),
  create: engineerProcedure
    .input(namedFactoryDraft)
    .mutation(({ ctx, input }) =>
      write(async (db) => {
        // Serialize the bounded installation-wide factory directory.
        await db.execute(sql`select pg_advisory_xact_lock(741211,0)`);
        const [count] = await db.execute<{ count: number }>(
          sql`select count(*)::int as count from factories`,
        );
        if (count.count >= 100)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This installation supports 100 named factories.",
          });
        const id = randomUUID(),
          doc = input.document;
        await db.execute(
          sql`insert into factories(id,name,width,depth,zones,created_by) values(${id},${doc.name},${doc.width},${doc.depth},${JSON.stringify(doc.zones)}::jsonb,${ctx.user.id})`,
        );
        await attachRows(
          db,
          id,
          input,
          doc.placements.map((p) => p.ref),
          "attached",
        );
        return snapshot(id);
      }),
    ),
  save: engineerProcedure
    .input(versioned.extend({ draft: namedFactoryDraft }))
    .mutation(({ input }) =>
      write(async (db) => {
        await definition(db, input.id, input.expectedVersion);
        const current = await members(db, input.id),
          refs = new Set(current.map((p) => p.ref)),
          draft = input.draft,
          doc = draft.document;
        if (
          refs.size !== doc.placements.length ||
          doc.placements.some((p) => !refs.has(p.ref))
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Inventory changed. Refresh before saving. Use Add item or the confirmed bin action to change inventory.",
          });
        await db.execute(
          sql`update factories set name=${doc.name},width=${doc.width},depth=${doc.depth},zones=${JSON.stringify(doc.zones)}::jsonb where id=${input.id}`,
        );
        const updates = doc.placements.map((p) => ({
          ref: p.ref,
          x: p.x,
          z: p.z,
          rotation: p.rotation,
          zone_id: p.zoneId,
          inventory_tag: draft.tags[p.ref],
          ...draft.dimensions[p.ref],
        }));
        if (updates.length)
          await db.execute(sql`update factory_items i set x=r.x,z=r.z,rotation=r.rotation,zone_id=r.zone_id,inventory_tag=r.inventory_tag,width=r.width,depth=r.depth,height=r.height
      from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) as r(ref text,x double precision,z double precision,rotation double precision,zone_id uuid,inventory_tag text,width double precision,depth double precision,height double precision)
      where i.factory_id=${input.id} and i.ref=r.ref`);
        return snapshot(input.id);
      }),
    ),
  add: engineerProcedure
    .input(versioned.extend({ item: newFactoryItem }))
    .mutation(({ input, ctx }) =>
      write(async (db) => {
        await definition(db, input.id, input.expectedVersion);
        const current = await snapshot(input.id);
        if (current.total >= 5000)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This factory supports 5,000 items.",
          });
        const item = input.item,
          point = openPosition(current, item.dimensions),
          identity = randomUUID();
        let ref: string;
        if (item.kind === "asset") {
          const identifier = "urn:smart-factory:planned:" + identity;
          const [asset] = await (
            await database()
          )
            .insert(assets)
            .values({
              assetId: identifier,
              name: item.name,
              assetType: item.itemType,
              lifecycleStage: "planned",
              isDemo: false,
              aasShell: plannedAssetShell(identifier, item.name, item.itemType),
              aasSubmodels: [],
            })
            .returning();
          await (await database()).insert(assetVersions).values({
            assetId: asset.id,
            version: 1,
            changeType: "created",
            changeNote: "Planned factory inventory record",
            changedBy: ctx.user.id,
            snapshot: asset as unknown as Record<string, unknown>,
          });
          await (await database()).insert(assetLifecycleEvents).values({
            assetId: asset.id,
            fromStage: null,
            toStage: "planned",
            changedBy: ctx.user.id,
            note: "Added to factory floor; connection not configured",
          });
          ref = "asset:" + asset.id;
        } else {
          const [device] = await (
            await database()
          )
            .insert(devices)
            .values({
              deviceId: item.identifier,
              name: item.name,
              type: item.itemType as typeof devices.$inferInsert.type,
              status: "offline",
              isDemo: false,
              metadata: { connectionMode: "unconfigured" },
            })
            .returning();
          ref = "device:" + device.id;
        }
        const draft = namedFactoryDraft.parse({
          document: {
            ...current.document,
            placements: [...current.document.placements, { ref, ...point }],
          },
          dimensions: { ...current.dimensions, [ref]: item.dimensions },
          tags: {
            ...current.tags,
            [ref]:
              item.identifier ||
              item.itemType
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "-")
                .slice(0, 24) +
                "-" +
                identity.slice(0, 8),
          },
        });
        await attachRows(db, input.id, draft, [ref], "planned");
        return { factory: await snapshot(input.id), ref };
      }),
    ),
  attach: engineerProcedure
    .input(
      versioned.extend({
        ref: layoutItemRef,
        dimensions: newFactoryItem.shape.dimensions,
        tag: z.string().trim().min(1).max(128),
      }),
    )
    .mutation(({ input }) =>
      write(async (db) => {
        await definition(db, input.id, input.expectedVersion);
        const current = await snapshot(input.id);
        if (current.total >= 5000)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This factory supports 5,000 items.",
          });
        const point = openPosition(current, input.dimensions);
        const draft = namedFactoryDraft.parse({
          document: {
            ...current.document,
            placements: [
              ...current.document.placements,
              { ref: input.ref, ...point },
            ],
          },
          dimensions: { ...current.dimensions, [input.ref]: input.dimensions },
          tags: { ...current.tags, [input.ref]: input.tag },
        });
        await attachRows(db, input.id, draft, [input.ref], "attached");
        return { factory: await snapshot(input.id), ref: input.ref };
      }),
    ),
  deleteItem: adminProcedure
    .input(versioned.extend({ ref: layoutItemRef }))
    .mutation(({ input }) =>
      write(async (db) => {
        await definition(db, input.id, input.expectedVersion);
        const [member] = await db.execute<Member>(
          sql`select * from factory_items where factory_id=${input.id} and ref=${input.ref} for update`,
        );
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This item is not in the selected factory.",
          });
        if (member.device_id) {
          const linked = await (await database())
            .select({ id: assetDevices.id })
            .from(assetDevices)
            .where(eq(assetDevices.deviceId, member.device_id))
            .limit(1);
          if (linked.length)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Disconnect this device from its linked assets before deleting it.",
            });
        }
        let cleanupWarnings: string[] = [];
        if (member.asset_id) {
          const localStandalone = input.ref.startsWith("equipment:")
            ? (
                await db.execute(
                  sql`select id from equipment_workspaces where id=${input.ref.slice(10)}::uuid and asset_id=${member.asset_id} and is_standalone=true`,
                )
              ).length > 0
            : false;
          const deletion = await deleteAssetInventoryRecord(member.asset_id, {
            localStandalone,
          });
          cleanupWarnings = deletion.edgeSyncFailures.map(
            (id) =>
              "Gateway configuration sync failed for " +
              id +
              ". Reconcile its configuration before operating connected equipment.",
          );
          if (cleanupWarnings.length)
            await db.execute(
              sql`select record_factory_activity(${input.id},'inventory.cleanup_warning',${input.ref},null,${JSON.stringify({ warnings: cleanupWarnings })}::jsonb)`,
            );
        } else if (
          member.device_id &&
          !(await records.deleteDevice(member.device_id))
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Inventory item not found.",
          });
        return { ...(await snapshot(input.id)), cleanupWarnings };
      }),
    ),
  activity: router({
    list: viewerProcedure
      .input(
        z
          .object({
            factoryId: z.uuid(),
            cursor: activityId.optional(),
            actorId: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .query(async ({ input }) => {
        const db = await database();
        await definition(db, input.factoryId);
        const rows = await db.execute<{
          id: string;
          factoryId: string;
          changeSet: string;
          actorId: number | null;
          actorName: string;
          actorRole: string;
          action: string;
          targetRef: string | null;
          label: string | null;
          at: string;
        }>(
          sql`select id::text,factory_id as "factoryId",change_set as "changeSet",actor_id as "actorId",actor_name as "actorName",actor_role as "actorRole",action,target_ref as "targetRef",coalesce(after_value->>'name',before_value->>'name',after_value->>'tag',before_value->>'tag',target_ref) as label,created_at::text as at from factory_activity where factory_id=${input.factoryId} ${input.cursor ? sql`and id<${input.cursor}::bigint` : sql``} ${input.actorId ? sql`and actor_id=${input.actorId}` : sql``} order by factory_activity.id desc limit 51`,
        );
        return {
          items: rows
            .slice(0, 50)
            .map((row) => ({ ...row, at: new Date(row.at).toISOString() })),
          nextCursor: rows.length > 50 ? rows[49].id : null,
        };
      }),
    get: viewerProcedure
      .input(
        z
          .object({
            factoryId: z.uuid(),
            id: activityId,
          })
          .strict(),
      )
      .query(async ({ input }) => {
        const db = await database();
        await definition(db, input.factoryId);
        const [row] = await db.execute<{
          id: string;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
        }>(
          sql`select id::text,before_value as before,after_value as after from factory_activity where factory_id=${input.factoryId} and id=${input.id}::bigint`,
        );
        if (!row) throw unavailable();
        return row;
      }),
  }),
});
