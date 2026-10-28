import { demoOnlyRead } from "../demoData";
import { operatorAction } from "./errors";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure, engineerProcedure } from "../_core/trpc";
import {
  demonstrationOnly,
  operationalWritesAllowed,
} from "../../shared/access-policy";
import { modelCatalog, localBindingSchema } from "./packages";
import * as local from "./local";
import { referenceModels } from "../../shared/factory-models";
const writer = engineerProcedure.use(({ ctx, next }) => {
  if (demonstrationOnly(ctx.user) || demoOnlyRead())
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The public equipment demonstration is read-only",
    });
  return next({ ctx });
});
export const equipmentRouter = router({
  references: viewerProcedure.query(() => referenceModels),
  reference: viewerProcedure
    .input(z.object({ slug: z.string().min(1).max(60) }))
    .query(async ({ input }) => {
      const descriptor = referenceModels.find(
        (model) => model.slug === input.slug,
      );
      if (!descriptor)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference model unavailable",
        });
      const t = await operatorAction(() => local.template(descriptor.revision));
      return {
        ...descriptor,
        components: t.components.map((component) => ({
          ...component,
          installedComponentId: component.templateComponentId,
        })),
        initialViewDirection: t.initialViewDirection,
        modelUrl: `/api/equipment/reference/${descriptor.slug}/model?revision=${encodeURIComponent(t.revision)}`,
      };
    }),
  access: viewerProcedure.query(({ ctx }) => ({
    canWrite:
      operationalWritesAllowed(ctx.user) &&
      !demoOnlyRead() &&
      ["engineer", "admin"].includes(ctx.user.role),
    demoOnly: demonstrationOnly(ctx.user) || demoOnlyRead(),
  })),
  bindingTemplate: writer
    .input(z.object({ revision: z.string().min(1).max(128) }))
    .query(({ input }) =>
      operatorAction(async () => {
        const t = await local.template(input.revision);
        return {
          components: t.components.map((c) => ({
            templateComponentId: c.templateComponentId,
            name: c.name,
          })),
          bindings: t.bindings,
        };
      }),
    ),
  template: viewerProcedure.query(() => operatorAction(() => local.template())),
  models: viewerProcedure.query(async ({ ctx }) => ({
    bundled: await operatorAction(() => local.template()),
    bundledModels: await operatorAction(() => local.bundledModelCatalog()),
    imported:
      demonstrationOnly(ctx.user) || demoOnlyRead() ? [] : await modelCatalog(),
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
