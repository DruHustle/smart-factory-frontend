import { demoOnlyRead } from "../demoData";
import { operatorAction } from "../equipment/errors";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, engineerProcedure, adminProcedure } from "../_core/trpc";
import { demonstrationOnly } from "../../shared/access-policy";
import * as store from "./store";
import { registrationSchema, mappingSchema, CONTRACT } from "./contract";
import { integrationConfig } from "./config";
const privateEngineer = engineerProcedure.use(({ ctx, next }) => {
  if (demonstrationOnly(ctx.user) || demoOnlyRead())
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Public demo accounts cannot access private integration settings",
    });
  return next({ ctx });
});
const privateAdmin = adminProcedure.use(({ ctx, next }) => {
  if (demonstrationOnly(ctx.user) || demoOnlyRead())
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Public demo accounts cannot access private integration settings",
    });
  return next({ ctx });
});
export const onesaRouter = router({
  availability: engineerProcedure.query(({ ctx }) => ({
    privateAccess: !(demonstrationOnly(ctx.user) || demoOnlyRead()),
  })),
  status: privateEngineer.query(() => operatorAction(() => store.status())),
  history: privateEngineer.query(() => operatorAction(() => store.history())),
  previewRegistration: privateEngineer
    .input(registrationSchema)
    .mutation(({ input }) =>
      operatorAction(() => store.previewRegistration(input)),
    ),
  register: privateEngineer
    .input(
      z.object({
        registration: registrationSchema,
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ input, ctx }) =>
      operatorAction(() =>
        store.saveRegistration(
          input.registration,
          input.expectedVersion,
          ctx.user.id,
        ),
      ),
    ),
  previewMapping: privateEngineer
    .input(mappingSchema)
    .mutation(({ input }) => operatorAction(() => store.previewMapping(input))),
  map: privateEngineer
    .input(mappingSchema)
    .mutation(({ input, ctx }) =>
      operatorAction(() => store.saveMapping(input, ctx.user.id)),
    ),
  retry: privateAdmin.mutation(({ ctx }) =>
    operatorAction(() => store.retryQuarantine(ctx.user.id)),
  ),
  handoff: privateEngineer.query(async () => {
    const c = integrationConfig();
    if (!c)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Integration is disabled",
      });
    return {
      schema: CONTRACT,
      consumerRegistration: "unavailable",
      sourceMetadata:
        (await operatorAction(() => store.status())).equipment ?? [],
      scope: { workspaceId: c.workspaceId, installationId: c.installationId },
      consumerOwned: [
        "annotations",
        "rules",
        "history",
        "workspace permissions",
        "geometry approvals",
      ],
    };
  }),
});
