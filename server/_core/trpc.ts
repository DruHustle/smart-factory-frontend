import { nativeEvent } from "../security/runtime";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { demonstrationOnly, DEMONSTRATION_READ_ONLY } from "../../shared/access-policy";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (process.env.NODE_ENV === "production" && error.code === "INTERNAL_SERVER_ERROR") {
      // Database/SDK errors can contain SQL parameters and implementation details.
      return { ...shape, message: "The request could not be completed. Please try again shortly.", data: { ...shape.data, stack: undefined } };
    }
    return shape;
  },
});

export const router = t.router;
const observeDecisions = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (!result.ok && ["FORBIDDEN", "UNAUTHORIZED"].includes(result.error.code) && path !== "auth.login")
    await nativeEvent("auth.authorization_denied", { service: path.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128), outcome: "denied", reasonCode: result.error.code }, "An application access request was denied.");
  return result;
});
const accessBoundary = t.middleware(({ ctx, next, type, path }) => {
  if (ctx.user?.passwordChangeRequired && !["auth.me", "auth.login", "auth.logout", "auth.changePassword"].includes(path))
    throw new TRPCError({ code: "FORBIDDEN", message: "Change your temporary password before opening the factory workspace." });
  // Central containment includes future routers and runs before their side effects.
  // Signing in/out remains available; neither operation grants operational writes.
  if (type === "mutation" && !["auth.login", "auth.logout", "assistant.ask"].includes(path) && demonstrationOnly(ctx.user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: DEMONSTRATION_READ_ONLY });
  }
  return next({ ctx });
});
export const publicProcedure = t.procedure.use(observeDecisions).use(accessBoundary);

const requireUser = t.middleware(async opts => {
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

function requireMinimumRole(minimumRole: "viewer" | "operator" | "engineer" | "admin") {
  return protectedProcedure.use(t.middleware(({ ctx, next }) => {
    if (!ctx.user || (roleRank[ctx.user.role] ?? -1) < roleRank[minimumRole]) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${minimumRole} access` });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }));
}

export const viewerProcedure = requireMinimumRole("viewer");
export const operatorProcedure = requireMinimumRole("operator");
export const engineerProcedure = requireMinimumRole("engineer");

export const adminProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
