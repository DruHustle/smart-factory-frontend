import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  accountRequests,
  loginRateLimits,
  passwordResetTokens,
  users,
} from "../drizzle/schema";
import { sharedDemoIdentity } from "../shared/access-policy";
import { sdk } from "./_core/sdk";
import { requestPasswordReset } from "./accountRequests";
import { getDb } from "./db";
import { notificationConfiguration } from "./notifications";

const resetLifetimeMs = 30 * 60 * 1000;
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const hashToken = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function resetOrigin(): string | undefined {
  const value = (
    process.env.PASSWORD_RESET_ORIGIN ?? process.env.ALLOWED_ORIGIN
  )?.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    // One configured origin, never a request Host/Origin or an arbitrary redirect.
    if (value !== url.origin && value !== `${url.origin}/`) return;
    if (url.protocol === "https:") return url.origin;
    if (
      url.protocol === "http:" &&
      ["development", "test"].includes(process.env.NODE_ENV ?? "") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return url.origin;
  } catch {
    // Misconfiguration retains the administrator recovery path.
  }
}

function deliveryConfiguration() {
  const origin = resetOrigin();
  const secret = process.env.DASHBOARD_SERVICE_TOKEN ?? "";
  const configuration = notificationConfiguration()[0];
  if (
    !origin ||
    secret.trim().length < 32 ||
    !["smtp", "ses", "resend"].includes(
      (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase(),
    ) ||
    !configuration.emailConfigured ||
    !configuration.workerEnabled
  )
    return;
  return { origin, secret };
}

/** This is deployment metadata only and never reveals whether an email exists. */
export function passwordResetPolicy(): {
  delivery: "email" | "administrator";
} {
  return { delivery: deliveryConfiguration() ? "email" : "administrator" };
}

/** Shared wire format for the isolated mail worker; never returned by a router. */
export function encryptPasswordResetPayload(
  input: {
    id: number;
    userId: number;
    authVersion: number;
    email: string;
    token: string;
    resetUrl: string;
  },
  secret: string,
  iv: Uint8Array = randomBytes(12),
): string {
  const key = createHash("sha256")
    .update(`smart-factory:password-reset:key:v1:${secret}`, "utf8")
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(
    Buffer.from(
      `smart-factory:password-reset:v1:${input.id}:${input.userId}:${input.authVersion}:${input.email}`,
      "utf8",
    ),
  );
  const data = Buffer.concat([
    cipher.update(
      JSON.stringify({ token: input.token, resetUrl: input.resetUrl }),
      "utf8",
    ),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: Buffer.from(iv).toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Account storage unavailable");
  return db;
}

function invalidReset(): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "Reset link is invalid or has expired. Request a new password reset.",
  });
}

/** Keep manual recovery available even when delivery cannot be configured. */
export async function issuePasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  await requestPasswordReset(email);
  const configuration = deliveryConfiguration();
  if (!configuration) return;
  try {
    const db = await database();
    await db.transaction(async (tx) => {
      // Issuance and redemption both lock the user before any reset-token row.
      const [user] = await tx
        .select({
          id: users.id,
          openId: users.openId,
          email: users.email,
          disabledAt: users.disabledAt,
          authVersion: users.authVersion,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .for("update")
        .limit(1);
      if (!user || user.disabledAt || sharedDemoIdentity(user)) return;
      const now = new Date();
      await tx
        .update(passwordResetTokens)
        .set({
          usedAt: now,
          deliveryPayload: "",
          deliveryStatus: sql`case when ${passwordResetTokens.deliveryStatus} = 'accepted' then 'accepted' else 'blocked' end`,
        })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      const token = randomBytes(32).toString("base64url");
      const [row] = await tx
        .insert(passwordResetTokens)
        .values({
          userId: user.id,
          email,
          tokenHash: hashToken(token),
          authVersion: user.authVersion,
          expiresAt: new Date(now.getTime() + resetLifetimeMs),
        })
        .returning({ id: passwordResetTokens.id });
      const deliveryPayload = encryptPasswordResetPayload(
        {
          id: row.id,
          userId: user.id,
          authVersion: user.authVersion,
          email,
          token,
          resetUrl: `${configuration.origin}/#/reset-password?token=${token}`,
        },
        configuration.secret,
      );
      await tx
        .update(passwordResetTokens)
        .set({ deliveryPayload })
        .where(eq(passwordResetTokens.id, row.id));
    });
  } catch {
    // The manual request already succeeded. Do not reveal whether an account
    // exists or put a token, ciphertext, recipient or provider error in logs.
    console.warn(
      "[Password recovery] Email queue unavailable; administrator recovery request retained.",
    );
  }
}

/** Redeem once, revoke every old session, and close manual help atomically. */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ id: number }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) invalidReset();
  if (newPassword.length < 12 || Buffer.byteLength(newPassword, "utf8") > 72)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "New passwords must contain at least 12 characters and at most 72 UTF-8 bytes.",
    });
  const db = await database();
  return db.transaction(async (tx) => {
    // The first lookup is deliberately unlocked to preserve user→token lock order.
    const [candidate] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
      .limit(1);
    if (!candidate) invalidReset();
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, candidate.userId))
      .for("update")
      .limit(1);
    const [current] = await tx
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.id, candidate.id))
      .for("update")
      .limit(1);
    if (
      !user ||
      !current ||
      current.usedAt ||
      ["blocked", "expired"].includes(current.deliveryStatus) ||
      current.expiresAt.getTime() <= Date.now() ||
      user.disabledAt ||
      sharedDemoIdentity(user) ||
      user.authVersion !== current.authVersion ||
      !user.email ||
      normalizeEmail(user.email) !== current.email
    )
      invalidReset();
    if (
      user.password &&
      (await sdk.comparePassword(newPassword, user.password))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a different password from your current password.",
      });
    const passwordHash = await sdk.hashPassword(newPassword);
    const now = new Date();
    if (current.expiresAt.getTime() <= now.getTime()) invalidReset();
    await tx
      .update(users)
      .set({
        password: passwordHash,
        authVersion: sql`${users.authVersion} + 1`,
        passwordChangeRequired: false,
        temporaryCredentialExpiresAt: null,
        temporaryCredentialUsedAt: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
    await tx
      .update(passwordResetTokens)
      .set({
        usedAt: now,
        deliveryPayload: "",
        deliveryStatus: sql`case when ${passwordResetTokens.deliveryStatus} = 'accepted' then 'accepted' else 'blocked' end`,
      })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    await tx
      .update(accountRequests)
      .set({ status: "approved", reviewedAt: now, reviewedBy: null })
      .where(
        and(
          eq(accountRequests.kind, "password_reset"),
          eq(accountRequests.status, "pending"),
          sql`lower(${accountRequests.email}) = ${current.email}`,
        ),
      );
    // A redeemed one-time token proves control of this account. Remove only
    // its failed-sign-in counter so the new credential is usable immediately;
    // unrelated identities and source-IP abuse limits remain in force.
    await tx
      .delete(loginRateLimits)
      .where(
        eq(
          loginRateLimits.keyHash,
          hashToken(`email:${normalizeEmail(user.email)}`),
        ),
      );
    return { id: user.id };
  });
}
