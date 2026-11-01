import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { accountRequests, passwordResetTokens, users } from "../drizzle/schema";
import { getDb } from "./db";
import { isDemoAccount } from "../shared/demo-accounts";
import { audit, type Conn } from "./security/store";
import { individualSecurityUser } from "./security/users";

const recoveryDeliveryStatuses = [
  "pending",
  "accepted",
  "failed",
  "unconfigured",
  "blocked",
  "expired",
] as const;
const recoveryDeliveryFailureCodes = [
  "already_used",
  "expired",
  "account_changed",
  "shared_identity",
  "mail_not_configured",
  "recipient_not_allowed",
  "invalid_delivery_payload",
  "delivery_failed",
] as const;
export type RecoveryDelivery = {
  status: (typeof recoveryDeliveryStatuses)[number];
  failureCode: (typeof recoveryDeliveryFailureCodes)[number] | "unknown" | null;
  attempts: number;
  expiresAt: Date;
};

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Account storage unavailable");
  return db;
}

const normalized = (email: string) => email.trim().toLowerCase();

/** Serialize a signup with private administrator setup for the same identity. */
export async function lockRegistrationIdentity(tx: Conn, email: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(20261101, hashtext(${normalized(email)}))`,
  );
}

/** Internal credential lookup; never expose a pending request's hash or existence. */
export async function pendingRegistrationCredential(emailInput: string) {
  const db = await database();
  const [request] = await db
    .select({ passwordHash: accountRequests.passwordHash })
    .from(accountRequests)
    .where(
      and(
        eq(accountRequests.kind, "registration"),
        eq(accountRequests.status, "pending"),
        sql`lower(${accountRequests.email}) = ${normalized(emailInput)}`,
      ),
    )
    .limit(1);
  return request?.passwordHash ?? null;
}

/** A request never grants a session or an active account. */
export async function requestRegistration(input: {
  email: string;
  name: string;
  organization: string;
  jobTitle?: string;
  passwordHash: string;
}) {
  const db = await database();
  const email = normalized(input.email);
  if (isDemoAccount(email)) return;
  await db.transaction(async (tx) => {
    await lockRegistrationIdentity(tx, email);
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existing) return;
    await tx
      .insert(accountRequests)
      .values({
        kind: "registration",
        email,
        name: input.name,
        organization: input.organization,
        jobTitle: input.jobTitle || null,
        passwordHash: input.passwordHash,
      })
      .onConflictDoNothing();
  });
}

/** Give the same answer for unknown, demo and known identities. */
export async function requestPasswordReset(emailInput: string) {
  const db = await database();
  const email = normalized(emailInput);
  if (isDemoAccount(email)) return;
  const [user] = await db
    .select({
      id: users.id,
      openId: users.openId,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (!user || user.disabledAt || user.openId.startsWith("demo-")) return;
  await db
    .insert(accountRequests)
    .values({ kind: "password_reset", email })
    .onConflictDoNothing();
}

export async function pendingAccountRequests() {
  const db = await database();
  const pending = db
    .select({
      id: accountRequests.id,
      kind: accountRequests.kind,
      email: accountRequests.email,
      name: accountRequests.name,
      organization: accountRequests.organization,
      jobTitle: accountRequests.jobTitle,
      createdAt: accountRequests.createdAt,
    })
    .from(accountRequests)
    .where(eq(accountRequests.status, "pending"))
    .orderBy(desc(accountRequests.createdAt))
    .limit(200)
    .as("pending_requests");
  // Bound the request set before looking up its newest queue row. This query
  // never selects a password, token, token hash, encrypted payload or reset URL.
  const latest = db
    .select({
      status: sql<string>`case
        when ${passwordResetTokens.usedAt} is not null then 'blocked'
        when ${passwordResetTokens.expiresAt} <= now() then 'expired'
        when ${users.disabledAt} is not null or ${passwordResetTokens.authVersion} <> ${users.authVersion}
          or not (${individualSecurityUser()}) then 'blocked'
        else ${passwordResetTokens.deliveryStatus} end`.as("delivery_status"),
      failureCode: sql<string | null>`case
        when ${passwordResetTokens.usedAt} is not null then 'already_used'
        when ${passwordResetTokens.expiresAt} <= now() then 'expired'
        when ${users.disabledAt} is not null or ${passwordResetTokens.authVersion} <> ${users.authVersion} then 'account_changed'
        when not (${individualSecurityUser()}) then 'shared_identity'
        else ${passwordResetTokens.lastError} end`.as("failure_code"),
      attempts: passwordResetTokens.attempts,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        sql`lower(${users.email}) = lower(${pending.email})`,
        sql`${passwordResetTokens.email} = lower(${pending.email})`,
        sql`${passwordResetTokens.createdAt} >= ${pending.createdAt}`,
      ),
    )
    .orderBy(desc(passwordResetTokens.id))
    .limit(1)
    .as("latest_recovery_delivery");
  const rows = await db
    .select({
      id: pending.id,
      kind: pending.kind,
      email: pending.email,
      name: pending.name,
      organization: pending.organization,
      jobTitle: pending.jobTitle,
      createdAt: pending.createdAt,
      delivery: {
        status: latest.status,
        failureCode: latest.failureCode,
        attempts: latest.attempts,
        expiresAt: latest.expiresAt,
      },
    })
    .from(pending)
    .leftJoinLateral(latest, eq(pending.kind, "password_reset"))
    .orderBy(desc(pending.createdAt));
  return rows.map(({ delivery, ...request }) => {
    const recoveryDelivery: RecoveryDelivery | null = delivery?.expiresAt
      ? {
          status: recoveryDeliveryStatuses.includes(
            delivery.status as RecoveryDelivery["status"],
          )
            ? (delivery.status as RecoveryDelivery["status"])
            : "failed",
          failureCode:
            delivery.failureCode === null
              ? null
              : recoveryDeliveryFailureCodes.includes(
                    delivery.failureCode as (typeof recoveryDeliveryFailureCodes)[number],
                  )
                ? (delivery.failureCode as (typeof recoveryDeliveryFailureCodes)[number])
                : "unknown",
          attempts: delivery.attempts,
          expiresAt: delivery.expiresAt,
        }
      : null;
    return { ...request, recoveryDelivery };
  });
}

export async function approveRegistration(
  id: string,
  reviewerId: number,
  role: "viewer" | "operator" | "engineer" | "admin" = "viewer",
) {
  const db = await database();
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(accountRequests)
      .where(eq(accountRequests.id, id))
      .for("update")
      .limit(1);
    if (
      !request ||
      request.kind !== "registration" ||
      request.status !== "pending"
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Refresh the request queue and review again.",
      });
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${request.email}`)
      .limit(1);
    if (existing)
      throw new TRPCError({
        code: "CONFLICT",
        message: "An account already uses this address.",
      });
    const [user] = await tx
      .insert(users)
      .values({
        openId: randomUUID(),
        email: request.email,
        name: request.name,
        password: request.passwordHash!,
        role,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
      });
    await tx
      .update(accountRequests)
      .set({
        status: "approved",
        passwordHash: null,
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
      })
      .where(eq(accountRequests.id, id));
    await audit(tx, "account_registration_approved", reviewerId, {
      requestId: id,
      userId: user.id,
      role: user.role,
    });
    return user;
  });
}

export async function dismissAccountRequest(id: string, reviewerId: number) {
  const db = await database();
  const [request] = await db
    .update(accountRequests)
    .set({
      status: "dismissed",
      passwordHash: null,
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
    })
    .where(
      and(eq(accountRequests.id, id), eq(accountRequests.status, "pending")),
    )
    .returning({ id: accountRequests.id, kind: accountRequests.kind });
  if (!request)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Refresh the request queue and review again.",
    });
  return request;
}

export async function completePasswordResetRequests(
  email: string,
  reviewerId: number,
) {
  const db = await database();
  await db
    .update(accountRequests)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
    })
    .where(
      and(
        eq(accountRequests.kind, "password_reset"),
        eq(accountRequests.status, "pending"),
        sql`lower(${accountRequests.email}) = ${normalized(email)}`,
      ),
    );
}
