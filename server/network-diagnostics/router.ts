import { z } from "zod";
import { router, viewerProcedure, engineerProcedure } from "../_core/trpc";
import { demoOnlyRead } from "../demoData";
import {
  networkSnapshot,
  networkScenarios,
} from "../../shared/network-diagnostics";
import { demoNetwork } from "./demo";
import { networkView, saveNetworkSnapshot } from "./store";
export const networkDiagnosticsRouter = router({
  overview: viewerProcedure
    .input(
      z
        .object({ scenario: z.enum(networkScenarios).default("normal") })
        .default({ scenario: "normal" }),
    )
    .query(({ input }) =>
      demoOnlyRead() ? demoNetwork(input.scenario) : networkView(),
    ),
  importSnapshot: engineerProcedure
    .input(networkSnapshot)
    .mutation(({ input, ctx }) =>
      saveNetworkSnapshot({ ...input, source: "operator-import" }, ctx.user.id),
    ),
});
