import { z } from "zod";
import {
  router,
  viewerProcedure,
  engineerProcedure,
  operatorProcedure,
} from "../_core/trpc";
import { layoutItemRef } from "../../shared/factory-layout";
import {
  operationScope,
  operationScenarios,
  operationsConfiguration,
  productionPeriod,
} from "../../shared/operations";
import {
  operationsSummary,
  configureOperations,
  recordProduction,
  addHandover,
} from "./store";

export const operationsSummaryInput = operationScope
  .extend({
    at: z.number().int().positive().optional(),
    startTime: z.number().int().positive().optional(),
    endTime: z.number().int().positive().optional(),
    scenario: z.enum(operationScenarios).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.startTime == null) !== (v.endTime == null) ||
      (v.startTime != null &&
        v.endTime != null &&
        (v.endTime <= v.startTime || v.endTime - v.startTime > 7 * 86400000))
    )
      c.addIssue({
        code: "custom",
        message: "Choose an ordered analysis window of at most seven days.",
        path: ["endTime"],
      });
    if (
      (v.at ?? v.endTime ?? 0) > Date.now() + 60000 ||
      (v.endTime ?? 0) > Date.now() + 60000
    )
      c.addIssue({
        code: "custom",
        message: "Operational views cannot report future observations.",
        path: ["at"],
      });
  });
const version = z.number().int().min(0);
export const operationsRouter = router({
  summary: viewerProcedure
    .input(operationsSummaryInput)
    .query(({ input }) => operationsSummary(input)),
  configure: engineerProcedure
    .input(
      operationScope
        .extend({
          expectedVersion: version,
          configuration: operationsConfiguration,
        })
        .strict(),
    )
    .mutation(({ input, ctx }) => configureOperations(input, ctx.user)),
  recordProduction: engineerProcedure
    .input(
      operationScope
        .extend({ expectedVersion: version, period: productionPeriod })
        .strict(),
    )
    .mutation(({ input, ctx }) => recordProduction(input, ctx.user)),
  addHandover: operatorProcedure
    .input(
      operationScope
        .extend({
          expectedVersion: version,
          at: z
            .number()
            .int()
            .positive()
            .refine(
              (at) => at <= Date.now() + 60000,
              "Future shifts cannot be recorded as completed observations.",
            ),
          text: z.string().trim().min(1).max(4000),
          nextStep: z.string().trim().min(1).max(1000),
          assetRefs: z.array(layoutItemRef).max(20).default([]),
          incidentIds: z.array(z.number().int().positive()).max(20).default([]),
        })
        .strict()
        .superRefine((v, c) => {
          if (
            new Set(v.assetRefs).size !== v.assetRefs.length ||
            new Set(v.incidentIds).size !== v.incidentIds.length
          )
            c.addIssue({
              code: "custom",
              message: "Link each item or incident once.",
            });
        }),
    )
    .mutation(({ input, ctx }) => addHandover(input, ctx.user)),
});
