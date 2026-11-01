import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  accountRequests,
  loginRateLimits,
  passwordResetTokens,
  users,
  type InsertUser,
  type User,
} from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import {
  changeOwnPassword,
  changeUserAccess,
  pruneExpiredAccountTokens,
} from "./accountAccess";
import { getDb } from "./db";
import {
  encryptPasswordResetPayload,
  issuePasswordReset,
  passwordResetPolicy,
  resetPasswordWithToken,
} from "./passwordRecovery";
import { disposableDatabase } from "./test/disposableDatabase";

const secret = "synthetic-cross-language-reset-key-2026";
const origin = "https://factory.example.test";
const invalidMessage =
  "Reset link is invalid or has expired. Request a new password reset.";
const oldPassword = "Synthetic-previous-password-2026!";
const newPassword = "Synthetic-recovered-password-2026!";
type ResetRow = typeof passwordResetTokens.$inferSelect;

function configuredDelivery() {
  vi.stubEnv("EMAIL_PROVIDER", "smtp");
  vi.stubEnv("EMAIL_DELIVERY_CONFIGURED", "true");
  vi.stubEnv("SMTP_USERNAME", "sender@example.test");
  vi.stubEnv("SMTP_FROM", "Factory <sender@example.test>");
  vi.stubEnv("SMTP_PASSWORD", undefined);
  vi.stubEnv("BACKEND_DEPLOYMENT_MODE", "compose");
  vi.stubEnv("PASSWORD_RESET_ORIGIN", origin);
  vi.stubEnv("ALLOWED_ORIGIN", origin);
  vi.stubEnv("DASHBOARD_SERVICE_TOKEN", secret);
}

function decrypt(
  payload: string,
  identity: { id: number; userId: number; authVersion: number; email: string },
  keySecret = secret,
): { token: string; resetUrl: string } {
  const envelope = JSON.parse(payload);
  const key = createHash("sha256")
    .update(`smart-factory:password-reset:key:v1:${keySecret}`, "utf8")
    .digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
    { authTagLength: 16 },
  );
  decipher.setAAD(
    Buffer.from(
      `smart-factory:password-reset:v1:${identity.id}:${identity.userId}:${identity.authVersion}:${identity.email}`,
      "utf8",
    ),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

describe("password recovery delivery policy and worker envelope", () => {
  beforeEach(configuredDelivery);
  afterEach(() => vi.unstubAllEnvs());

  it("uses worker metadata without putting SMTP credentials in the API", () => {
    expect(process.env.SMTP_PASSWORD).toBeUndefined();
    expect(passwordResetPolicy()).toEqual({ delivery: "email" });
    vi.stubEnv("EMAIL_DELIVERY_CONFIGURED", undefined);
    expect(passwordResetPolicy()).toEqual({ delivery: "email" });
    vi.stubEnv("SMTP_USERNAME", undefined);
    expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
  });

  it.each([
    ["EMAIL_DELIVERY_CONFIGURED", "false"],
    ["BACKEND_DEPLOYMENT_MODE", "standalone"],
    ["EMAIL_PROVIDER", "unknown-provider"],
    ["DASHBOARD_SERVICE_TOKEN", "short-secret"],
    ["DASHBOARD_SERVICE_TOKEN", " ".repeat(40)],
  ])("retains administrator help for invalid %s", (key, value) => {
    vi.stubEnv(key, value);
    expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
  });

  it.each([
    "https://factory.example.test,https://other.example.test",
    "https://factory.example.test/login",
    "https://factory.example.test/?return=https://other.example.test",
    "https://factory.example.test/#/login",
    "https://user:password@factory.example.test",
    "http://factory.example.test",
    "javascript:alert(1)",
    "",
  ])("refuses a non-origin reset destination %s", (value) => {
    vi.stubEnv("PASSWORD_RESET_ORIGIN", value);
    expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
  });

  it("falls back only to a single configured ALLOWED_ORIGIN", () => {
    vi.stubEnv("PASSWORD_RESET_ORIGIN", undefined);
    expect(passwordResetPolicy()).toEqual({ delivery: "email" });
    vi.stubEnv("ALLOWED_ORIGIN", `${origin},https://second.example.test`);
    expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
  });

  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("allows %s only for development or tests", (value) => {
    vi.stubEnv("PASSWORD_RESET_ORIGIN", value);
    vi.stubEnv("NODE_ENV", "development");
    expect(passwordResetPolicy()).toEqual({ delivery: "email" });
    vi.stubEnv("NODE_ENV", "production");
    expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
  });

  const fixture = {
    id: 42,
    userId: 7,
    authVersion: 3,
    email: "person@example.test",
    token: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    resetUrl:
      "https://factory.example.test/#/reset-password?token=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  };
  const envelope = {
    v: 1,
    iv: "AAECAwQFBgcICQoL",
    tag: "ei8soCWOX95UYM9y9+V57Q==",
    data: "oPLQL/+WtsDkJjHYLKAE6FvNYW47Ark5U8KxXx+ZqPnorufUcIQIps8jas8YN6EFAFn3mS1Ue1EPJeMdpc+u6VXkCA7c3VfpLPCU6/ZsGtTZhpMF5iUwcLttTiZ58WhEUR1OVz7n/91TBabcFcSbOfXFqYHrOUI8muV4Q2FDp2GZ2lURyOne7waynHe4f8BNejanbvx2Bbf/X1700Qa5GBAo7Fk=",
  };

  it("matches the Node/C# AES-GCM fixture without persisting a bearer token", () => {
    const payload = encryptPasswordResetPayload(
      fixture,
      secret,
      Buffer.from(envelope.iv, "base64"),
    );
    expect(JSON.parse(payload)).toEqual(envelope);
    expect(decrypt(payload, fixture)).toEqual({
      token: fixture.token,
      resetUrl: fixture.resetUrl,
    });
    expect(createHash("sha256").update(fixture.token).digest("hex")).toBe(
      "ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0",
    );
    expect(payload).not.toContain(fixture.token);
    expect(payload).not.toContain(fixture.resetUrl);
  });

  it.each([
    { id: 43 },
    { userId: 8 },
    { authVersion: 4 },
    { email: "different@example.test" },
  ])("authenticates every queue binding %j", (changed) => {
    expect(() =>
      decrypt(JSON.stringify(envelope), { ...fixture, ...changed }),
    ).toThrow();
  });

  it("rejects a changed ciphertext or service key", () => {
    const changed = Buffer.from(envelope.data, "base64");
    changed[0] ^= 1;
    expect(() =>
      decrypt(
        JSON.stringify({ ...envelope, data: changed.toString("base64") }),
        fixture,
      ),
    ).toThrow();
    expect(() =>
      decrypt(JSON.stringify(envelope), fixture, `${secret}-other`),
    ).toThrow();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "persistent password recovery",
  () => {
    disposableDatabase("password_recovery");
    let passwordHash: string;

    beforeAll(async () => {
      passwordHash = await sdk.hashPassword(oldPassword);
    });
    beforeEach(async () => {
      configuredDelivery();
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "true");
      await (await getDb())!.execute(sql`truncate table users cascade`);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    });

    async function individual(
      overrides: Partial<InsertUser> = {},
    ): Promise<User> {
      const [user] = await (await getDb())!
        .insert(users)
        .values({
          openId: randomUUID(),
          email: `${randomUUID()}@example.test`,
          name: "Synthetic recovery user",
          role: "operator",
          password: passwordHash,
          ...overrides,
        })
        .returning();
      return user;
    }

    async function issued(user: User) {
      await expect(
        issuePasswordReset(`  ${user.email!.toUpperCase()}  `),
      ).resolves.toBeUndefined();
      const [row] = await (await getDb())!
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id))
        .orderBy(desc(passwordResetTokens.id))
        .limit(1);
      expect(row).toBeDefined();
      return { row, ...decrypt(row.deliveryPayload, row) };
    }

    async function currentUser(user: User) {
      return (
        await (await getDb())!.select().from(users).where(eq(users.id, user.id))
      )[0];
    }

    async function currentToken(row: ResetRow) {
      return (
        await (await getDb())!
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.id, row.id))
      )[0];
    }

    it("queues only ciphertext, changes the password once and closes manual help without a fake reviewer", async () => {
      const user = await individual({
        authVersion: 5,
        passwordChangeRequired: true,
        temporaryCredentialExpiresAt: new Date(Date.now() + 60_000),
        temporaryCredentialUsedAt: new Date(),
      });
      const { row, token, resetUrl } = await issued(user);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(resetUrl).toBe(`${origin}/#/reset-password?token=${token}`);
      expect(row).toMatchObject({
        email: user.email,
        authVersion: 5,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        deliveryStatus: "pending",
        usedAt: null,
        attempts: 0,
      });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(
        29 * 60_000,
      );
      expect(
        row.expiresAt.getTime() - row.createdAt.getTime(),
      ).toBeLessThanOrEqual(31 * 60_000);
      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify(row)).not.toContain(resetUrl);
      expect(JSON.parse(row.deliveryPayload)).toMatchObject({ v: 1 });

      await expect(resetPasswordWithToken(token, newPassword)).resolves.toEqual(
        { id: user.id },
      );
      const updated = await currentUser(user);
      expect(updated).toMatchObject({
        authVersion: 6,
        passwordChangeRequired: false,
        temporaryCredentialExpiresAt: null,
        temporaryCredentialUsedAt: null,
      });
      expect(await sdk.comparePassword(newPassword, updated.password!)).toBe(
        true,
      );
      expect(await sdk.comparePassword(oldPassword, updated.password!)).toBe(
        false,
      );
      expect(await currentToken(row)).toMatchObject({
        usedAt: expect.any(Date),
        deliveryPayload: "",
      });
      const requests = await (await getDb())!.select().from(accountRequests);
      expect(requests).toMatchObject([
        {
          kind: "password_reset",
          status: "approved",
          reviewedBy: null,
          reviewedAt: expect.any(Date),
        },
      ]);
      await expect(
        resetPasswordWithToken(token, "Another-strong-password-2026!"),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: invalidMessage,
      });
      expect((await currentUser(user)).authVersion).toBe(6);
    });

    it("permits only one concurrent redemption and preserves the winning password", async () => {
      const user = await individual();
      const { token } = await issued(user);
      const passwords = [newPassword, "Another-concurrent-password-2026!"];
      const results = await Promise.allSettled(
        passwords.map((password) => resetPasswordWithToken(token, password)),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { code: "BAD_REQUEST", message: invalidMessage },
      });
      const winner = results.findIndex(
        (result) => result.status === "fulfilled",
      );
      const userAfter = await currentUser(user);
      expect(userAfter.authVersion).toBe(1);
      expect(
        await sdk.comparePassword(passwords[winner], userAfter.password!),
      ).toBe(true);
      expect(
        await sdk.comparePassword(passwords[1 - winner], userAfter.password!),
      ).toBe(false);
    });

    it("clears only the proven account's sign-in throttle after a valid reset", async () => {
      const user = await individual();
      const { token } = await issued(user);
      const database = (await getDb())!;
      const key = (value: string) =>
        createHash("sha256").update(value).digest("hex");
      const accountKey = key(`email:${user.email}`);
      const otherKey = key("email:other@example.test");
      const ipKey = key("ip:192.0.2.1");
      await database.insert(loginRateLimits).values(
        [accountKey, otherKey, ipKey].map((keyHash) => ({
          keyHash,
          attempts: 21,
          resetAt: new Date(Date.now() + 15 * 60_000),
        })),
      );
      await expect(
        resetPasswordWithToken("a".repeat(43), newPassword),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await database.select().from(loginRateLimits)).toHaveLength(3);
      await resetPasswordWithToken(token, newPassword);
      const remaining = await database.select().from(loginRateLimits);
      expect(remaining.map((row) => row.keyHash).sort()).toEqual(
        [otherKey, ipKey].sort(),
      );
      expect(remaining.every((row) => row.attempts === 21)).toBe(true);
    });

    it("serializes repeated requests, revokes older links and retains one pending manual request", async () => {
      const user = await individual();
      const original = await issued(user);
      await Promise.all([
        issuePasswordReset(user.email!),
        issuePasswordReset(user.email!),
      ]);
      const rows = await (await getDb())!.select().from(passwordResetTokens);
      expect(rows).toHaveLength(3);
      const unused = rows.filter((row) => !row.usedAt);
      expect(unused).toHaveLength(1);
      expect(
        rows
          .filter((row) => row.usedAt)
          .every((row) => row.deliveryPayload === ""),
      ).toBe(true);
      expect(
        await (await getDb())!.select().from(accountRequests),
      ).toHaveLength(1);
      await expect(
        resetPasswordWithToken(original.token, newPassword),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: invalidMessage,
      });
      const { token } = decrypt(unused[0].deliveryPayload, unused[0]);
      await resetPasswordWithToken(token, newPassword);
      const remaining = await (await getDb())!
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      expect(remaining).toEqual([]);
    });

    it("rejects expired links and prunes expired secrets without deleting a current link", async () => {
      const user = await individual();
      const expired = await issued(user);
      const current = await issued(await individual());
      await (await getDb())!
        .update(passwordResetTokens)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(passwordResetTokens.id, expired.row.id));
      await expect(
        resetPasswordWithToken(expired.token, newPassword),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: invalidMessage,
      });
      expect(await currentUser(user)).toMatchObject({
        password: passwordHash,
        authVersion: 0,
      });
      await pruneExpiredAccountTokens();
      expect(await currentToken(expired.row)).toBeUndefined();
      expect(await currentToken(current.row)).toMatchObject({
        usedAt: null,
        deliveryPayload: current.row.deliveryPayload,
      });
    });

    it("does not issue tokens or manual requests for unknown, disabled or either shared identity", async () => {
      const disabled = await individual({ disabledAt: new Date() });
      const reserved = await individual({ email: "admin@dev.local" });
      const shared = await individual({ openId: "demo-recovery-fixture" });
      for (const email of [
        "unknown@example.test",
        disabled.email!,
        reserved.email!,
        shared.email!,
      ])
        await expect(issuePasswordReset(email)).resolves.toBeUndefined();
      expect(await (await getDb())!.select().from(passwordResetTokens)).toEqual(
        [],
      );
      expect(await (await getDb())!.select().from(accountRequests)).toEqual([]);
    });

    it("retains only the manual request when safe email delivery is unavailable", async () => {
      const user = await individual();
      vi.stubEnv("EMAIL_DELIVERY_CONFIGURED", "false");
      expect(passwordResetPolicy()).toEqual({ delivery: "administrator" });
      await expect(issuePasswordReset(user.email!)).resolves.toBeUndefined();
      expect(await (await getDb())!.select().from(passwordResetTokens)).toEqual(
        [],
      );
      expect(
        await (await getDb())!.select().from(accountRequests),
      ).toMatchObject([
        {
          kind: "password_reset",
          email: user.email,
          status: "pending",
          reviewedBy: null,
        },
      ]);
    });

    it.each([
      "password",
      "role",
      "disabled",
      "email",
      "reserved email",
      "shared openId",
      "blocked delivery",
    ])("rejects a token after the account changes: %s", async (change) => {
      const user = await individual();
      const { row, token } = await issued(user);
      const db = (await getDb())!;
      switch (change) {
        case "password":
          await changeOwnPassword(
            user.id,
            user.authVersion,
            await sdk.hashPassword("Different-current-password-2026!"),
          );
          break;
        case "role":
          await changeUserAccess(user.id, {
            role: "engineer",
            expectedVersion: user.authVersion,
          });
          break;
        case "disabled":
          await changeUserAccess(user.id, {
            enabled: false,
            expectedVersion: user.authVersion,
          });
          break;
        case "email":
          await db
            .update(users)
            .set({ email: "replacement@example.test" })
            .where(eq(users.id, user.id));
          break;
        case "reserved email":
          await db
            .update(users)
            .set({ email: "admin@dev.local" })
            .where(eq(users.id, user.id));
          break;
        case "shared openId":
          await db
            .update(users)
            .set({ openId: "demo-newly-shared" })
            .where(eq(users.id, user.id));
          break;
        case "blocked delivery":
          await db
            .update(passwordResetTokens)
            .set({ deliveryStatus: "blocked" })
            .where(eq(passwordResetTokens.id, row.id));
          break;
      }
      const before = await currentUser(user);
      await expect(
        resetPasswordWithToken(token, newPassword),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: invalidMessage,
      });
      expect(await currentUser(user)).toEqual(before);
      expect((await currentToken(row)).usedAt).toBeNull();
    });

    it("rejects malformed/unknown links, the old password and bcrypt truncation without consuming a valid link", async () => {
      const user = await individual();
      const { row, token } = await issued(user);
      for (const badToken of [
        "",
        "x".repeat(42),
        "!".repeat(43),
        "x".repeat(43),
      ])
        await expect(
          resetPasswordWithToken(badToken, newPassword),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: invalidMessage,
        });
      await expect(
        resetPasswordWithToken(token, oldPassword),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Choose a different password from your current password.",
      });
      for (const password of ["too-short", "🙂".repeat(20)])
        await expect(
          resetPasswordWithToken(token, password),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await currentToken(row)).usedAt).toBeNull();
      expect((await currentUser(user)).password).toBe(passwordHash);
      await expect(resetPasswordWithToken(token, newPassword)).resolves.toEqual(
        { id: user.id },
      );
    });

    it("rolls back password, token consumption and request review together if persistence fails", async () => {
      const user = await individual();
      const { row, token } = await issued(user);
      const db = (await getDb())!;
      await db.execute(
        sql`create function reject_recovery_review() returns trigger language plpgsql as $$begin raise exception 'Synthetic review failure'; end$$`,
      );
      await db.execute(
        sql`create trigger reject_recovery_review before update on account_requests for each row execute function reject_recovery_review()`,
      );
      try {
        await expect(
          resetPasswordWithToken(token, newPassword),
        ).rejects.toThrow();
        expect(await currentUser(user)).toEqual(user);
        expect(await currentToken(row)).toEqual(row);
        expect(await db.select().from(accountRequests)).toMatchObject([
          { status: "pending", reviewedAt: null, reviewedBy: null },
        ]);
      } finally {
        await db.execute(
          sql`drop trigger reject_recovery_review on account_requests`,
        );
        await db.execute(sql`drop function reject_recovery_review()`);
      }
      await expect(resetPasswordWithToken(token, newPassword)).resolves.toEqual(
        { id: user.id },
      );
    });

    it("does not hide a failure to save the initial manual request", async () => {
      const user = await individual();
      const db = (await getDb())!;
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await db.execute(
        sql`create function reject_recovery_request() returns trigger language plpgsql as $$begin raise exception 'Synthetic request failure'; end$$`,
      );
      await db.execute(
        sql`create trigger reject_recovery_request before insert on account_requests for each row execute function reject_recovery_request()`,
      );
      try {
        await expect(issuePasswordReset(user.email!)).rejects.toThrow();
        expect(await db.select().from(accountRequests)).toEqual([]);
        expect(await db.select().from(passwordResetTokens)).toEqual([]);
        expect(warning).not.toHaveBeenCalled();
      } finally {
        await db.execute(
          sql`drop trigger reject_recovery_request on account_requests`,
        );
        await db.execute(sql`drop function reject_recovery_request()`);
      }
    });

    it("keeps the response generic and the previous link usable if replacement queue insertion fails", async () => {
      const user = await individual();
      const { row, token } = await issued(user);
      const db = (await getDb())!;
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await db.execute(
        sql`create function reject_recovery_issue() returns trigger language plpgsql as $$begin raise exception 'Synthetic queue failure'; end$$`,
      );
      await db.execute(
        sql`create trigger reject_recovery_issue before insert on password_reset_tokens for each row execute function reject_recovery_issue()`,
      );
      try {
        await expect(issuePasswordReset(user.email!)).resolves.toBeUndefined();
        expect(await currentToken(row)).toEqual(row);
        expect(await db.select().from(passwordResetTokens)).toHaveLength(1);
        expect(await db.select().from(accountRequests)).toMatchObject([
          { kind: "password_reset", email: user.email, status: "pending" },
        ]);
        expect(warning).toHaveBeenCalledExactlyOnceWith(
          "[Password recovery] Email queue unavailable; administrator recovery request retained.",
        );
      } finally {
        await db.execute(
          sql`drop trigger reject_recovery_issue on password_reset_tokens`,
        );
        await db.execute(sql`drop function reject_recovery_issue()`);
      }
      await expect(resetPasswordWithToken(token, newPassword)).resolves.toEqual(
        { id: user.id },
      );
    });
  },
);
