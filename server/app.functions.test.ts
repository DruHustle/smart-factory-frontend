import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { sdk } from "./_core/sdk";
import * as db from "./db";

type CookieCall = {
  name: string;
  value?: string;
  options?: Record<string, unknown>;
};

// Database-backed integration tests only run against an explicitly supplied test DB.
// Never fall back to DATABASE_URL from .env.local (which may point at a shared environment).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
let testAdminId = 0;

function createContext(opts?: {
  authenticated?: boolean;
  role?: "user" | "viewer" | "operator" | "engineer" | "admin";
}): {
  ctx: TrpcContext;
  cookieCalls: CookieCall[];
  clearedCookies: CookieCall[];
} {
  const cookieCalls: CookieCall[] = [];
  const clearedCookies: CookieCall[] = [];

  const user = opts?.authenticated
    ? {
        id: testAdminId,
        openId: "test-admin",
        email: "admin@test.local",
        name: "Test Admin",
        loginMethod: "password",
        role: opts.role ?? "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      }
    : null;

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "http",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: (
        name: string,
        value: string,
        options: Record<string, unknown>,
      ) => {
        cookieCalls.push({ name, value, options });
      },
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookieCalls, clearedCookies };
}

let testDeviceId = 0;
let testDeviceExternalId = "";
let testFirmwareId = 0;
let existingOtaDeploymentCount = 0;
let testAlertId = 0;

databaseDescribe("App Function Coverage (explicit TEST_DATABASE_URL)", () => {
  beforeAll(async () => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const admin = await db.createUser({
      openId: `test-admin-${unique}`,
      email: `admin-${unique}@test.local`,
      name: "Test Admin",
      role: "admin",
    });
    testAdminId = admin!.id;
    const { ctx } = createContext({ authenticated: true, role: "admin" });
    const caller = appRouter.createCaller(ctx);

    testDeviceExternalId = `e2e-device-${unique}`;
    const createdDevice = await caller.devices.create({
      deviceId: testDeviceExternalId,
      name: "E2E Device",
      status: "online",
      route: "direct",
      freshnessSeconds: 120,
      location: "Factory A",
      zone: "Zone A",
    });
    testDeviceId = createdDevice.id;

    // Read/report coverage uses an explicit isolated fixture; the public manual
    // mutation is retired and has its own negative boundary regression.
    await db.createSensorReading({
      deviceId: createdDevice.id,
      temperature: 33,
      timestamp: Date.now(),
    });

    const fw = await db.createFirmwareVersion({
      version: `v-e2e-${unique}`,
      deviceType: "sensor",
      releaseNotes: "Integration test release",
      isStable: true,
    });
    testFirmwareId = fw.id;
    existingOtaDeploymentCount = (await db.getOtaDeployments()).length;

    const createdAlert = await db.createAlert({
      deviceId: createdDevice.id,
      type: "threshold_exceeded",
      severity: "warning",
      metric: "temperature",
      value: 33,
      threshold: 30,
      message: "Temperature warning",
      status: "active",
    });
    testAlertId = createdAlert.id;
  });
  it("covers system procedures", async () => {
    const { ctx } = createContext({ authenticated: true, role: "admin" });
    const caller = appRouter.createCaller(ctx);

    const health = await caller.system.health({ timestamp: Date.now() });
    expect(health.ok).toBe(true);

    await expect(
      caller.system.notifyOwner({
        title: "Test",
        content: "System coverage check",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("covers account request, approval, login, me and logout", async () => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `e2e-auth-${unique}@test.local`;
    const password = "P@ssw0rd!123";

    const registration = createContext({ authenticated: false });
    const registerCaller = appRouter.createCaller(registration.ctx);
    const submitted = await registerCaller.auth.requestRegistration({
      email,
      password,
      name: "E2E User",
      organization: "E2E Factory",
    });
    expect(submitted).toEqual({ submitted: true });
    expect(registration.cookieCalls).toHaveLength(0);
    await expect(
      registerCaller.auth.login({ email, password }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = appRouter.createCaller(
      createContext({ authenticated: true, role: "admin" }).ctx,
    );
    const request = (await admin.users.pendingRequests()).find(
      (item) => item.email === email,
    );
    expect(request).toBeDefined();
    await admin.users.approveRegistration({ id: request!.id });

    const loginContext = createContext({ authenticated: false });
    const loginCaller = appRouter.createCaller(loginContext.ctx);
    const loginResult = await loginCaller.auth.login({ email, password });

    expect(loginResult.user?.email).toBe(email);
    expect(typeof loginContext.cookieCalls[0]?.value).toBe("string");
    expect(loginContext.cookieCalls.length).toBeGreaterThan(0);

    const meContext = createContext({ authenticated: true, role: "user" });
    const meCaller = appRouter.createCaller(meContext.ctx);
    const me = await meCaller.auth.me();
    expect(me?.openId).toBe("test-admin");

    const logout = createContext({ authenticated: true, role: "user" });
    const logoutCaller = appRouter.createCaller(logout.ctx);
    const loggedOut = await logoutCaller.auth.logout();
    expect(loggedOut.success).toBe(true);
    expect(logout.clearedCookies.length).toBe(1);
  });

  it("covers device/readings/threshold/alert/ota procedures", async () => {
    const { ctx } = createContext({ authenticated: true, role: "admin" });
    const caller = appRouter.createCaller(ctx);

    const device = await caller.devices.getById({ id: testDeviceId });
    expect(device?.id).toBe(testDeviceId);

    const updated = await caller.devices.update({
      id: testDeviceId,
      status: "maintenance",
    });
    expect(updated?.status).toBe("maintenance");

    const thresholds = await caller.thresholds.upsertForDevice({
      deviceId: testDeviceId,
      thresholds: [
        {
          deviceId: testDeviceId,
          metric: "temperature",
          unit: "°C",
          minValue: 10,
          maxValue: 60,
          warningMin: 15,
          warningMax: 55,
          enabled: true,
        },
      ],
    });
    expect(thresholds.length).toBeGreaterThan(0);

    await db.ingestTelemetryByDeviceId({
      deviceId: testDeviceExternalId,
      temperature: 70,
      units: { temperature: "°C" },
      integration: {
        mode: "live",
        sourceQuality: "good",
        sourceConnection: "online",
        gatewayReceivedAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });

    const readings = await caller.readings.getForDevice({
      deviceId: testDeviceId,
      startTime: Date.now() - 1000 * 60 * 60,
      endTime: Date.now(),
      limit: 100,
    });
    expect(Array.isArray(readings)).toBe(true);

    const latest = await caller.readings.getLatest({ deviceId: testDeviceId });
    expect(latest?.deviceId).toBe(testDeviceId);

    const alertStatusUpdated = await caller.alerts.updateStatus({
      id: testAlertId,
      status: "acknowledged",
    });
    expect(alertStatusUpdated?.status).toBe("acknowledged");
    expect(alertStatusUpdated?.severity).toBe("critical");
    expect(alertStatusUpdated?.errorCode).toBe("SF-THR-TEMP-CRIT");

    const downtimeStarted = await caller.alerts.startDowntime({
      id: testAlertId,
    });
    expect(downtimeStarted?.downtimeStartedAt).toBeInstanceOf(Date);
    const updatedAlert = await caller.alerts.resolve({ id: testAlertId });
    expect(updatedAlert?.status).toBe("resolved");

    await expect(
      caller.ota.deploy({
        deviceId: testDeviceId,
        firmwareVersionId: testFirmwareId,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      caller.ota.rollback({ deploymentId: 999999 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.getOtaDeployments()).toHaveLength(
      existingOtaDeploymentCount,
    );
  });

  it("covers analytics/export/firmware/notifications/groups procedures", async () => {
    const { ctx } = createContext({ authenticated: true, role: "admin" });
    const caller = appRouter.createCaller(ctx);

    const overview = await caller.analytics.getOverview();
    expect(overview.devices.total).toBeGreaterThanOrEqual(0);
    expect(overview.alerts.resolvedDowntimeCount).toBeGreaterThan(0);
    expect(
      overview.alerts.averageDowntimeToResolutionSeconds,
    ).toBeGreaterThanOrEqual(0);

    const startTime = Date.now() - 1000 * 60 * 60 * 24;
    const endTime = Date.now();

    const energy = await caller.analytics.getEnergy({ startTime, endTime });
    expect(Array.isArray(energy)).toBe(true);

    const energyConsumption = await caller.analytics.getEnergyConsumption({
      startTime,
      endTime,
    });
    expect(Array.isArray(energyConsumption)).toBe(true);

    const assetTelemetryInput = {
      assetIds: ["urn:test:asset:compressor"],
      startTime,
      endTime,
      intervalMs: 60_000,
    };
    const assetTelemetry =
      await caller.analytics.getAssetTelemetry(assetTelemetryInput);
    expect(Array.isArray(assetTelemetry.assets)).toBe(true);
    expect(Array.isArray(assetTelemetry.timeline)).toBe(true);
    expect(assetTelemetry.overall).toHaveProperty("peakVibration");
    expect(assetTelemetry.overall).toHaveProperty("peakRpm");
    expect(assetTelemetry.overall).toHaveProperty("avgPressure");
    expect(assetTelemetry.overall).toHaveProperty("alerts.activeCritical");
    for (const asset of assetTelemetry.assets) {
      expect(asset).toHaveProperty("trends.temperature");
      expect(asset).toHaveProperty("trends.vibration");
      expect(asset).toHaveProperty("alerts.eventsInPeriod");
    }

    const firmwareList = await caller.firmware.list({ deviceType: "sensor" });
    expect(Array.isArray(firmwareList)).toBe(true);

    const deploys = await caller.ota.list({
      deviceId: testDeviceId,
      limit: 10,
    });
    expect(deploys).toHaveLength(existingOtaDeploymentCount);

    const deviceReport = await caller.export.deviceReport({
      deviceId: testDeviceId,
      startTime,
      endTime,
    });
    expect(deviceReport.filename).toContain("device-report-");

    const analyticsReport =
      await caller.export.analyticsReport(assetTelemetryInput);
    expect(analyticsReport.filename).toContain("analytics-report-");

    const alertHistory = await caller.export.alertHistoryReport({
      startTime,
      endTime,
      severity: "warning",
    });
    expect(alertHistory.filename).toContain("alert-history-report-");
    expect(alertHistory.html).toContain("Error code");
    expect(alertHistory.html).toContain("Downtime");

    const configs = await caller.notifications.getConfigs();
    expect(Array.isArray(configs)).toBe(true);

    await expect(
      caller.notifications.updateConfig({
        configId: "missing-config",
        enabled: true,
        recipient: "owner@test.local",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("covers auth helper functions", async () => {
    const hashed = await sdk.hashPassword("sample-pass");
    const valid = await sdk.comparePassword("sample-pass", hashed);
    expect(valid).toBe(true);

    const sessionToken = await sdk.signSession({
      openId: "manual-open-id",
      appId: "smart-factory",
      name: "Manual User",
      email: "manual@test.local",
      role: "user",
    });
    expect(typeof sessionToken).toBe("string");
  });

  it("shares login throttle counters through PostgreSQL", async () => {
    const keyHash = createHash("sha256").update(randomUUID()).digest("hex");
    const first = await db.recordLoginAttempt(keyHash, 60_000);
    const second = await db.recordLoginAttempt(keyHash, 60_000);

    expect(first.attempts).toBe(1);
    expect(second.attempts).toBe(2);
    await db.pruneExpiredLoginAttempts(new Date(Date.now() + 61_000));
  });
});
