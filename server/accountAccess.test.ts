import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";
import { getDb, closeDatabase, createUser, getUserByOpenId } from "./db";
import {
  users,
  devices,
  assets,
  sensorReadings,
  sessionRevocations,
  type User,
} from "../drizzle/schema";
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
  afterEach(() => vi.useRealTimers());
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
  it("isolates shared reads, selected IDs and exports from private records for every shared role", async () => {
    // Keep private-value assertions independent of real timestamp milliseconds.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T08:00:00.123Z"));
    const db = (await getDb())!;
    const [privateDevice, demoDevice] = await db
      .insert(devices)
      .values([
        { deviceId: "private-source", name: "PRIVATE SOURCE", type: "sensor" },
        {
          deviceId: "showcase-source",
          name: "Simulated source",
          type: "sensor",
          isDemo: true,
        },
      ])
      .returning();
    const [privateAsset, demoAsset] = await db
      .insert(assets)
      .values([
        {
          assetId: "urn:private:asset",
          name: "PRIVATE MACHINE",
          assetType: "motor",
          aasShell: {},
        },
        {
          assetId: "urn:showcase:asset",
          name: "Simulated motor",
          assetType: "motor",
          aasShell: {},
          isDemo: true,
        },
      ])
      .returning();
    const timestamp = Date.now() - 1000;
    await db.insert(sensorReadings).values([
      {
        deviceId: privateDevice.id,
        assetId: privateAsset.assetId,
        timestamp,
        temperature: 999,
      },
      {
        deviceId: demoDevice.id,
        assetId: privateAsset.assetId,
        timestamp,
        temperature: 888,
      },
    ]);
    await db.insert(users).values({
      openId: "demo-probe",
      email: "probe@example.test",
      name: "Synthetic shared reader",
      role: "admin",
    });
    const shared = (await getUserByOpenId("demo-probe"))!;
    const owner = await individual("admin");
    await caller(owner).api.system.setDemoData({ enabled: true });
    for (const role of ["viewer", "operator", "engineer", "admin"] as const) {
      const api = caller({ ...shared, role }).api;
      expect(
        (await api.inventory.list({})).items.map((i) => i.identifier).sort(),
      ).toEqual([demoDevice.deviceId, demoAsset.assetId].sort());
      expect(
        await api.devices.getById({ id: privateDevice.id }),
      ).toBeUndefined();
      expect(await api.assets.getById({ id: privateAsset.id })).toBeUndefined();
      expect(
        await api.readings.getLatestBatch({
          deviceIds: [privateDevice.id, demoDevice.id],
        }),
      ).toEqual([]);
      expect(
        await api.readings.getForDevice({
          deviceId: demoDevice.id,
          startTime: timestamp - 1,
          endTime: Date.now(),
        }),
      ).toEqual([]);
      await expect(api.users.list()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        api.assets.getPassport({ id: privateAsset.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        api.export.deviceReport({
          deviceId: privateDevice.id,
          startTime: timestamp - 1,
          endTime: Date.now(),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await api.notifications.list()).toEqual([]);
      const answer = await api.assistant.ask({
        question: "What is the current PRIVATE MACHINE state?",
        selectedAssetId: privateAsset.assetId,
      });
      expect(JSON.stringify(answer)).not.toContain("999");
      expect(JSON.stringify(answer)).not.toContain("888");
    }
    const individualRead = caller(owner).api;
    expect((await individualRead.inventory.list({})).total).toBe(4);
    await individualRead.system.setDemoData({ enabled: false });
    expect(
      (await caller(owner).api.inventory.list({})).items
        .map((i) => i.identifier)
        .sort(),
    ).toEqual([privateDevice.deviceId, privateAsset.assetId].sort());
    expect(
      (await caller(owner).api.devices.getById({ id: privateDevice.id }))?.name,
    ).toBe("PRIVATE SOURCE");
  });
  it("requires private preview and explicit revocable, redacted passport publication", async () => {
    const db = (await getDb())!,
      owner = await individual("engineer");
    const [asset] = await db
      .insert(assets)
      .values({
        assetId: "urn:private:passport",
        name: "PRIVATE MOTOR",
        assetType: "motor",
        manufacturer: "Reviewed maker",
        serialNumber: "PRIVATE SERIAL",
        aasShell: {},
      })
      .returning();
    const privateApi = caller(owner).api,
      anonymous = caller(null).api;
    await expect(
      anonymous.assets.getPassport({ id: asset.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      (await privateApi.assets.getPassport({ id: asset.id })).fields.some(
        (f) => f.value === "PRIVATE SERIAL",
      ),
    ).toBe(true);
    const publication = await privateApi.assets.publishPassport({
      id: asset.id,
      expectedVersion: 1,
      fields: ["assetType", "manufacturer"],
      reviewedGuidance: "Reviewed guidance for this specific motor.",
    });
    const published = await anonymous.assets.getPublishedPassport(publication);
    expect(published.title).toBe("Product passport");
    expect(JSON.stringify(published)).not.toContain("PRIVATE");
    expect(published.fields).toHaveLength(2);
    expect(published.reviewedGuidance).toBe(
      "Reviewed guidance for this specific motor.",
    );
    expect(published.disclaimer).toContain(
      "voluntary prototype".replace("v", "V"),
    );
    expect(JSON.stringify(published)).not.toContain("battery");
    await expect(
      caller(await individual("viewer")).api.assets.publishPassport({
        id: asset.id,
        expectedVersion: 1,
        fields: ["name"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await privateApi.assets.revokePassport(publication);
    await expect(
      anonymous.assets.getPublishedPassport(publication),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      privateApi.assets.publishPassport({
        id: asset.id,
        expectedVersion: 2,
        fields: ["name"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
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
  it("applies shared visibility and forced-password restrictions to raw equipment files", async () => {
    const { default: express } = await import("express"),
      { installEquipmentFiles } = await import("./equipment/files"),
      { createEquipment, template } = await import("./equipment/local"),
      { once } = await import("node:events");
    const t = await template(),
      privateEquipment = await createEquipment(
        {
          name: "Private raw-file fixture",
          serialNumber: "PRIVATE",
          kind: "real",
          templateRevision: t.revision,
        },
        0,
      );
    const demo = await createUser({
      openId: "demo-raw-file-reader",
      email: "raw-showcase@example.test",
      role: "engineer",
      password: passwordHash,
    });
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const token = await sdk.createSessionToken(demo),
      app = express();
    installEquipmentFiles(app);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/equipment/${privateEquipment.id}/model`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).not.toContain("model/gltf");
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
      const person = await individual("engineer");
      await resetAccountCredential(
        person!.id,
        passwordHash,
        person!.authVersion ?? 0,
      );
      const restricted = (await getUserByOpenId(person!.openId))!,
        restrictedToken = await sdk.createSessionToken(restricted);
      expect(
        (
          await fetch(
            `http://127.0.0.1:${port}/api/equipment/${privateEquipment.id}/model`,
            { headers: { authorization: `Bearer ${restrictedToken}` } },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`http://127.0.0.1:${port}/api/equipment/model-import`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${restrictedToken}`,
              "content-type": "model/gltf-binary",
            },
            body: "untrusted model",
          })
        ).status,
      ).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("keeps approved fixtures read-only even for an individual administrator, before service delegation", async () => {
    const owner = await individual("admin"),
      db = (await getDb())!,
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const [d] = await db
      .insert(devices)
      .values({
        deviceId: "fixture-readonly",
        name: "Approved fixture",
        type: "gateway",
        isDemo: true,
      })
      .returning();
    const [a] = await db
      .insert(assets)
      .values({
        assetId: "urn:fixture:readonly",
        name: "Approved fixture asset",
        assetType: "robotic_arm",
        isDemo: true,
        aasShell: {},
      })
      .returning();
    const api = caller(owner).api;
    await expect(
      api.devices.update({ id: d.id, name: "Unauthorized fixture edit" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      api.thresholds.upsert({
        deviceId: d.id,
        metric: "temperature",
        unit: "°C",
        maxValue: 99,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      api.assets.controlAda031({
        id: a.id,
        command: { action: "jog", joint: "base", direction: "increase" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await db.select().from(devices).where(eq(devices.id, d.id)))[0].name,
    ).toBe("Approved fixture");
    vi.unstubAllGlobals();
  });
  it("does not count a temporary-password administrator as the last usable recovery administrator", async () => {
    const active = await individual("admin"),
      pending = await individual("admin");
    await resetAccountCredential(
      pending!.id,
      passwordHash,
      pending!.authVersion ?? 0,
    );
    await expect(
      changeUserAccess(active!.id, { enabled: false }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      changeUserAccess(active!.id, { role: "viewer" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
