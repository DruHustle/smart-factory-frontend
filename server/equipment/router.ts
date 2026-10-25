import { operatorAction } from "./errors";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure, engineerProcedure } from "../_core/trpc";
import { isDemoAccount } from "../../shared/demo-accounts";
import { modelCatalog, localBindingSchema } from "./packages";
import * as local from "./local";
const writer = engineerProcedure.use(({ ctx, next }) => {
  if (
    process.env.ENABLE_DEMO_ACCOUNTS === "true" ||
    isDemoAccount(ctx.user.email ?? "") ||
    ctx.user.openId.startsWith("demo-")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The public equipment demonstration is read-only",
    });
  return next({ ctx });
});
export const equipmentRouter = router({
  access: viewerProcedure.query(({ ctx }) => ({
    canWrite:
      process.env.ENABLE_DEMO_ACCOUNTS !== "true" &&
      !isDemoAccount(ctx.user.email ?? "") &&
      !ctx.user.openId.startsWith("demo-") &&
      ["engineer", "admin"].includes(ctx.user.role),
    demoOnly: process.env.ENABLE_DEMO_ACCOUNTS === "true",
  })),
  template: viewerProcedure.query(() => operatorAction(() => local.template())),
  models: viewerProcedure.query(async () => ({
    bundled: await operatorAction(() => local.template()),
    imported:
      process.env.ENABLE_DEMO_ACCOUNTS === "true" ? [] : await modelCatalog(),
  })),
  previewModel: writer
    .input(
      z.object({
        id: z.uuid(),
        revision: z.string().max(128),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(({ input }) =>
      operatorAction(() =>
        local.modelChange(input.id, input.revision, input.expectedVersion),
      ),
    ),
  replaceModel: writer
    .input(
      z.object({
        id: z.uuid(),
        revision: z.string().max(128),
        expectedVersion: z.number().int().positive(),
        reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .mutation(({ input, ctx }) =>
      operatorAction(() =>
        local.replaceModel(
          input.id,
          input.revision,
          input.expectedVersion,
          input.reviewToken,
          ctx.user.id,
        ),
      ),
    ),
  list: viewerProcedure.query(() =>
    operatorAction(() => local.listEquipment()),
  ),
  get: viewerProcedure
    .input(
      z.object({
        id: z.uuid(),
        mode: z.enum(["live", "simulated"]).optional(),
      }),
    )
    .query(({ input }) =>
      operatorAction(() => local.workspace(input.id, input.mode)),
    ),
  rename: writer
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(200),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(({ input, ctx }) =>
      operatorAction(() =>
        local.renameEquipment(
          input.id,
          input.name,
          input.expectedVersion,
          ctx.user.id,
        ),
      ),
    ),
  create: writer
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(200),
          serialNumber: z.string().trim().min(1).max(128),
          kind: z.enum(["real", "simulated"]),
          templateRevision: z.string().max(128),
          existingAssetId: z.number().int().positive().optional(),
          sourceBindings: z.array(localBindingSchema).min(1).max(32).optional(),
        })
        .strict(),
    )
    .mutation(({ input, ctx }) =>
      operatorAction(() => local.createEquipment(input, ctx.user.id)),
    ),
  save: writer
    .input(local.workSchema)
    .mutation(({ input, ctx }) =>
      operatorAction(() => local.saveWork(input, ctx.user.id)),
    ),
  simulate: writer
    .input(
      z.object({
        id: z.uuid(),
        scenario: z.enum(["normal", "alarm", "recovery", "stale"]),
      }),
    )
    .mutation(({ input, ctx }) =>
      operatorAction(() =>
        local.simulate(input.id, input.scenario, ctx.user.id),
      ),
    ),
});
