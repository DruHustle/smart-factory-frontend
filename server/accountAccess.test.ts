import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import { getDb, closeDatabase, createUser, getUserByOpenId } from "./db";
import { users, sessionRevocations, type User } from "../drizzle/schema";
import {
  changeUserAccess,
  resetAccountCredential,
  consumeTemporaryCredential,
} from "./accountAccess";
import type { TrpcContext } from "./_core/context";

const sourceUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!sourceUrl)("persistent account and session boundaries", () => {
  let admin: ReturnType<typeof postgres>,
    databaseName = "",
    originalUrl: string | undefined,
    passwordHash: string;
  const password = "Synthetic-private-user-2026!",
    temporary = "Synthetic-once-only-2026!";
  beforeAll(async () => {
    const url = new URL(sourceUrl!);
    if (
      process.env.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.endsWith("_e2e")
    )
      throw Error(
        "Account tests require explicit disposable local _e2e storage",
      );
    databaseName = `account_${randomUUID().replaceAll("-", "")}_e2e`;
    admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = "/" + databaseName;
    originalUrl = process.env.DATABASE_URL;
    await closeDatabase();
    process.env.DATABASE_URL = url.toString();
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
    vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
    vi.stubEnv("SECURITY_ENABLED", "false");
    vi.stubEnv(
      "JWT_SECRET",
      "isolated-account-regression-key-at-least-32-bytes",
    );
    execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: "/dev/null",
        DATABASE_SSL_MODE: "disable",
      },
      stdio: "pipe",
    });
    passwordHash = await sdk.hashPassword(password);
  }, 20000);
  beforeEach(async () => {
    const db = (await getDb())!;
    await db.execute(sql`truncate table users cascade`);
  });
  afterAll(async () => {
    await closeDatabase();
    if (databaseName) {
      await admin.unsafe(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    vi.unstubAllEnvs();
  });
  const individual = async (role: User["role"] = "operator") =>
    createUser({
      openId: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "Synthetic individual",
      role,
      password: passwordHash,
    });
  const request = (token: string) =>
    ({
      protocol: "http",
      headers: { authorization: `Bearer ${token}` },
    }) as TrpcContext["req"];
  const caller = (user: User | null, token = "") => {
    const cookies: string[] = [];
    const ctx = {
      user,
      req: request(token),
      res: {
        cookie: (_name: string, value: string) => cookies.push(value),
        clearCookie: () => {},
      },
    } as unknown as TrpcContext;
    return { api: appRouter.createCaller(ctx), cookies, ctx };
  };
  it("persists logout revocation without storing or returning the bearer identity", async () => {
    const user = await individual(),
      token = await sdk.createSessionToken(user);
    expect((await sdk.authenticateRequest(request(token))).id).toBe(user.id);
    const result = await caller(user, token).api.auth.logout();
    expect(result).toEqual({ success: true });
    await expect(sdk.authenticateRequest(request(token))).rejects.toThrow(
      "no longer active",
    );
    const session = await sdk.verifySession(token),
      db = (await getDb())!;
    const rows = await db.select().from(sessionRevocations);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].sessionHash).not.toBe(session!.sessionId);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
  it("invalidates old sessions on role, disable and re-enable changes", async () => {
    const user = await individual(),
      old = await sdk.createSessionToken(user);
    await changeUserAccess(user.id, { role: "viewer", expectedVersion: 0 });
    await expect(sdk.authenticateRequest(request(old))).rejects.toThrow();
    const fresh = await sdk.createSessionToken(
      (await getUserByOpenId(user.openId))!,
    );
    expect((await sdk.authenticateRequest(request(fresh))).role).toBe("viewer");
    await changeUserAccess(user.id, { enabled: false, expectedVersion: 1 });
    await expect(sdk.authenticateRequest(request(fresh))).rejects.toThrow();
    await changeUserAccess(user.id, { enabled: true, expectedVersion: 2 });
    await expect(sdk.authenticateRequest(request(fresh))).rejects.toThrow();
    await expect(
      changeUserAccess(user.id, { role: "engineer", expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("preserves an enabled individual administrator under concurrent demotion and disable", async () => {
    const first = await individual("admin");
    await expect(
      changeUserAccess(first.id, { role: "viewer" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const second = await individual("admin");
    const attempts = await Promise.allSettled([
      changeUserAccess(first.id, { role: "viewer" }),
      changeUserAccess(second.id, { enabled: false }),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const db = (await getDb())!,
      rows = await db.select().from(users);
    expect(
      rows.filter((u) => u.role === "admin" && !u.disabledAt),
    ).toHaveLength(1);
  });
  it("uses a one-time restricted sign-in and never returns a recovery secret", async () => {
    const owner = await individual("admin"),
      user = await individual(),
      old = await sdk.createSessionToken(user);
    const reset = await caller(owner).api.users.resetPassword({
      id: user.id,
      temporaryPassword: temporary,
      expectedVersion: 0,
    });
    expect(JSON.stringify(reset)).not.toContain(temporary);
    expect(reset).not.toHaveProperty("token");
    expect(reset).not.toHaveProperty("password");
    await expect(sdk.authenticateRequest(request(old))).rejects.toThrow();
    const login = caller(null);
    const signed = await login.api.auth.login({
      email: user.email!,
      password: temporary,
    });
    expect(signed.user?.passwordChangeRequired).toBe(true);
    expect(signed.user).not.toHaveProperty("password");
    expect(signed.user).not.toHaveProperty("authVersion");
    await expect(
      caller(null).api.auth.login({ email: user.email!, password: temporary }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const restrictedToken = login.cookies[0],
      authenticated = await sdk.authenticateRequestWithSession(
        request(restrictedToken),
      );
    const restricted = caller(authenticated.user, restrictedToken);
    await expect(restricted.api.devices.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const changed = await restricted.api.auth.changePassword({
      newPassword: password,
    });
    expect(changed.user?.passwordChangeRequired).toBe(false);
    await expect(
      sdk.authenticateRequest(request(restrictedToken)),
    ).rejects.toThrow();
    expect(
      (await sdk.authenticateRequest(request(restricted.cookies[0]))).role,
    ).toBe("operator");
  });
  it("allows only one concurrent use and enforces temporary-credential expiry", async () => {
    const user = await individual();
    await resetAccountCredential(user.id, await sdk.hashPassword(temporary), 0);
    const attempts = await Promise.all([
      consumeTemporaryCredential(user.id, 1),
      consumeTemporaryCredential(user.id, 1),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const db = (await getDb())!;
    await db
      .update(users)
      .set({ temporaryCredentialExpiresAt: new Date(Date.now() - 1) })
      .where(eq(users.id, user.id));
    const current = (await getUserByOpenId(user.openId))!,
      token = await sdk.createSessionToken(current);
    await expect(sdk.authenticateRequest(request(token))).rejects.toThrow();
  });
  it("invalidates an already-issued shared identity when shared logins are disabled", async () => {
    const user = await createUser({
      openId: "demo-engineer-regression",
      email: "tech@dev.local",
      role: "engineer",
      password: passwordHash,
    });
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const token = await sdk.createSessionToken(user);
    expect((await sdk.authenticateRequest(request(token))).id).toBe(user.id);
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
    await expect(sdk.authenticateRequest(request(token))).rejects.toThrow();
  });
  it("requires an initial password change for administrator-created accounts", async () => {
    const owner = await individual("admin");
    const created = await caller(owner).api.users.create({
      email: "new-individual@example.test",
      name: "New individual",
      password,
      role: "engineer",
    });
    expect(created?.passwordChangeRequired).toBe(true);
    expect(JSON.stringify(created)).not.toContain(password);
    expect(created).not.toHaveProperty("password");
  });
});
