import { individualSecurityUser } from "./users";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  viewerProcedure,
  operatorProcedure,
  engineerProcedure,
  adminProcedure,
} from "../_core/trpc";
import { isDemoAccount } from "../../shared/demo-accounts";
import { sql } from "drizzle-orm";
import * as store from "./store";
import * as service from "./service";
import {
  identifier,
  target,
  text,
  sourceInput,
  baselineInput,
  ruleInput,
  SecurityError,
} from "./contract";
import { captureHealth } from "./runtime";
import type { User } from "../../drizzle/schema";
export const demoOnly = (u: User) =>
  process.env.ENABLE_DEMO_ACCOUNTS === "true" ||
  isDemoAccount(u.email ?? "") ||
  u.openId.startsWith("demo-");
const write = (procedure: typeof operatorProcedure) =>
  procedure.use(({ ctx, next }) => {
    if (demoOnly(ctx.user))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Shared security demonstrations are read-only",
      });
    if (!store.enabled())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cybersecurity is disabled",
      });
    return next({ ctx });
  });
export async function run<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SecurityError)
      throw new TRPCError({
        code:
          (
            {
              401: "UNAUTHORIZED",
              403: "FORBIDDEN",
              404: "NOT_FOUND",
              409: "CONFLICT",
              413: "PAYLOAD_TOO_LARGE",
              422: "BAD_REQUEST",
              429: "TOO_MANY_REQUESTS",
              503: "SERVICE_UNAVAILABLE",
            } as const
          )[e.status as 401] ?? "BAD_REQUEST",
        message: e.code,
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The security request could not be completed. Evidence state was preserved.",
    });
  }
}
export const securityRouter = router({
  retryReport: write(adminProcedure)
    .input(z.object({ id: z.uuid(), reason: text(1000) }).strict())
    .mutation(({ ctx, input }) =>
      run(() => service.retryReport(input.id, input.reason, ctx.user.id)),
    ),
  importEvidence: write(engineerProcedure)
    .input(
      z
        .object({
          sourceId: z.uuid(),
          raw: z.string().max(1048576),
          ndjson: z.boolean(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run(() =>
        service.importEvidence(
          input.raw,
          input.ndjson,
          input.sourceId,
          ctx.user.id,
        ),
      ),
    ),
  certificate: write(engineerProcedure)
    .input(
      z
        .object({
          sourceId: z.uuid(),
          endpointRef: identifier,
          pem: z.string().min(1).max(65536),
          mode: z.enum(["live", "simulated", "replay"]),
          runId: identifier.optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run(() => service.observeCertificate(input, ctx.user.id)),
    ),
  report: viewerProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) =>
      run(() =>
        service.reportDetail(
          input.id,
          demoOnly(ctx.user),
          !["operator", "engineer", "admin"].includes(ctx.user.role),
        ),
      ),
    ),
  retention: write(adminProcedure)
    .input(
      z.object({ days: z.number().int().min(7).max(90), reason: text(1000) }),
    )
    .mutation(({ ctx, input }) =>
      run(() => service.retention(input.days, input.reason, ctx.user.id)),
    ),
  seedDemo: write(engineerProcedure).mutation(({ ctx }) =>
    run(() => import("./demo").then((d) => d.seedDemonstration(ctx.user.id))),
  ),
  simulateRecurrence: write(engineerProcedure)
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      run(() =>
        import("./demo").then((d) =>
          d.simulateRecurrence(input.id, ctx.user.id),
        ),
      ),
    ),
  availability: viewerProcedure.query(({ ctx }) => ({
    enabled: store.enabled(),
    demoOnly: demoOnly(ctx.user),
    role: ctx.user.role,
    canIngest: false,
    canReview:
      ["operator", "engineer", "admin"].includes(ctx.user.role) &&
      !demoOnly(ctx.user),
    canEngineer:
      ["engineer", "admin"].includes(ctx.user.role) && !demoOnly(ctx.user),
    canAdmin: ctx.user.role === "admin" && !demoOnly(ctx.user),
  })),
  equipmentOverlay: viewerProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) =>
      run(() => service.equipmentOverlay(input.id, demoOnly(ctx.user))),
    ),
  equipmentForFinding: viewerProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) =>
      run(() => service.equipmentForFinding(input.id, demoOnly(ctx.user))),
    ),
  overview: viewerProcedure.query(({ ctx }) =>
    run(() => service.overview(demoOnly(ctx.user))),
  ),
  events: viewerProcedure
    .input(service.filters)
    .query(({ ctx, input }) =>
      run(() =>
        service.events(
          input,
          demoOnly(ctx.user),
          !["operator", "engineer", "admin"].includes(ctx.user.role),
        ),
      ),
    ),
  findings: viewerProcedure
    .input(service.filters.extend({ incidents: z.boolean().optional() }))
    .query(({ ctx, input }) =>
      run(() => service.findings(input, demoOnly(ctx.user), input.incidents)),
    ),
  finding: viewerProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) =>
      run(() =>
        service.detail(
          input.id,
          demoOnly(ctx.user),
          !["operator", "engineer", "admin"].includes(ctx.user.role),
        ),
      ),
    ),
  posture: viewerProcedure.query(({ ctx }) =>
    run(() =>
      service.posture(
        demoOnly(ctx.user),
        !["operator", "engineer", "admin"].includes(ctx.user.role),
      ),
    ),
  ),
  sources: viewerProcedure.query(({ ctx }) =>
    run(() =>
      service.sources(
        demoOnly(ctx.user),
        ctx.user.role === "admin" && !demoOnly(ctx.user),
      ),
    ),
  ),
  createSource: write(adminProcedure)
    .input(sourceInput)
    .mutation(({ ctx, input }) =>
      run(() => store.createSource(input, ctx.user.id)),
    ),
  credential: write(adminProcedure)
    .input(z.object({ id: z.uuid(), action: z.enum(["rotate", "revoke"]) }))
    .mutation(({ ctx, input }) =>
      run(() => store.credentialAction(input.id, input.action, ctx.user.id)),
    ),
  mapIdentity: write(adminProcedure)
    .input(
      z
        .object({
          sourceId: z.uuid(),
          namespace: identifier,
          assetRef: identifier,
          componentRef: identifier.nullable(),
          target,
          installedComponentId: z.uuid().optional(),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run(() => store.mapIdentity(input, ctx.user.id)),
    ),
  proposeBaseline: write(engineerProcedure)
    .input(baselineInput)
    .mutation(({ ctx, input }) =>
      run(() => store.proposeBaseline(input, ctx.user.id)),
    ),
  approveBaseline: write(adminProcedure)
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      run(() => store.approveBaseline(input.id, ctx.user.id)),
    ),
  activateRule: write(adminProcedure)
    .input(ruleInput)
    .mutation(({ ctx, input }) =>
      run(() => store.activateRule(input, ctx.user.id)),
    ),
  action: write(operatorProcedure)
    .input(service.actionInput)
    .mutation(({ ctx, input }) => run(() => service.act(input, ctx.user))),
  reviewPosture: write(engineerProcedure)
    .input(
      z
        .object({
          target,
          zone: z.string().max(100),
          criticality: z.enum(["unknown", "low", "medium", "high"]),
          reason: text(1000),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      run(() => service.reviewPosture(input, ctx.user.id)),
    ),
  export: operatorProcedure
    .input(
      service.filters.extend({ format: z.enum(["json", "ndjson", "csv"]) }),
    )
    .query(({ ctx, input }) =>
      run(() => service.exportEvents(input, demoOnly(ctx.user), input.format)),
    ),
  purgeExpired: write(adminProcedure)
    .input(z.object({ reason: text(1000) }))
    .mutation(({ ctx, input }) =>
      run(() => service.purgeExpired(ctx.user.id, input.reason)),
    ),
  audit: adminProcedure.query(({ ctx }) =>
    run(async () =>
      demoOnly(ctx.user)
        ? []
        : store.rows(
            await store.database(),
            sql`select * from security_audit order by id desc limit 100`,
          ),
    ),
  ),
  captureHealth: adminProcedure.query(({ ctx }) =>
    demoOnly(ctx.user)
      ? {
          pending: 0,
          failed: 0,
          lastFailure:
            "Private diagnostics are unavailable in a shared demonstration",
        }
      : captureHealth(),
  ),
  assignees: engineerProcedure.query(() =>
    run(async () =>
      store.rows(
        await store.database(),
        sql`select id,name,role from users where role in ('engineer','admin') and ${individualSecurityUser()} order by id limit 100`,
      ),
    ),
  ),
  outbox: adminProcedure.query(({ ctx }) =>
    run(async () =>
      demoOnly(ctx.user)
        ? []
        : store.rows(
            await store.database(),
            sql`select id,producer,event_type,attempts,next_attempt,quarantined_at,error_code,delivered_at from security_outbox order by occurred_at desc limit 100`,
          ),
    ),
  ),
  retryOutbox: write(adminProcedure)
    .input(z.object({ id: z.uuid(), reason: text(1000) }))
    .mutation(({ ctx, input }) =>
      run(async () => {
        const db = await store.database();
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`update security_outbox set quarantined_at=null,attempts=0,next_attempt=now(),error_code=null where id=${input.id} and delivered_at is null`,
          );
          await store.audit(tx, "outbox_retry_authorized", ctx.user.id, {
            id: input.id,
            reason: input.reason,
          });
        });
        return { queued: true };
      }),
    ),
});
