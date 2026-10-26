import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { users, sessionRevocations, type User } from "../drizzle/schema";
import { sharedDemoIdentity } from "../shared/access-policy";

export class AccountAccessError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "PRECONDITION_FAILED"
      | "CONFLICT"
      | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function database() {
  const db = await getDb();
  if (!db) throw new Error("Account storage unavailable");
  return db;
}

export async function sessionRevoked(sessionId: string): Promise<boolean> {
  const db = await database();
  return !!(
    await db
      .select({ id: sessionRevocations.sessionHash })
      .from(sessionRevocations)
      .where(eq(sessionRevocations.sessionHash, hash(sessionId)))
      .limit(1)
  )[0];
}

export async function revokeSession(
  sessionId: string,
  openId: string,
  expiresAt: number,
): Promise<void> {
  const db = await database();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  if (!user || expiresAt <= Date.now()) return;
  await db
    .insert(sessionRevocations)
    .values({
      sessionHash: hash(sessionId),
      userId: user.id,
      expiresAt: new Date(expiresAt),
    })
    .onConflictDoNothing();
}

export async function changeUserAccess(
  id: number,
  change: { role?: User["role"]; enabled?: boolean; expectedVersion?: number },
) {
  const db = await database();
  return db.transaction(async (tx) => {
    // All demotion/disable paths share one lock, preventing concurrent last-admin loss.
    await tx.execute(sql`select pg_advisory_xact_lock(2026102801)`);
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update")
      .limit(1);
    if (!current)
      throw new AccountAccessError("NOT_FOUND", "Account not found.");
    if (sharedDemoIdentity(current))
      throw new AccountAccessError(
        "BAD_REQUEST",
        "Shared walkthrough access is controlled by deployment settings.",
      );
    if (
      change.expectedVersion !== undefined &&
      current.authVersion !== change.expectedVersion
    )
      throw new AccountAccessError(
        "CONFLICT",
        "Account access changed. Refresh and review it again.",
      );
    if (
      current.role === "admin" &&
      !current.disabledAt &&
      ((change.role && change.role !== "admin") || change.enabled === false)
    ) {
      const admins = await tx
        .select({ id: users.id, openId: users.openId, email: users.email })
        .from(users)
        .where(and(eq(users.role, "admin"), isNull(users.disabledAt)));
      if (admins.filter((row) => !sharedDemoIdentity(row)).length <= 1)
        throw new AccountAccessError(
          "PRECONDITION_FAILED",
          "At least one enabled individual administrator must remain.",
        );
    }
    const [updated] = await tx
      .update(users)
      .set({
        ...(change.role ? { role: change.role } : {}),
        ...(change.enabled === undefined
          ? {}
          : { disabledAt: change.enabled ? null : new Date() }),
        authVersion: sql`${users.authVersion}+1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        openId: users.openId,
        name: users.name,
        email: users.email,
        role: users.role,
        disabledAt: users.disabledAt,
      });
    return updated;
  });
}

export async function resetAccountCredential(
  id: number,
  passwordHash: string,
  expectedVersion: number,
) {
  const db = await database();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, id))
      .for("update")
      .limit(1);
    if (!user) throw new AccountAccessError("NOT_FOUND", "Account not found.");
    if (sharedDemoIdentity(user) || user.disabledAt)
      throw new AccountAccessError(
        "PRECONDITION_FAILED",
        "Recovery requires an enabled individual account.",
      );
    if (user.authVersion !== expectedVersion)
      throw new AccountAccessError(
        "CONFLICT",
        "Account access changed. Refresh and review it again.",
      );
    await tx
      .update(users)
      .set({
        password: passwordHash,
        passwordChangeRequired: true,
        temporaryCredentialExpiresAt: expiresAt,
        temporaryCredentialUsedAt: null,
        authVersion: sql`${users.authVersion}+1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  });
  return {
    id,
    expiresAt: expiresAt.toISOString(),
    delivery: "administrator" as const,
    passwordChangeRequired: true,
  };
}

/** The temporary credential can create exactly one restricted sign-in session. */
export async function consumeTemporaryCredential(
  id: number,
  expectedVersion: number,
) {
  const db = await database();
  const [updated] = await db
    .update(users)
    .set({
      temporaryCredentialUsedAt: new Date(),
      authVersion: sql`${users.authVersion}+1`,
    })
    .where(
      and(
        eq(users.id, id),
        eq(users.authVersion, expectedVersion),
        eq(users.passwordChangeRequired, true),
        isNull(users.disabledAt),
        isNull(users.temporaryCredentialUsedAt),
        gt(users.temporaryCredentialExpiresAt, new Date()),
      ),
    )
    .returning();
  return updated;
}

export async function changeOwnPassword(
  id: number,
  expectedVersion: number,
  passwordHash: string,
) {
  const db = await database();
  const [updated] = await db
    .update(users)
    .set({
      password: passwordHash,
      passwordChangeRequired: false,
      temporaryCredentialExpiresAt: null,
      temporaryCredentialUsedAt: null,
      authVersion: sql`${users.authVersion}+1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(users.id, id),
        eq(users.authVersion, expectedVersion),
        isNull(users.disabledAt),
      ),
    )
    .returning();
  if (!updated)
    throw new AccountAccessError(
      "CONFLICT",
      "Account access changed. Sign in again before changing the password.",
    );
  return updated;
}

/** Called by bounded maintenance, never as a sweep on every authenticated request. */
export async function pruneExpiredAccountTokens() {
  const db = await database();
  await db.execute(
    sql`delete from session_revocations where session_hash in (select session_hash from session_revocations where expires_at<now() order by expires_at limit 1000)`,
  );
}
