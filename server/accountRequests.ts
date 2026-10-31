import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { accountRequests, users } from "../drizzle/schema";
import { getDb } from "./db";
import { isDemoAccount } from "../shared/demo-accounts";
import { audit } from "./security/store";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Account storage unavailable");
  return db;
}

const normalized = (email: string) => email.trim().toLowerCase();

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
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing) return;
  await db
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
  return db
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
    .limit(200);
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
