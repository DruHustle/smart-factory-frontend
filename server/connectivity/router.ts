import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, viewerProcedure, engineerProcedure } from "../_core/trpc";
import { demoOnlyRead } from "../demoData";
import {
  connectivityId,
  industrialConnectionSchema,
  industrialDrivers,
} from "../../shared/industrial-connectivity";
import {
  listConnectivityGateways,
  getConnectivity,
  saveConnectivity,
  publishConnectivity,
  probeConnectivity,
  connectivityHistory,
  connectivityAssetTags,
} from "./store";
import { demoConnectivity, demoConnectivityGateway } from "./demo";

const gatewayInput = z.object({ gatewayDeviceId: connectivityId }).strict();
const revisionInput = gatewayInput
  .extend({
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export const connectivityRouter = router({
  drivers: viewerProcedure.query(() => industrialDrivers),
  gateways: viewerProcedure.query(() =>
    demoOnlyRead() ? [demoConnectivityGateway] : listConnectivityGateways(),
  ),
  get: viewerProcedure.input(gatewayInput).query(({ input, ctx }) => {
    if (demoOnlyRead()) {
      if (input.gatewayDeviceId !== demoConnectivityGateway.gatewayDeviceId)
        throw new TRPCError({ code: "NOT_FOUND" });
      return demoConnectivity();
    }
    return getConnectivity(
      input.gatewayDeviceId,
      ["engineer", "admin"].includes(ctx.user.role),
    );
  }),
  save: engineerProcedure
    .input(
      revisionInput
        .extend({ connections: z.array(industrialConnectionSchema).max(16) })
        .strict(),
    )
    .mutation(({ input, ctx }) => saveConnectivity(input, ctx.user.id)),
  publish: engineerProcedure
    .input(revisionInput)
    .mutation(({ input }) =>
      publishConnectivity(input.gatewayDeviceId, input.expectedRevision),
    ),
  probe: engineerProcedure
    .input(
      revisionInput
        .extend({ connection: industrialConnectionSchema })
        .strict()
        .refine(
          (input) =>
            new TextEncoder().encode(JSON.stringify(input)).byteLength <= 63000,
          "Probe configuration exceeds its command payload budget",
        ),
    )
    .mutation(({ input, ctx }) => probeConnectivity(input, ctx.user.id)),
  assetTags: viewerProcedure
    .input(z.object({ assetId: z.string().trim().min(1).max(512) }).strict())
    .query(({ input }) =>
      demoOnlyRead() ? [] : connectivityAssetTags(input.assetId),
    ),
  history: viewerProcedure
    .input(
      gatewayInput
        .extend({
          connectionId: connectivityId,
          tagId: connectivityId,
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
    )
    .query(({ input }) => {
      if (demoOnlyRead()) {
        if (input.gatewayDeviceId !== demoConnectivityGateway.gatewayDeviceId)
          throw new TRPCError({ code: "NOT_FOUND" });
        return demoConnectivity()
          .observations.filter((o) => o.connectionId === input.connectionId)
          .flatMap((o) =>
            o.tags
              .filter((t) => t.tagId === input.tagId)
              .map((t) => ({
                eventId: o.eventId,
                observedAt: o.observedAt,
                configurationRevision: o.configurationRevision,
                currentEligible: false,
                ...t,
              })),
          );
      }
      return connectivityHistory(input);
    }),
});
