import { operatingEvidence } from "../operatingEvidence";
import { sql } from "drizzle-orm";
import { auditPage, connectionSummary } from "../administration";
import { z } from "zod";
import {
  adminProcedure,
  engineerProcedure,
  publicProcedure,
  router,
  viewerProcedure,
} from "./trpc";
import * as db from "../db";
import { demoDataEnabled } from "../demoData";

export const systemRouter = router({
  operations: adminProcedure.query(() => operatingEvidence()),
  audit: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(0).max(100000).default(0),
        search: z.string().trim().max(100).default(""),
      }),
    )
    .query(({ input }) => auditPage(input.page, input.search)),
  connections: engineerProcedure.query(() => connectionSummary()),
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }),
    )
    .query(() => ({
      ok: true,
    })),

  showcase: viewerProcedure.query(async () => {
    if (!demoDataEnabled()) return null;
    const connection = await db.getDb();
    if (!connection) return null;
    const [row] = await connection.execute(
      sql`select value from system_settings where key='showcase_v1'`,
    );
    return (
      (row?.value as import("../../shared/showcase").Showcase | undefined) ??
      null
    );
  }),
  demoData: viewerProcedure.query(() => ({ enabled: demoDataEnabled() })),

  setDemoData: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      // Viewing approved fixtures never seeds an operational installation.
      return {
        enabled: await db.setDemoDataSetting(input.enabled, ctx.user.id),
      };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      }),
    )
    .mutation(async ({ input }) => {
      throw new (await import("@trpc/server")).TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This legacy notification endpoint is retired. Use the owner-scoped notification inbox and configured delivery workflow.",
      });
    }),
});
