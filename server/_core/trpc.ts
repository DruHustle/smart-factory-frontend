import { withMutationActor } from "../database-scope";
import { requestedDataWorkspace } from "../../shared/data-workspace";
import { rejectFixtureMutation } from "../demoTarget";
import { nativeEvent } from "../security/runtime";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  demonstrationOnly,
  DEMONSTRATION_READ_ONLY,
} from "../../shared/access-policy";
import { resolveVisibility, withVisibility } from "../demoData";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (
      process.env.NODE_ENV === "production" &&
      error.code === "INTERNAL_SERVER_ERROR"
    ) {
      // Database/SDK errors can contain SQL parameters and implementation details.
      return {
        ...shape,
        message:
          "The request could not be completed. Please try again shortly.",
        data: { ...shape.data, stack: undefined },
      };
    }
    return shape;
  },
});

export const router = t.router;
const observeDecisions = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (
    !result.ok &&
    ["FORBIDDEN", "UNAUTHORIZED"].includes(result.error.code) &&
    path !== "auth.login"
  )
    await nativeEvent(
      "auth.authorization_denied",
      {
        service: path.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128),
        outcome: "denied",
        reasonCode: result.error.code,
      },
      "An application access request was denied.",
    );
  return result;
});
const walkthroughQueries = new Set([
  "system.health",
  "system.demoData",
  "system.showcase",
  "system.infrastructure",
  "assistant.context",
  "assistant.providers",
  "inventory.list",
  "factory.floor",
  "networkDiagnostics.overview",
  "connectivity.drivers",
  "connectivity.gateways",
  "connectivity.get",
  "connectivity.history",
  "connectivity.assetTags",
  "inventory.item",
  "devices.monitor",
  "devices.heartbeatHistory",
  "devices.list",
  "devices.getById",
  "devices.getConnectedDevices",
  "devices.getConnectedAssets",
  "devices.getStats",
  "assets.getPublishedPassport",
  "assets.getPassport",
  "assets.list",
  "assets.getById",
  "assets.getAllForDevice",
  "assets.getForDevice",
  "assets.getShell",
  "assets.getLifecycle",
  "assets.getVersions",
  "assets.getConnections",
  "readings.getForDevice",
  "readings.getLatest",
  "readings.getLatestBatch",
  "readings.trend",
  "thresholds.getForDevice",
  "alerts.page",
  "alerts.history",
  "alerts.list",
  "alerts.getById",
  "alerts.getStats",
  "analytics.getCoverage",
  "analytics.getOverview",
  "analytics.getEnergy",
  "analytics.getEnergyConsumption",
  "analytics.getAssetTelemetry",
  "analytics.getLatestAssetTelemetry",
  "notifications.list",
  "notifications.page",
  "notifications.summary",
]);
const accessBoundary = t.middleware(
  async ({ ctx, next, type, path, getRawInput }) => {
    if (
      ctx.user?.passwordChangeRequired &&
      ![
        "auth.me",
        "auth.login",
        "auth.logout",
        "auth.changePassword",
        "auth.passwordResetPolicy",
        "auth.requestPasswordReset",
        "auth.resetPassword",
      ].includes(path)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Change your temporary password before opening the factory workspace.",
      });
    // Central containment includes future routers and runs before their side effects.
    // Signing in/out remains available; neither operation grants operational writes.
    if (
      type === "mutation" &&
      ![
        "auth.login",
        "auth.logout",
        "auth.requestRegistration",
        "auth.requestPasswordReset",
        "auth.resetPassword",
        "assistant.ask",
        "assistant.askSelected",
      ].includes(path) &&
      (demonstrationOnly(ctx.user) ||
        requestedDataWorkspace(ctx.req?.headers?.cookie) === "demo")
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: DEMONSTRATION_READ_ONLY,
      });
    }
    if (
      ctx.user &&
      (demonstrationOnly(ctx.user) ||
        requestedDataWorkspace(ctx.req?.headers?.cookie) === "demo") &&
      type === "query" &&
      !path.startsWith("auth.") &&
      !path.startsWith("security.") &&
      !path.startsWith("equipment.") &&
      !path.startsWith("onesa.") &&
      !walkthroughQueries.has(path)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Private administration and deployment records are unavailable in the shared walkthrough.",
      });
    return next({ ctx });
  },
);
const visibilityBoundary = t.middleware(
  async ({ ctx, next, type, path, getRawInput }) => {
    if (!ctx.user)
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    const user = ctx.user;
    if (path.startsWith("auth.")) return next({ ctx: { ...ctx, user } });
    if (type === "mutation")
      await rejectFixtureMutation(path, await getRawInput());
    ctx.visibility ??= resolveVisibility(
      ctx.user,
      requestedDataWorkspace(ctx.req?.headers?.cookie),
    );
    const policy = await ctx.visibility;
    const run = () =>
      withVisibility(policy, () => next({ ctx: { ...ctx, user } }));
    return type === "mutation" &&
      (/^(factories|assets|devices|equipment|thresholds|alerts|ota)\./.test(path) || path === "connectivity.save")
      ? withMutationActor(user, run)
      : run();
  },
);
export const publicProcedure = t.procedure
  .use(observeDecisions)
  .use(accessBoundary);

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireUser);

const roleRank: Record<string, number> = {
  user: 0, // Legacy accounts have viewer permissions.
  viewer: 0,
  operator: 1,
  engineer: 2,
  admin: 3,
};

function requireMinimumRole(
  minimumRole: "viewer" | "operator" | "engineer" | "admin",
) {
  return protectedProcedure
    .use(
      t.middleware(({ ctx, next }) => {
        if (
          !ctx.user ||
          (roleRank[ctx.user.role] ?? -1) < roleRank[minimumRole]
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Requires ${minimumRole} access`,
          });
        }
        return next({ ctx: { ...ctx, user: ctx.user } });
      }),
    )
    .use(visibilityBoundary);
}

export const viewerProcedure = requireMinimumRole("viewer");
export const operatorProcedure = requireMinimumRole("operator");
export const engineerProcedure = requireMinimumRole("engineer");

export const adminProcedure = protectedProcedure
  .use(
    t.middleware(async (opts) => {
      const { ctx, next } = opts;

      if (!ctx.user || ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
        },
      });
    }),
  )
  .use(visibilityBoundary);
