import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { inventoryFilter, listInventory } from "./inventory";
import { requestedDataWorkspace } from "../shared/data-workspace";
import {
  factoryLayoutDocument,
  type FactoryLayoutDocument,
  type SavedFactoryLayout,
} from "../shared/factory-layout";

const identity = z.object({
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Layout not found in your workspace.",
  });
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Layout storage is unavailable. Your browser draft is retained.",
    });
  return db;
}
const scope = (cookie?: string) =>
  requestedDataWorkspace(cookie) === "live" ? "live" : "configured";
type Row = {
  id: string;
  version: number;
  document: FactoryLayoutDocument;
  updated_at: Date | string;
  archived_at: Date | string | null;
};
const saved = (r: Row): SavedFactoryLayout => ({
  id: r.id,
  version: Number(r.version),
  document: factoryLayoutDocument.parse(r.document),
  updatedAt: new Date(r.updated_at).toISOString(),
  archived: !!r.archived_at,
});
async function visibleRefs() {
  const result = await listInventory({
    ...inventoryFilter.parse({}),
    pageSize: 5000,
  });
  if (result.total > 5000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select a smaller inventory before creating a layout.",
    });
  return new Set(result.items.map((i) => i.ref));
}

export const factoryLayoutsRouter = router({
  list: viewerProcedure
    .input(
      z
        .object({ archived: z.boolean().default(false) })
        .default({ archived: false }),
    )
    .query(async ({ ctx, input }) => {
      const db = await database();
      return db.execute<{
        id: string;
        name: string;
        version: number;
        updatedAt: string;
        items: number;
      }>(
        sql`select id,name,version,updated_at::text as "updatedAt",jsonb_array_length(document->'placements')::int as items from factory_layouts where owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)} and (archived_at is not null)=${input.archived} order by updated_at desc limit 50`,
      );
    }),
  get: viewerProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const db = await database(),
        [row] = await db.execute<Row>(
          sql`select * from factory_layouts where id=${input.id} and owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)} limit 1`,
        );
      if (!row) throw missing();
      const result = saved(row),
        refs = await visibleRefs(),
        visible = result.document.placements.filter((p) => refs.has(p.ref));
      return {
        ...result,
        omittedItems: result.document.placements.length - visible.length,
        document: { ...result.document, placements: visible },
      };
    }),
  save: viewerProcedure
    .input(
      z
        .object({
          id: z.uuid().optional(),
          expectedVersion: z.number().int().min(0),
          document: factoryLayoutDocument,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const refs = await visibleRefs();
      if (input.document.placements.some((p) => !refs.has(p.ref)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This layout includes an item unavailable in your current workspace. Refresh the inventory before saving.",
        });
      const db = await database();
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(741210,${ctx.user.id})`,
        );
        if (input.id) {
          const [own] = await tx.execute<Row>(
            sql`select * from factory_layouts where id=${input.id} and owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)} and archived_at is null for update`,
          );
          if (!own) throw missing();
          if (own.version !== input.expectedVersion)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This layout has a newer saved version. Reopen it or save your draft as a new layout.",
            });
          const [updated] = await tx.execute<Row>(
            sql`update factory_layouts set name=${input.document.name},document=${JSON.stringify(input.document)}::jsonb,version=version+1,updated_at=now() where id=${input.id} and owner_id=${ctx.user.id} returning *`,
          );
          return saved(updated);
        }
        const [counts] = await tx.execute<{ total: number; active: number }>(
          sql`select count(*)::int as total,count(*) filter(where archived_at is null)::int as active from factory_layouts where owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)}`,
        );
        if (counts.total >= 50 || counts.active >= 20)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "You can keep up to 20 active layouts and 50 layouts including the archive.",
          });
        if (input.expectedVersion !== 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A new layout must start with version zero.",
          });
        const [created] = await tx.execute<Row>(
          sql`insert into factory_layouts(id,owner_id,layout_scope,name,document) values(${randomUUID()},${ctx.user.id},${scope(ctx.req.headers.cookie)},${input.document.name},${JSON.stringify(input.document)}::jsonb) returning *`,
        );
        return saved(created);
      });
    }),
  archive: viewerProcedure
    .input(identity.extend({ archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(741210,${ctx.user.id})`,
        );
        const [own] = await tx.execute<Row>(
          sql`select * from factory_layouts where id=${input.id} and owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)} for update`,
        );
        if (!own) throw missing();
        if (own.version !== input.expectedVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Refresh this layout before changing its archive state.",
          });
        if (!input.archived) {
          const [n] = await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from factory_layouts where owner_id=${ctx.user.id} and layout_scope=${scope(ctx.req.headers.cookie)} and archived_at is null`,
          );
          if (n.n >= 20 && own.archived_at)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Archive an active layout before restoring another.",
            });
        }
        const [updated] = await tx.execute<Row>(
          sql`update factory_layouts set archived_at=${input.archived ? sql`now()` : sql`null`},version=version+1,updated_at=now() where id=${input.id} and owner_id=${ctx.user.id} returning *`,
        );
        return saved(updated);
      });
    }),
});
