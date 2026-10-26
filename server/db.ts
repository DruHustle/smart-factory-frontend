import "dotenv/config";
import { capture as captureOnesa, recordCaptureFailure } from "./onesa/store";
import { createHash } from "node:crypto";
import { eq, and, or, gte, lte, desc, asc, sql, inArray, isNull, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../drizzle/schema";
import { ENV } from "./_core/env";
import { buildAasDocuments } from "./aasModel";
import { getImportedAssetSummary } from "./aasImportMapping";
import { getAllowedAssetTransitions, type AssetLifecycleStage } from "../shared/asset-lifecycle";
import { getAlertErrorCode } from "../shared/alert-codes";
import { evaluateAlertThreshold } from "../shared/alert-thresholds";
import { deviceWithCurrentStatus } from "./deviceConnectivity";
import { demoDataEnabled, setRuntimeDemoDataEnabled, visibleWhenDemoDataEnabled } from "./demoData";

const {
  users,
  devices,
  assets,
  assetVersions,
  loginRateLimits,
  assetDevices,
  assetLifecycleEvents,
  sensorReadings,
  alertThresholds,
  alerts,
  notificationInbox,
  firmwareVersions,
  otaDeployments,
  systemSettings,
} = schema;

const demoDataSettingKey = "demo_data_enabled";

export async function refreshDemoDataSetting(): Promise<boolean> {
  return withDb(async (db) => {
    const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
      .where(eq(systemSettings.key, demoDataSettingKey)).limit(1);
    const enabled = typeof row?.value === "boolean" ? row.value : process.env.ENABLE_DEMO_DATA === "true";
    setRuntimeDemoDataEnabled(enabled);
    return enabled;
  });
}

export async function setDemoDataSetting(enabled: boolean, updatedBy: number): Promise<boolean> {
  return withDb(async (db) => {
    await db.insert(systemSettings).values({ key: demoDataSettingKey, value: enabled, updatedBy })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: enabled, updatedBy, updatedAt: new Date() } });
    setRuntimeDemoDataEnabled(enabled);
    return enabled;
  });
}

export type User = schema.User;
export type InsertUser = schema.InsertUser;
export type Device = schema.Device;
export type InsertDevice = schema.InsertDevice;
export type Asset = schema.Asset;
export type InsertAsset = schema.InsertAsset;
export type AssetVersion = schema.AssetVersion;
export type SensorReading = schema.SensorReading;
export type InsertSensorReading = schema.InsertSensorReading;
export type AlertThreshold = schema.AlertThreshold;
export type InsertAlertThreshold = schema.InsertAlertThreshold;
export type Alert = schema.Alert;
export type InsertAlert = schema.InsertAlert;
export type FirmwareVersion = schema.FirmwareVersion;
export type InsertFirmwareVersion = schema.InsertFirmwareVersion;
export type OtaDeployment = schema.OtaDeployment;
export type InsertOtaDeployment = schema.InsertOtaDeployment;

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlClient: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  const databaseUrl = process.env.DATABASE_URL || ENV.databaseUrl;
  if (!_db && databaseUrl) {
    try {
      const caCert = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
      const sslMode = (
        process.env.DATABASE_SSL_MODE ??
        (process.env.NODE_ENV === "production" ? "verify-full" : "disable")
      ).toLowerCase();
      const validSslModes = new Set(["disable", "require", "verify-ca", "verify-full"]);
      if (!validSslModes.has(sslMode)) {
        throw new Error("DATABASE_SSL_MODE must be disable, require, verify-ca, or verify-full");
      }
      if (process.env.NODE_ENV === "production" && sslMode !== "verify-full") {
        throw new Error("Production PostgreSQL requires DATABASE_SSL_MODE=verify-full");
      }
      if (sslMode !== "disable" && !caCert) {
        throw new Error("DATABASE_CA_CERT is required whenever PostgreSQL TLS is enabled");
      }
      // Supplying a trusted CA and rejectUnauthorized enables chain and hostname
      // validation in Node's TLS stack; encrypted-but-unverified connections fail closed.
      const ssl = sslMode === "disable" ? false : { ca: caCert, rejectUnauthorized: true };
      // Share Aiven's small connection budget with the .NET services and with
      // the previous instance retained during zero-downtime deployments.
      _sqlClient = postgres(databaseUrl, { ssl, max: 2, idle_timeout: 20 });
      _db = drizzle(_sqlClient, { schema });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function checkDatabaseHealth() {
  return withDb(async (db) => {
    await db.execute(sql`select 1`);
    return true;
  });
}

export async function closeDatabase() {
  const client = _sqlClient;
  _sqlClient = null;
  _db = null;
  if (client) await client.end({ timeout: 5 });
}

/** Atomically count one hashed login identifier inside its active time window. */
export async function recordLoginAttempt(identifierHash: string, windowMs: number) {
  return withDb(async (db) => {
    const resetAt = new Date(Date.now() + windowMs);
    const [result] = await db.insert(loginRateLimits).values({ keyHash: identifierHash, attempts: 1, resetAt })
      .onConflictDoUpdate({
        target: loginRateLimits.keyHash,
        set: {
          attempts: sql`CASE WHEN ${loginRateLimits.resetAt} <= NOW() THEN 1 ELSE ${loginRateLimits.attempts} + 1 END`,
          resetAt: sql`CASE WHEN ${loginRateLimits.resetAt} <= NOW() THEN ${resetAt.toISOString()}::timestamptz ELSE ${loginRateLimits.resetAt} END`,
        },
      })
      .returning({ attempts: loginRateLimits.attempts, resetAt: loginRateLimits.resetAt });
    return result;
  });
}

export async function pruneExpiredLoginAttempts(now = new Date()) {
  return withDb(async (db) => db.delete(loginRateLimits).where(lte(loginRateLimits.resetAt, now)));
}

// Helper for DB operations
async function withDb<T>(fn: (db: NonNullable<ReturnType<typeof drizzle>>) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return fn(db as NonNullable<ReturnType<typeof drizzle>>);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Capture the full application view of the AAS so edits remain reviewable. */
function assetVersionSnapshot(asset: Asset) {
  const snapshot = {
    asset: {
      assetId: asset.assetId,
      name: asset.name,
      assetType: asset.assetType,
      manufacturer: asset.manufacturer,
      model: asset.model,
      manufacturerStreet: asset.manufacturerStreet,
      manufacturerZipcode: asset.manufacturerZipcode,
      manufacturerCityTown: asset.manufacturerCityTown,
      manufacturerNationalCode: asset.manufacturerNationalCode,
      manufacturerArticleNumber: asset.manufacturerArticleNumber,
      orderCodeOfManufacturer: asset.orderCodeOfManufacturer,
      ratedValue: asset.ratedValue,
      ratedUnit: asset.ratedUnit,
      serialNumber: asset.serialNumber,
      location: asset.location,
      zone: asset.zone,
      aasxImported: asset.aasxImported,
      aasxPackageId: asset.aasxPackageId,
    },
    shell: asset.aasShell,
    submodels: asset.aasSubmodels,
    conceptDescriptions: asset.aasConceptDescriptions,
  };
  return {
    snapshot,
    sha256: createHash("sha256").update(stableJson(snapshot)).digest("hex"),
  };
}

function versionRecord(asset: Asset, changedBy: number, changeType: string, changeNote?: string) {
  const captured = assetVersionSnapshot(asset);
  return {
    assetId: asset.id,
    version: asset.aasVersion,
    changeType,
    changeNote: changeNote ?? null,
    changedBy,
    snapshot: captured.snapshot,
    sha256: captured.sha256,
  };
}

// ============ User Functions ============
export async function getUserByOpenId(openId: string) {
  return withDb(async (db) => {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result[0];
  });
}

export async function getUserByEmail(email: string) {
  return withDb(async (db) => {
    const result = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`).limit(1);
    return result[0];
  });
}

export async function createUser(user: InsertUser) {
  return withDb(async (db) => {
    await db.insert(users).values(user);
    return getUserByEmail(user.email!);
  });
}

export async function enqueueWelcomeEmail(user: Pick<User, "id" | "name" | "email">) {
  if (!user.email) return;
  const greeting = user.name?.trim() ? `Hello ${user.name.trim()},` : "Hello,";
  await withDb(async (db) => db.insert(notificationInbox).values({
    alertId: null,
    userId: user.id,
    kind: "account_welcome",
    title: "Welcome to Smart Factory IoT",
    body: `${greeting}\n\nYour Smart Factory IoT account has been created.\n\nOpen the application: https://smart-factory-iot-app.vercel.app\n\nFor security, this email does not contain your password. If you did not expect this account, contact your system administrator.\n\nSmart Factory IoT`,
  }));
}

export async function listUsers() {
  return withDb(async (db) => db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(asc(users.createdAt)));
}

export async function updateUserRole(id: number, role: User["role"]) {
  return withDb(async (db) => {
    const [updated] = await db.update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, openId: users.openId, name: users.name, email: users.email, role: users.role });
    return updated;
  });
}

/** Refreshes a reserved local demo identity during non-production bootstrap. */
export async function updateDemoAccount(id: number, password: string, role: User["role"]) {
  return withDb(async (db) => {
    const [updated] = await db.update(users)
      .set({ password, role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, role: users.role });
    return updated;
  });
}

// ============ Device Functions ============
export async function createDevice(device: InsertDevice): Promise<Device> {
  return withDb(async (db) => {
    await db.insert(devices).values(device);
    const result = await db.select().from(devices).where(eq(devices.deviceId, device.deviceId)).limit(1);
    return result[0];
  });
}

export async function getDevices(filters?: {
  status?: Device["status"];
  type?: Device["type"];
  zone?: string;
}): Promise<Device[]> {
  return withDb(async (db) => {
    let query = db.select().from(devices);
    const conditions = [];

    if (filters?.type) conditions.push(eq(devices.type, filters.type));
    if (filters?.zone) conditions.push(eq(devices.zone, filters.zone));

    const finalQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
    const rows = await finalQuery.orderBy(desc(devices.updatedAt));
    const now = Date.now();
    const visibleRows = rows.filter((row) => visibleWhenDemoDataEnabled(row));
    const current = visibleRows.map((row) => deviceWithCurrentStatus(row, now));
    return filters?.status ? current.filter((row) => row.status === filters.status) : current;
  });
}

export async function getDeviceById(id: number): Promise<Device | undefined> {
  return withDb(async (db) => {
    const result = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
    const device = result[0];
    if (!device || !visibleWhenDemoDataEnabled(device)) return undefined;
    return deviceWithCurrentStatus(device);
  });
}

export async function getDeviceByDeviceId(deviceId: string): Promise<Device | undefined> {
  return withDb(async (db) => {
    const result = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
    const device = result[0];
    return device && visibleWhenDemoDataEnabled(device) ? device : undefined;
  });
}

/** Devices whose telemetry identifies the selected edge gateway as its parent. */
export async function getDevicesForGateway(gatewayDeviceId: string): Promise<Device[]> {
  return withDb(async (db) => {
    const rows = await db.select().from(devices)
      .where(sql`${devices.metadata}->>'gatewayId' = ${gatewayDeviceId}`)
      .orderBy(asc(devices.name));
    const now = Date.now();
    return rows
      .filter((row) => visibleWhenDemoDataEnabled(row))
      .map((row) => deviceWithCurrentStatus(row, now));
  });
}

/** AAS assets explicitly assigned to the selected edge gateway. */
export async function getAssetsForGateway(gatewayDeviceId: string) {
  return withDb(async (db) => db.select({
    id: assets.id,
    assetId: assets.assetId,
    name: assets.name,
    assetType: assets.assetType,
    manufacturer: assets.manufacturer,
    model: assets.model,
    location: assets.location,
    zone: assets.zone,
    protocol: assetDevices.protocol,
    endpoint: assetDevices.endpoint,
    lastSeen: assetDevices.lastSeen,
  }).from(assetDevices)
    .innerJoin(devices, eq(assetDevices.deviceId, devices.id))
    .innerJoin(assets, eq(assetDevices.assetId, assets.id))
    .where(and(eq(devices.deviceId, gatewayDeviceId), eq(devices.type, "gateway")))
    .orderBy(asc(assets.name)));
}

export async function updateDevice(id: number, data: Partial<InsertDevice>): Promise<Device | undefined> {
  return withDb(async (db) => {
    await db.update(devices).set({ ...data, updatedAt: new Date() }).where(eq(devices.id, id));
    return getDeviceById(id);
  });
}

export async function deleteDevice(id: number): Promise<boolean> {
  return withDb(async (db) => {
    const connectedAssets = await db.select({ id: assetDevices.id }).from(assetDevices).where(eq(assetDevices.deviceId, id)).limit(1);
    if (connectedAssets.length > 0) {
      throw new Error("This gateway is linked to an AAS asset. Remove the asset connection before deleting the gateway.");
    }
    const deleted = await db.delete(devices).where(eq(devices.id, id)).returning({ id: devices.id });
    return deleted.length === 1;
  });
}

export async function getDeviceStats() {
  return withDb(async (db) => {
    const now = Date.now();
    const rows = await db.select().from(devices);
    const allDevices = rows
      .filter((device) => visibleWhenDemoDataEnabled(device))
      .map((device) => deviceWithCurrentStatus(device, now));
    const stats = {
      total: allDevices.length,
      online: allDevices.filter(d => d.status === 'online').length,
      offline: allDevices.filter(d => d.status === 'offline').length,
      maintenance: allDevices.filter(d => d.status === 'maintenance').length,
      error: allDevices.filter(d => d.status === 'error').length,
      byType: {} as Record<string, number>
    };
    
    allDevices.forEach(d => {
      stats.byType[d.type] = (stats.byType[d.type] || 0) + 1;
    });
    
    return stats;
  });
}

/** Heartbeats prove connectivity without inventing a sensor reading. */
export async function recordDeviceHeartbeat(input: { deviceId: string; timestamp: number; status: "online" | "offline" }) {
  return withDb(async (db) => db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.deviceId}))`);
    const [device] = await tx.select().from(devices).where(eq(devices.deviceId, input.deviceId)).limit(1);
    if (!device || device.type !== "gateway" || device.isDemo) return false;
    if (device.lastSeen && device.lastSeen.getTime() >= input.timestamp) return true;
    await tx.update(devices).set({
      lastSeen: new Date(input.timestamp),
      metadata:{...device.metadata,heartbeatPolicy:"mqtt-gateway-5s-v1",freshnessMs:device.metadata?.freshnessMs??120000},
      status: device.status === "maintenance" || device.status === "error" ? device.status : input.status,
      updatedAt: new Date(),
    }).where(eq(devices.id, device.id));
    return true;
  }));
}

// ============ Asset Administration Shell Functions ============
export async function getAssets() {
  return withDb(async (db) => {
    const [rows, connectionCounts] = await Promise.all([db.select({
    id: assets.id,
    assetId: assets.assetId,
    name: assets.name,
    assetType: assets.assetType,
    manufacturer: assets.manufacturer,
    model: assets.model,
    manufacturerStreet: assets.manufacturerStreet,
    manufacturerZipcode: assets.manufacturerZipcode,
    manufacturerCityTown: assets.manufacturerCityTown,
    manufacturerNationalCode: assets.manufacturerNationalCode,
    manufacturerArticleNumber: assets.manufacturerArticleNumber,
    orderCodeOfManufacturer: assets.orderCodeOfManufacturer,
    ratedValue: assets.ratedValue,
    ratedUnit: assets.ratedUnit,
    serialNumber: assets.serialNumber,
    location: assets.location,
    zone: assets.zone,
    lifecycleStage: assets.lifecycleStage,
    aasVersion: assets.aasVersion,
    isDemo: assets.isDemo,
    aasxImported: assets.aasxImported,
    createdAt: assets.createdAt,
    updatedAt: assets.updatedAt,
    }).from(assets).orderBy(asc(assets.name)), db.select({
      assetId: assetDevices.assetId,
      connectionCount: sql<number>`count(*)::int`,
    }).from(assetDevices).groupBy(assetDevices.assetId)]);
    const countsByAsset = new Map(connectionCounts.map((connection) => [connection.assetId, connection.connectionCount]));
    return rows.filter((asset) => visibleWhenDemoDataEnabled(asset)).map((asset) => ({
      ...asset,
      connectionCount: countsByAsset.get(asset.id) ?? 0,
      connectionConfigured: (countsByAsset.get(asset.id) ?? 0) > 0,
      // Deprecated compatibility alias for configuration only; never an availability signal.
      isConnected: (countsByAsset.get(asset.id) ?? 0) > 0,
    }));
  });
}

export async function getAssetById(id: number) {
  return withDb(async (db) => {
    const [asset] = await db.select({
      id: assets.id,
      assetId: assets.assetId,
      name: assets.name,
      assetType: assets.assetType,
      manufacturer: assets.manufacturer,
      model: assets.model,
      manufacturerStreet: assets.manufacturerStreet,
      manufacturerZipcode: assets.manufacturerZipcode,
      manufacturerCityTown: assets.manufacturerCityTown,
      manufacturerNationalCode: assets.manufacturerNationalCode,
      manufacturerArticleNumber: assets.manufacturerArticleNumber,
      orderCodeOfManufacturer: assets.orderCodeOfManufacturer,
      ratedValue: assets.ratedValue,
      ratedUnit: assets.ratedUnit,
      serialNumber: assets.serialNumber,
      location: assets.location,
      zone: assets.zone,
      lifecycleStage: assets.lifecycleStage,
      aasVersion: assets.aasVersion,
      isDemo: assets.isDemo,
      aasxImported: assets.aasxImported,
      aasxPackageId: assets.aasxPackageId,
      createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
    }).from(assets).where(eq(assets.id, id)).limit(1);
    return asset && visibleWhenDemoDataEnabled(asset) ? asset : undefined;
  });
}

export async function getAssetRecordById(id: number) {
  return withDb(async (db) => {
    const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
    return asset && visibleWhenDemoDataEnabled(asset) ? asset : undefined;
  });
}

export async function deleteAsset(id: number): Promise<boolean> {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select({ id: assets.id, isDemo: assets.isDemo }).from(assets)
      .where(eq(assets.id, id)).limit(1).for("update");
    if (!current) return false;
    if (current.isDemo) throw new Error("Demo assets are read-only");
    await tx.delete(assetDevices).where(eq(assetDevices.assetId, id));
    await tx.delete(assetLifecycleEvents).where(eq(assetLifecycleEvents.assetId, id));
    await tx.delete(assetVersions).where(eq(assetVersions.assetId, id));
    await tx.delete(assets).where(eq(assets.id, id));
    return true;
  }));
}

/** Return the owning dashboard asset for an AAS shell or its submodel ID. */
export async function findManagedAasShellId(identifier: string) {
  const separator = "/submodels/";
  const shellId = identifier.includes(separator) ? identifier.slice(0, identifier.indexOf(separator)) : identifier;
  return withDb(async (db) => {
    const [asset] = await db.select({ assetId: assets.assetId }).from(assets)
      .where(eq(assets.assetId, shellId)).limit(1);
    return asset?.assetId;
  });
}

export async function getAssetVersions(assetId: number) {
  return withDb(async (db) => db.select({
    version: assetVersions.version,
    changeType: assetVersions.changeType,
    changeNote: assetVersions.changeNote,
    changedBy: assetVersions.changedBy,
    sha256: assetVersions.sha256,
    createdAt: assetVersions.createdAt,
  }).from(assetVersions).where(eq(assetVersions.assetId, assetId)).orderBy(desc(assetVersions.version)));
}

export async function getAssetVersionSnapshot(assetId: number, version: number) {
  return withDb(async (db) => {
    const [record] = await db.select().from(assetVersions)
      .where(and(eq(assetVersions.assetId, assetId), eq(assetVersions.version, version))).limit(1);
    return record;
  });
}

export async function getAssetsForDevice(devicePk: number) {
  return withDb(async (db) => (await db.select({id:assets.id,assetId:assets.assetId,name:assets.name,isDemo:assets.isDemo})
    .from(assetDevices).innerJoin(assets,eq(assets.id,assetDevices.assetId))
    .where(eq(assetDevices.deviceId,devicePk)).orderBy(asc(assets.id))).filter(r=>visibleWhenDemoDataEnabled(r)));
}
/** Compatibility only: callers needing relationships must use getAssetsForDevice. */
export async function getAssetForDevice(devicePk: number) {
  const links=await getAssetsForDevice(devicePk);
  return links.length ? getAssetById(links[0].id) : undefined;
}

export async function getAssetLifecycleEvents(assetId: number) {
  return withDb(async (db) => db.select().from(assetLifecycleEvents)
    .where(eq(assetLifecycleEvents.assetId, assetId))
    .orderBy(desc(assetLifecycleEvents.createdAt)));
}

export async function createAsset(
  asset: InsertAsset,
  connection?:
    | { mode: "gateway"; deviceId: number; protocol: string; endpoint?: string; tagMappings: Array<Record<string, unknown>> }
    | { mode: "direct_mqtt"; deviceId: string },
  createdBy = 0,
) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [created] = await tx.insert(assets).values(asset).returning();
    await tx.insert(assetVersions).values(versionRecord(created, createdBy, "created", "Initial AAS registration"));
    await tx.insert(assetLifecycleEvents).values({
      assetId: created.id,
      fromStage: null,
      toStage: created.lifecycleStage,
      changedBy: createdBy,
      note: "Asset registered",
    });
    if (connection) {
      let connectionDevicePk: number;
      let protocol: string;
      let endpoint: string | null = null;
      let tagMappings: Array<Record<string, unknown>> = [];
      if (connection.mode === "gateway") {
        const [gateway] = await tx.select({ id: devices.id, type: devices.type, isDemo: devices.isDemo }).from(devices)
          .where(eq(devices.id, connection.deviceId)).limit(1);
        if (!gateway || gateway.type !== "gateway" || gateway.isDemo) throw new Error("Select a registered live edge gateway");
        connectionDevicePk = gateway.id;
        protocol = connection.protocol;
        endpoint = connection.endpoint || null;
        tagMappings = connection.tagMappings;
      } else {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(connection.deviceId)) throw new Error("Direct MQTT device ID must be a safe MQTT topic segment");
        let [directDevice] = await tx.select().from(devices).where(eq(devices.deviceId, connection.deviceId)).limit(1);
        if (directDevice && (directDevice.type === "gateway" || directDevice.isDemo || directDevice.metadata?.connectionMode !== "direct_mqtt")) {
          throw new Error("This device ID is already assigned to another connectivity record");
        }
        if (!directDevice) {
          [directDevice] = await tx.insert(devices).values({
            deviceId: connection.deviceId,
            name: asset.name,
            type: "sensor",
            status: "offline",
            location: asset.location ?? null,
            zone: asset.zone ?? null,
            isDemo: false,
            metadata: { connectionMode: "direct_mqtt", assetId: asset.assetId },
          }).returning();
        }
        const [existingLink] = await tx.select({ id: assetDevices.id }).from(assetDevices)
          .where(eq(assetDevices.deviceId, directDevice.id)).limit(1);
        if (existingLink) throw new Error("This direct MQTT device is already linked to an asset");
        connectionDevicePk = directDevice.id;
        protocol = "mqtt_direct";
      }
      await tx.insert(assetDevices).values({
        assetId: created.id,
        deviceId: connectionDevicePk,
        protocol,
        endpoint,
        tagMappings,
      });
    }
    return created;
  }));
}

/** Persist every shell from an imported AASX package in one database transaction. */
export async function importAasxAssets(
  imported: Array<{ shell: Record<string, unknown>; submodels: Array<Record<string, unknown>>; conceptDescriptions: Array<Record<string, unknown>> }>,
  createdBy: number,
  connection?:
    | { mode: "gateway"; deviceId: number; protocol: string; endpoint?: string; tagMappings: Array<Record<string, unknown>> }
    | { mode: "direct_mqtt"; deviceId: string },
  packageId?: string,
) {
  if (imported.length < 1 || imported.length > 25) throw new Error("AASX packages must contain between 1 and 25 asset shells");
  if (connection && imported.length !== 1) throw new Error("Assign one gateway profile per imported AAS package");
  return withDb(async (db) => db.transaction(async (tx) => {
    const saved: Array<{ id: number; assetId: string; name: string }> = [];
    for (const item of imported) {
      const shellId = item.shell.id;
      if (typeof shellId !== "string" || !shellId.trim() || shellId.length > 128) {
        throw new Error("An imported AAS shell is missing a valid identifier");
      }
      const information = item.shell.assetInformation && typeof item.shell.assetInformation === "object"
        ? item.shell.assetInformation as Record<string, unknown>
        : {};
      const name = typeof item.shell.idShort === "string" ? item.shell.idShort : String(information.globalAssetId ?? shellId);
      const specificIds = Array.isArray(information.specificAssetIds) ? information.specificAssetIds : [];
      const declaredType = specificIds.map((entry) => entry && typeof entry === "object" ? entry as Record<string, unknown> : {})
        .find((entry) => entry.name === "assetType")?.value;
      const validTypes = new Set(["compressor", "transformer", "pump", "motor", "wind_turbine", "robotic_arm", "other"]);
      const assetType = typeof declaredType === "string" && validTypes.has(declaredType.toLowerCase()) ? declaredType.toLowerCase() : "other";
      const summary = getImportedAssetSummary(item.submodels);
      const [created] = await tx.insert(assets).values({
        assetId: shellId,
        name: name.slice(0, 255),
        assetType,
        manufacturer: summary.manufacturer?.slice(0, 255) ?? null,
        model: summary.model?.slice(0, 255) ?? null,
        lifecycleStage: "planned",
        isDemo: false,
        aasShell: item.shell,
        aasSubmodels: item.submodels,
        aasConceptDescriptions: item.conceptDescriptions,
        aasxImported: true,
        aasxPackageId: packageId ?? null,
      }).returning();
      await tx.insert(assetVersions).values(versionRecord(created, createdBy, "imported", "Initial AASX package import"));
      await tx.insert(assetLifecycleEvents).values({
        assetId: created.id,
        fromStage: null,
        toStage: "planned",
        changedBy: createdBy,
        note: "Imported from AASX package",
      });
      if (connection) {
        let connectionDevicePk: number;
        let protocol: string;
        let endpoint: string | null = null;
        let tagMappings: Array<Record<string, unknown>> = [];
        if (connection.mode === "gateway") {
          const [gateway] = await tx.select({ id: devices.id, type: devices.type, isDemo: devices.isDemo })
            .from(devices).where(eq(devices.id, connection.deviceId)).limit(1);
          if (!gateway || gateway.type !== "gateway" || gateway.isDemo) throw new Error("Select a registered live edge gateway");
          connectionDevicePk = gateway.id;
          protocol = connection.protocol;
          endpoint = connection.endpoint || null;
          tagMappings = connection.tagMappings;
        } else {
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(connection.deviceId)) throw new Error("Direct MQTT device ID must be a safe MQTT topic segment");
          let [directDevice] = await tx.select().from(devices).where(eq(devices.deviceId, connection.deviceId)).limit(1);
          if (directDevice && (directDevice.type === "gateway" || directDevice.isDemo || directDevice.metadata?.connectionMode !== "direct_mqtt")) {
            throw new Error("This device ID is already assigned to another connectivity record");
          }
          if (!directDevice) {
            [directDevice] = await tx.insert(devices).values({
              deviceId: connection.deviceId,
              name,
              type: "sensor",
              status: "offline",
              location: null,
              zone: null,
              isDemo: false,
              metadata: { connectionMode: "direct_mqtt", assetId: shellId },
            }).returning();
          }
          const [existingLink] = await tx.select({ id: assetDevices.id }).from(assetDevices)
            .where(eq(assetDevices.deviceId, directDevice.id)).limit(1);
          if (existingLink) throw new Error("This direct MQTT device is already linked to an asset");
          connectionDevicePk = directDevice.id;
          protocol = "mqtt_direct";
        }
        await tx.insert(assetDevices).values({
          assetId: created.id,
          deviceId: connectionDevicePk,
          protocol,
          endpoint,
          tagMappings,
        });
      }
      saved.push({ id: created.id, assetId: created.assetId, name: created.name });
    }
    return saved;
  }));
}

export async function updateAsset(
  id: number,
  expectedVersion: number,
  input: Pick<InsertAsset,
    | "name" | "assetType" | "manufacturer" | "model" | "manufacturerStreet"
    | "manufacturerZipcode" | "manufacturerCityTown" | "manufacturerNationalCode"
    | "manufacturerArticleNumber" | "orderCodeOfManufacturer" | "serialNumber"
    | "ratedValue" | "ratedUnit" | "location" | "zone"
  >,
  changedBy: number,
  changeNote: string,
  provision: (assetId: string, nextVersion: number, expectedVersion: number) => Promise<ReturnType<typeof buildAasDocuments>>,
) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(assets).where(eq(assets.id, id)).limit(1).for("update");
    if (!current) return undefined;
    if (current.isDemo) throw new Error("Demo assets are read-only");
    if (current.aasxImported) throw new Error("Imported AASX assets are immutable in this editor; re-import with a new shell ID to preserve the vendor model");
    if (current.aasVersion !== expectedVersion) throw new Error(`Asset version conflict: current version is ${current.aasVersion}`);

    // The row lock serializes engineering changes across all dashboard replicas.
    const nextVersion = expectedVersion + 1;
    const aas = await provision(current.assetId, nextVersion, expectedVersion);
    const [updated] = await tx.update(assets)
      .set({ ...input, aasVersion: nextVersion, aasShell: aas.shell, aasSubmodels: aas.submodels, aasConceptDescriptions: aas.conceptDescriptions ?? [], updatedAt: new Date() })
      .where(and(eq(assets.id, id), eq(assets.aasVersion, expectedVersion)))
      .returning();
    if (!updated) throw new Error("Asset version conflict: the asset changed while this update was being saved");
    await tx.insert(assetVersions).values(versionRecord(updated, changedBy, "updated", changeNote));
    return { id: updated.id, assetId: updated.assetId };
  }));
}

export async function getAssetConnections(assetId: number) {
  return withDb(async (db) => db.select({
    id: assetDevices.id,
    assetId: assetDevices.assetId,
    deviceId: assetDevices.deviceId,
    gatewayDeviceId: devices.deviceId,
    gatewayName: devices.name,
    connectionDeviceType: devices.type,
    protocol: assetDevices.protocol,
    endpoint: assetDevices.endpoint,
    tagMappings: assetDevices.tagMappings,
    lastSeen: assetDevices.lastSeen,
  }).from(assetDevices).innerJoin(devices, eq(assetDevices.deviceId, devices.id))
    .where(eq(assetDevices.assetId, assetId)));
}

export async function getGatewayAssetConnections(gatewayDeviceId: string) {
  return withDb(async (db) => db.select({
    assetId: assets.assetId,
    assetName: assets.name,
    protocol: assetDevices.protocol,
    endpoint: assetDevices.endpoint,
    tagMappings: assetDevices.tagMappings,
  }).from(assetDevices)
    .innerJoin(devices, eq(assetDevices.deviceId, devices.id))
    .innerJoin(assets, eq(assetDevices.assetId, assets.id))
    .where(and(eq(devices.deviceId, gatewayDeviceId), eq(devices.type, "gateway"))));
}

export async function ingestTelemetryByDeviceId(input: {
  deviceId: string;
  gatewayId?: string;
  assetId?: string | null;
  assetSignals?: Record<string, number>;
  sensorType?: string;
  sensorStatus?: "ok" | "read_error";
  ingestionId?: string;
  integration?: unknown;
  temperature?: number | null;
  humidity?: number | null;
  vibration?: number | null;
  power?: number | null;
  pressure?: number | null;
  rpm?: number | null;
  timestamp: number;
}) {
  return withDb(async (db) => db.transaction(async (tx) => {
    // Serialize one source across replicas, including its first registration and alert deduplication.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.deviceId}))`);
    const streamMode = (input.integration as { mode?: string } | undefined)?.mode;
    const operational = !streamMode || streamMode === "live";
    let [device] = await tx.select().from(devices).where(eq(devices.deviceId, input.deviceId)).limit(1);
    if (!device) {
      [device] = await tx.insert(devices).values({
        deviceId: input.deviceId,
        name: input.deviceId,
        type: input.gatewayId === input.deviceId ? "gateway" : input.gatewayId ? "edge_device" : "sensor",
        status: operational ? "online" : "offline",
        lastSeen: operational ? new Date(input.timestamp) : null,
        isDemo: false,
        metadata: {
          connectionMode: input.gatewayId ? "gateway" : "direct_mqtt",
          ...(input.gatewayId && input.gatewayId !== input.deviceId ? { gatewayId: input.gatewayId } : {}),
          ...(input.sensorType ? { sensorType: input.sensorType } : {}),
          ...(input.sensorStatus ? { sensorStatus: input.sensorStatus } : {}),
        },
      }).returning();
    } else if (operational) {
      const metadata: Record<string, unknown> = { ...(device.metadata ?? {}), connectionMode: input.gatewayId || device.type === "gateway" ? "gateway" : "direct_mqtt" };
      if (input.gatewayId && input.gatewayId !== input.deviceId) metadata.gatewayId = input.gatewayId;
      else delete metadata.gatewayId;
      // Health metadata describes the latest source sample. A delayed retry may
      // still be persisted, but it must not replace a newer sensor status.
      const isNewestSample = input.timestamp >= (device.lastSeen?.getTime() ?? 0);
      if (isNewestSample && input.sensorType) metadata.sensorType = input.sensorType;
      if (isNewestSample && input.sensorStatus) metadata.sensorStatus = input.sensorStatus;
      [device] = await tx.update(devices).set({
        type: input.gatewayId === input.deviceId
          ? "gateway"
          : input.gatewayId && device.type === "sensor"
            ? "edge_device"
            : device.type,
        status: device.status === "maintenance" || device.status === "error" ? device.status : "online",
        lastSeen: new Date(Math.max(input.timestamp, device.lastSeen?.getTime() ?? 0)), metadata, updatedAt: new Date(),
      })
        .where(eq(devices.id, device.id)).returning();
    }
    let attributedAssetId = input.assetId ?? null;
    if (attributedAssetId) {
      // Trust an AAS attribution only when this source or its declared gateway
      // has a persisted connection to that exact asset.
      const sourceDeviceId = input.gatewayId && input.gatewayId !== input.deviceId ? input.gatewayId : input.deviceId;
      const [sourceDevice] = await tx.select({ id: devices.id }).from(devices)
        .where(eq(devices.deviceId, sourceDeviceId)).limit(1);
      const [connection] = sourceDevice ? await tx.select({ assetId: assets.assetId }).from(assetDevices)
        .innerJoin(assets, eq(assets.id, assetDevices.assetId))
        .where(and(eq(assetDevices.deviceId, sourceDevice.id), eq(assets.assetId, attributedAssetId))).limit(1) : [];
      if (!connection) throw new Error("Telemetry assetId is not linked to the publishing device or its gateway");
    } else if (!input.gatewayId && device.metadata?.connectionMode === "direct_mqtt") {
      const connections = await tx.select({ assetId: assets.assetId }).from(assetDevices)
        .innerJoin(assets, eq(assets.id, assetDevices.assetId))
        .where(eq(assetDevices.deviceId, device.id)).limit(2);
      attributedAssetId = connections.length === 1 ? connections[0].assetId : null;
    }

    // Adding optional provenance must not change legacy retry identities.
    const canonicalInput = { ...input, ingestionId: undefined };
    if (canonicalInput.integration === undefined) delete canonicalInput.integration;
    const ingestionId = input.ingestionId ?? createHash("sha256").update(stableJson(canonicalInput)).digest("hex");
    const inserted = await tx.insert(sensorReadings).values({
      deviceId: device.id,
      // Keep the AAS identifier on each reading so asset analytics can
      // distinguish two machines reported by the same edge gateway.
      assetId: attributedAssetId,
      assetSignals: input.assetSignals ?? null,
      ingestionId,
      integration: (input.integration ?? null) as Record<string, unknown> | null,
      temperature: input.temperature ?? null,
      humidity: input.humidity ?? null,
      vibration: input.vibration ?? null,
      power: input.power ?? null,
      pressure: input.pressure ?? null,
      rpm: input.rpm ?? null,
      timestamp: input.timestamp,
    }).onConflictDoNothing({ target: sensorReadings.ingestionId }).returning({ id: sensorReadings.id });
    if (inserted.length === 0) return { deviceId: device.deviceId, receivedAt: new Date(input.timestamp), duplicate: true };
    if (process.env.ONESA_ENABLED === "true" && !device.isDemo) {
      try {
        await tx.transaction(async savepoint => captureOnesa(savepoint, { ...input, assetId: attributedAssetId, ingestionId }));
      } catch { recordCaptureFailure(); }
    }
    if (attributedAssetId && operational) {
      const [asset] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.assetId, attributedAssetId)).limit(1);
      const [gateway] = input.gatewayId && input.gatewayId !== input.deviceId
        ? await tx.select({ id: devices.id }).from(devices).where(eq(devices.deviceId, input.gatewayId)).limit(1) : [];
      if (asset) await tx.update(assetDevices).set({ lastSeen: sql`greatest(${assetDevices.lastSeen}, ${new Date(input.timestamp).toISOString()}::timestamptz)` })
        .where(and(eq(assetDevices.assetId, asset.id), eq(assetDevices.deviceId, gateway?.id ?? device.id)));
    }

    // Evaluate configured device thresholds in the same transaction as the
    // telemetry write. An open event is kept until a technician resolves it;
    // repeated samples do not create an alert storm for the same metric.
    const metricValues: Record<string, number | null | undefined> = {
      temperature: input.temperature,
      humidity: input.humidity,
      vibration: input.vibration,
      power: input.power,
      pressure: input.pressure,
      rpm: input.rpm,
    };
    const configuredThresholds = await tx.select().from(alertThresholds).where(eq(alertThresholds.deviceId, device.id));
    for (const threshold of configuredThresholds) {
      // Historical and simulated streams do not create live incidents.
      const mode = (input.integration as { mode?: string } | undefined)?.mode;
      if (mode === "replay" || mode === "simulated" || !threshold.enabled) continue;
      const value = metricValues[threshold.metric];
      const breach = evaluateAlertThreshold(value, threshold);
      if (!breach || value === null || value === undefined) continue;
      const [openAlert] = await tx.select().from(alerts).where(and(
        eq(alerts.deviceId, device.id),
        attributedAssetId ? eq(alerts.assetId, attributedAssetId) : isNull(alerts.assetId),
        eq(alerts.metric, threshold.metric),
        inArray(alerts.status, ["active", "acknowledged"]),
      )).limit(1);
      const message = `${threshold.metric} reported ${value} ${breach.direction} configured ${breach.severity} threshold ${breach.threshold}`;
      const errorCode = getAlertErrorCode({ type: "threshold_exceeded", metric: threshold.metric, severity: breach.severity });
      if (openAlert) {
        // Escalate an existing warning in place while retaining assignment,
        // acknowledgement history, and its original incident start time.
        if (breach.severity === "critical" && openAlert.severity !== "critical") {
          await tx.update(alerts).set({ severity: breach.severity, value, threshold: breach.threshold, message, errorCode, updatedAt: new Date() })
            .where(eq(alerts.id, openAlert.id));
        }
        continue;
      }
      await tx.insert(alerts).values({
        deviceId: device.id,
        assetId: attributedAssetId,
        type: "threshold_exceeded",
        severity: breach.severity,
        metric: threshold.metric,
        value,
        threshold: breach.threshold,
        message,
        errorCode,
      });
    }
    return { deviceId: device.deviceId, receivedAt: new Date(input.timestamp) };
  }));
}

export async function transitionAssetLifecycle(
  assetId: number,
  toStage: AssetLifecycleStage,
  changedBy: number,
  note?: string,
) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [asset] = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) return undefined;
    if (asset.isDemo) throw new Error("Demo assets are read-only");
    if (!getAllowedAssetTransitions(asset.lifecycleStage).includes(toStage)) {
      throw new Error(`Cannot move an asset from ${asset.lifecycleStage} to ${toStage}`);
    }
    const [updated] = await tx.update(assets)
      .set({ lifecycleStage: toStage, updatedAt: new Date() })
      .where(eq(assets.id, assetId)).returning();
    await tx.insert(assetLifecycleEvents).values({
      assetId,
      fromStage: asset.lifecycleStage,
      toStage,
      changedBy,
      note: note || null,
    });
    return updated;
  }));
}

/** Seed the API-backed scenario. Startup stays conservative around live assets; an
 * explicit administrator action may opt in alongside real equipment. */
export async function initializeDemoScenario(options: { allowAlongsideLive?: boolean } = {}) {
  return withDb(async (db) => db.transaction(async (tx) => {
    // Serialize startup across web replicas and explicit admin toggles. The
    // unique asset/device identities remain a second line of defense.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2026100701)`);
    const [liveAsset] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.isDemo, false)).limit(1);
    const [alreadySeeded] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.isDemo, true)).limit(1);
    // Add the new demo asset on existing installations without rebuilding or
    // replacing their API-backed demonstration records.
    const seedWindformerDemo = async () => {
      const windformerId = "urn:demo:asset:windformer-wtg-01";
      const [existing] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.assetId, windformerId)).limit(1);
      if (existing) return false;

      const [gateway] = await tx.insert(devices).values({
        deviceId: "demo-gateway-windformer-01",
        name: "Edge Gateway · Windformer WTG 01",
        type: "gateway",
        status: "online",
        location: "Wind Yard",
        zone: "Renewable Generation",
        firmwareVersion: "demo-1.0",
        lastSeen: new Date(),
        isDemo: true,
        metadata: { protocol: "Modbus TCP", source: "simulator" },
      }).returning();

      const identity = {
        assetId: windformerId,
        name: "Windformer Wind Turbine Generator 01",
        assetType: "wind_turbine",
        manufacturer: "Smart Factory Demo Works",
        model: "Windformer WTG 2.5 MW (simulated)",
        manufacturerStreet: "Demo Energy Lane 1",
        manufacturerZipcode: "10002",
        manufacturerCityTown: "Demo City",
        manufacturerNationalCode: "DE",
        manufacturerArticleNumber: "WF-25-DEMO",
        orderCodeOfManufacturer: "WTF-2500-DEMO",
        serialNumber: "DEMO-WF-001",
        ratedValue: "2500",
        ratedUnit: "kW",
      };
      const aas = buildAasDocuments(identity);
      const [windformer] = await tx.insert(assets).values({
        ...identity,
        location: "Wind Yard",
        zone: "Renewable Generation",
        lifecycleStage: "operational",
        isDemo: true,
        aasShell: aas.shell,
        aasSubmodels: aas.submodels,
        aasConceptDescriptions: aas.conceptDescriptions,
      }).returning();
      await tx.insert(assetVersions).values(versionRecord(windformer, 0, "demo", "Generated API Windformer scenario; all operating values are synthetic"));
      await tx.insert(assetDevices).values({
        assetId: windformer.id,
        deviceId: gateway.id,
        protocol: "modbus_tcp",
        endpoint: "windformer-demo.local:502",
        tagMappings: [
          { name: "Generator temperature", metric: "temperature", address: 100, registerType: "holding_register", scale: 0.1 },
          { name: "Nacelle vibration", metric: "vibration", address: 104, registerType: "holding_register", scale: 0.01 },
          { name: "Active power", metric: "power", address: 108, registerType: "holding_register", scale: 1 },
          { name: "Rotor speed", metric: "rpm", address: 112, registerType: "holding_register", scale: 0.1 },
        ],
      });

      const now = Date.now();
      const readings: schema.InsertSensorReading[] = [];
      for (let index = 47; index >= 0; index--) {
        const timestamp = now - index * 30 * 60 * 1000;
        const phase = index / 6;
        const windSpeed = 8.5 + Math.sin(phase) * 2.4;
        const outputKw = Math.max(0, Math.min(2450, 1350 + (windSpeed - 8.5) * 260 + Math.cos(phase / 2) * 110));
        readings.push({
          deviceId: gateway.id,
          assetId: windformerId,
          temperature: 64 + Math.sin(phase / 2) * 3.5,
          humidity: null,
          vibration: 1.05 + Math.sin(phase / 3) * 0.12,
          power: outputKw * 1000,
          pressure: null,
          rpm: 16.5 + Math.cos(phase / 2) * 1.8,
          assetSignals: {
            windSpeedMps: windSpeed,
            rotorSpeedRpm: 16.5 + Math.cos(phase / 2) * 1.8,
            bladePitchDeg: 7 + Math.sin(phase / 3) * 2.2,
            generatorPowerKw: outputKw,
          },
          timestamp,
        });
      }
      await tx.insert(sensorReadings).values(readings);
      await tx.insert(assetLifecycleEvents).values([
        { assetId: windformer.id, fromStage: null, toStage: "commissioned", changedBy: 0, note: "Simulated wind turbine commissioning record" },
        { assetId: windformer.id, fromStage: "commissioned", toStage: "operational", changedBy: 0, note: "Simulated wind turbine entered operation" },
      ]);
      await tx.insert(alerts).values({
        deviceId: gateway.id,
        type: "maintenance_required",
        severity: "info",
        errorCode: "SF-MAINT-001",
        message: "Windformer pitch-system inspection due (simulated demo event)",
        status: "active",
      });
      return true;
    };

    if (alreadySeeded) {
      return { seeded: false, addedWindformer: await seedWindformerDemo() };
    }
    if (liveAsset && !options.allowAlongsideLive) return { seeded: false };

    const demoDevices = await tx.insert(devices).values([
      { deviceId: "demo-gateway-compressor-01", name: "Edge Gateway · Compressor 01", type: "gateway", status: "online", location: "Utilities Room", zone: "Plant A", firmwareVersion: "demo-1.0", lastSeen: new Date(), isDemo: true, metadata: { protocol: "OPC UA", source: "simulator" } },
      { deviceId: "demo-gateway-transformer-01", name: "Edge Gateway · Transformer 01", type: "gateway", status: "online", location: "Substation", zone: "Plant A", firmwareVersion: "demo-1.0", lastSeen: new Date(), isDemo: true, metadata: { protocol: "Modbus TCP", source: "simulator" } },
    ]).returning();

    const compressorId = "urn:demo:asset:compressor-01";
    const transformerId = "urn:demo:asset:transformer-01";
    const compressorAas = buildAasDocuments({ assetId: compressorId, name: "Compressed Air Compressor 01", assetType: "compressor", manufacturer: "Atlas Copco", model: "GA 75 VSD+", manufacturerStreet: "Industrial Road 1", manufacturerZipcode: "10000", manufacturerCityTown: "Demo City", manufacturerNationalCode: "DE", manufacturerArticleNumber: "GA75-VSD", orderCodeOfManufacturer: "GA75-VSD-PLUS", serialNumber: "DEMO-GA75-001", ratedValue: "75", ratedUnit: "kW" });
    const transformerAas = buildAasDocuments({ assetId: transformerId, name: "Main Transformer 01", assetType: "transformer", manufacturer: "Siemens", model: "GEAFOL 1600", manufacturerStreet: "Technology Avenue 1", manufacturerZipcode: "10001", manufacturerCityTown: "Demo City", manufacturerNationalCode: "DE", manufacturerArticleNumber: "GEAFOL-1600", orderCodeOfManufacturer: "GEAFOL-1600", serialNumber: "DEMO-GEAFOL-001", ratedValue: "1600", ratedUnit: "kVA" });
    const demoAssets = await tx.insert(assets).values([
      { assetId: compressorId, name: "Compressed Air Compressor 01", assetType: "compressor", manufacturer: "Atlas Copco", model: "GA 75 VSD+", manufacturerStreet: "Industrial Road 1", manufacturerZipcode: "10000", manufacturerCityTown: "Demo City", manufacturerNationalCode: "DE", manufacturerArticleNumber: "GA75-VSD", orderCodeOfManufacturer: "GA75-VSD-PLUS", ratedValue: "75", ratedUnit: "kW", serialNumber: "DEMO-GA75-001", location: "Utilities Room", zone: "Plant A", lifecycleStage: "operational", isDemo: true, aasShell: compressorAas.shell, aasSubmodels: compressorAas.submodels },
      { assetId: transformerId, name: "Main Transformer 01", assetType: "transformer", manufacturer: "Siemens", model: "GEAFOL 1600", manufacturerStreet: "Technology Avenue 1", manufacturerZipcode: "10001", manufacturerCityTown: "Demo City", manufacturerNationalCode: "DE", manufacturerArticleNumber: "GEAFOL-1600", orderCodeOfManufacturer: "GEAFOL-1600", ratedValue: "1600", ratedUnit: "kVA", serialNumber: "DEMO-GEAFOL-001", location: "Substation", zone: "Plant A", lifecycleStage: "maintenance", isDemo: true, aasShell: transformerAas.shell, aasSubmodels: transformerAas.submodels },
    ]).returning();
    await tx.insert(assetVersions).values(demoAssets.map((asset) => versionRecord(asset, 0, "demo", "Generated API demo scenario")));

    await tx.insert(assetDevices).values([
      { assetId: demoAssets[0].id, deviceId: demoDevices[0].id, protocol: "opcua", endpoint: "opc.tcp://demo.local:4840", tagMappings: [{ name: "Temperature", metric: "temperature", nodeId: "ns=2;s=Compressor.Temperature" }, { name: "Pressure", metric: "pressure", nodeId: "ns=2;s=Compressor.Pressure" }, { name: "Power", metric: "power", nodeId: "ns=2;s=Compressor.Power" }, { name: "Speed", metric: "rpm", nodeId: "ns=2;s=Compressor.Speed" }] },
      { assetId: demoAssets[1].id, deviceId: demoDevices[1].id, protocol: "modbus_tcp", endpoint: "10.0.0.40:502", tagMappings: [{ name: "Winding temperature", metric: "temperature", address: 100, registerType: "holding_register", scale: 0.1 }, { name: "Pressure", metric: "pressure", address: 104, registerType: "holding_register", scale: 0.01 }, { name: "Power", metric: "power", address: 108, registerType: "holding_register", scale: 1 }] },
    ]);

    const now = Date.now();
    const readings: schema.InsertSensorReading[] = [];
    for (let index = 47; index >= 0; index--) {
      const timestamp = now - index * 30 * 60 * 1000;
      const phase = index / 5;
      readings.push({ deviceId: demoDevices[0].id, assetId: demoAssets[0].assetId, temperature: 68 + Math.sin(phase) * 4, humidity: null, vibration: 2.1 + Math.sin(phase / 2) * 0.3, power: 72000 + Math.cos(phase) * 1800, pressure: 7.4 + Math.sin(phase / 3) * 0.25, rpm: 2940 + Math.cos(phase / 2) * 30, timestamp });
      readings.push({ deviceId: demoDevices[1].id, assetId: demoAssets[1].assetId, temperature: 52 + Math.sin(phase / 2) * 3, humidity: null, vibration: 0.3 + Math.sin(phase) * 0.04, power: 118000 + Math.cos(phase) * 2400, pressure: 0.4 + Math.sin(phase / 3) * 0.02, rpm: null, timestamp });
    }
    await tx.insert(schema.sensorReadings).values(readings);
    await tx.insert(assetLifecycleEvents).values([
      { assetId: demoAssets[0].id, fromStage: null, toStage: "commissioned", changedBy: 0, note: "Demo commissioning record" },
      { assetId: demoAssets[0].id, fromStage: "commissioned", toStage: "operational", changedBy: 0, note: "Demo asset entered operation" },
      { assetId: demoAssets[1].id, fromStage: null, toStage: "operational", changedBy: 0, note: "Demo asset entered operation" },
      { assetId: demoAssets[1].id, fromStage: "operational", toStage: "maintenance", changedBy: 0, note: "Scheduled inspection in progress" },
    ]);
    await tx.insert(alerts).values([
      { deviceId: demoDevices[0].id, type: "maintenance_required", severity: "warning", errorCode: "SF-MAINT-001", message: "Compressor service is due soon", status: "active" },
      { deviceId: demoDevices[1].id, type: "threshold_exceeded", severity: "critical", metric: "temperature", value: 55, threshold: 53, errorCode: "SF-THR-TEMP-CRIT", message: "Transformer winding temperature above operating limit", status: "acknowledged" },
    ]);
    await seedWindformerDemo();
    return { seeded: true };
  }));
}

// ============ Sensor Reading Functions ============
export async function createSensorReading(reading: InsertSensorReading): Promise<void> {
  return withDb(async (db) => {
    await db.insert(sensorReadings).values(reading);
  });
}

export async function createSensorReadingsBatch(readings: InsertSensorReading[]): Promise<void> {
  if (readings.length === 0) return;
  return withDb(async (db) => {
    await db.insert(sensorReadings).values(readings);
  });
}

export async function getSensorReadings(
  deviceId: number,
  startTime: number,
  endTime: number,
  limit: number = 1000
): Promise<SensorReading[]> {
  return withDb(async (db) => {
    return db
      .select()
      .from(sensorReadings)
      .where(
        and(
          eq(sensorReadings.deviceId, deviceId),
          sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`,
          gte(sensorReadings.timestamp, startTime),
          lte(sensorReadings.timestamp, endTime)
        )
      )
      .orderBy(asc(sensorReadings.timestamp))
      .limit(limit);
  });
}

export async function getLatestReading(deviceId: number): Promise<SensorReading | undefined> {
  return withDb(async (db) => {
    const result = await db
      .select()
      .from(sensorReadings)
      .where(and(eq(sensorReadings.deviceId, deviceId), sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`))
      .orderBy(desc(sensorReadings.timestamp))
      .limit(1);
    return result[0];
  });
}

/** Fetch one newest telemetry sample per gateway in one indexed database query. */
export async function getLatestReadings(deviceIds: number[]): Promise<SensorReading[]> {
  if (deviceIds.length === 0) return [];
  return withDb(async (db) => db.selectDistinctOn([sensorReadings.deviceId])
    .from(sensorReadings)
    .where(and(inArray(sensorReadings.deviceId, deviceIds), sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`))
    .orderBy(sensorReadings.deviceId, desc(sensorReadings.timestamp)));
}

/** A gateway can report multiple machines; never substitute its newest sample for another asset. */
export async function getLatestAssetReadings(assetIds: string[]): Promise<SensorReading[]> {
  if (assetIds.length === 0) return [];
  return withDb(async (db) => db.selectDistinctOn([sensorReadings.assetId])
    .from(sensorReadings)
    .where(and(inArray(sensorReadings.assetId, assetIds), sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`))
    .orderBy(sensorReadings.assetId, desc(sensorReadings.timestamp), desc(sensorReadings.id)));
}

export async function getAggregatedReadings(
  deviceIds: number[],
  startTime: number,
  endTime: number,
  intervalMs: number = 3600000 // 1 hour default
) {
  return withDb(async (db) => {
    if (deviceIds.length === 0) return [];
    
    // PostgreSQL AVG ignores absent signals and aggregates before transferring rows.
    const bucket = sql<number>`floor(${sensorReadings.timestamp}::numeric / ${intervalMs}) * ${intervalMs}`;
    return db
      .select({
        timestamp: bucket.mapWith(Number),
        avgTemperature: sql<number | null>`avg(${sensorReadings.temperature})`,
        avgHumidity: sql<number | null>`avg(${sensorReadings.humidity})`,
        avgPower: sql<number | null>`avg(${sensorReadings.power})`,
        avgVibration: sql<number | null>`avg(${sensorReadings.vibration})`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(sensorReadings)
      .where(
        and(
          inArray(sensorReadings.deviceId, deviceIds),
          sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`,
          gte(sensorReadings.timestamp, startTime),
          lte(sensorReadings.timestamp, endTime)
        )
      )
      // Ordinal references avoid separate bind parameters making otherwise
      // identical bucket expressions appear different to PostgreSQL.
      .groupBy(sql`1`)
      .orderBy(sql`1`);
  });
}

/** Aggregate readings attributed to selected AAS assets, retaining asset metadata for group views. */
export async function getAssetTelemetry(
  requestedAssetIds: string[],
  startTime: number,
  endTime: number,
  intervalMs: number = 3600000,
) {
  return withDb(async (db) => {
    const emptyResult = {
      overall: {
        sampleCount: 0, avgTemperature: null, avgHumidity: null, avgVibration: null, avgPower: null, avgPressure: null, avgRpm: null,
        peakTemperature: null, peakVibration: null, peakPower: null, peakRpm: null,
        alerts: { activeCritical: 0, activeWarning: 0, eventsInPeriod: 0 },
      },
      timeline: [],
      assets: [],
    };
    if (requestedAssetIds.length === 0) return emptyResult;

    const selectedAssetRecords = await db.select({
      id: assets.id,
      assetId: assets.assetId,
      name: assets.name,
      assetType: assets.assetType,
      manufacturer: assets.manufacturer,
      location: assets.location,
      zone: assets.zone,
      lifecycleStage: assets.lifecycleStage,
      isDemo: assets.isDemo,
    }).from(assets).where(inArray(assets.assetId, requestedAssetIds));
    const assetRecords = selectedAssetRecords.filter((asset) => visibleWhenDemoDataEnabled(asset));
    if (assetRecords.length === 0) return emptyResult;

    const assetIds = assetRecords.map((asset) => asset.assetId);
    const linkedDevices = await db.select({ assetId: assetDevices.assetId, deviceId: assetDevices.deviceId })
      .from(assetDevices)
      .where(inArray(assetDevices.assetId, assetRecords.map((asset) => asset.id)));
    const assetIdByInternalId = new Map(assetRecords.map((asset) => [asset.id, asset.assetId]));
    const deviceToAssets = new Map<number, string[]>();
    for (const link of linkedDevices) {
      const linked = deviceToAssets.get(link.deviceId) ?? [];
      const assetId = assetIdByInternalId.get(link.assetId);
      if (!assetId) continue;
      linked.push(assetId);
      deviceToAssets.set(link.deviceId, linked);
    }
    const linkedDeviceIds = Array.from(deviceToAssets.keys());
    const alertRecords = linkedDeviceIds.length ? await db.select({
      id: alerts.id,
      assetId: alerts.assetId,
      deviceId: alerts.deviceId,
      severity: alerts.severity,
      status: alerts.status,
      createdAt: alerts.createdAt,
    }).from(alerts).where(and(
      or(inArray(alerts.assetId, assetIds), and(isNull(alerts.assetId), inArray(alerts.deviceId, linkedDeviceIds))),
      lte(alerts.createdAt, new Date(endTime)),
      or(inArray(alerts.status, ["active", "acknowledged"]), gte(alerts.createdAt, new Date(startTime))),
    )) : [];
    const alertSummaryByAsset = new Map<string, { activeCritical: number; activeWarning: number; eventsInPeriod: number }>();
    for (const alert of alertRecords) {
      for (const assetId of alert.assetId ? [alert.assetId] : deviceToAssets.get(alert.deviceId) ?? []) {
        const summary = alertSummaryByAsset.get(assetId) ?? { activeCritical: 0, activeWarning: 0, eventsInPeriod: 0 };
        if (alert.status !== "resolved" && alert.severity === "critical") summary.activeCritical += 1;
        if (alert.status !== "resolved" && alert.severity === "warning") summary.activeWarning += 1;
        if (alert.createdAt.getTime() >= startTime && alert.createdAt.getTime() <= endTime) summary.eventsInPeriod += 1;
        alertSummaryByAsset.set(assetId, summary);
      }
    }
    const readings = await db.select({
      assetId: sensorReadings.assetId,
      assetSignals: sensorReadings.assetSignals,
      timestamp: sensorReadings.timestamp,
      temperature: sensorReadings.temperature,
      humidity: sensorReadings.humidity,
      vibration: sensorReadings.vibration,
      power: sensorReadings.power,
      pressure: sensorReadings.pressure,
      rpm: sensorReadings.rpm,
    }).from(sensorReadings).where(and(
      inArray(sensorReadings.assetId, assetIds),
      sql`coalesce(${sensorReadings.integration}->>'mode','live')='live'`,
      gte(sensorReadings.timestamp, startTime),
      lte(sensorReadings.timestamp, endTime),
    )).orderBy(asc(sensorReadings.timestamp)).limit(200_001);
    if (readings.length > 200_000) throw new Error("This analytics request exceeds 200,000 samples. Select fewer assets or a shorter time range.");

    type Metric = "temperature" | "humidity" | "vibration" | "power" | "pressure" | "rpm";
    type SignalValue = { sum: number; count: number; latest: number; latestTimestamp: number };
    type Bucket = { count: number; sums: Record<Metric, number>; counts: Record<Metric, number>; signals: Map<string, SignalValue> };
    const metrics: Metric[] = ["temperature", "humidity", "vibration", "power", "pressure", "rpm"];
    const makeBucket = (): Bucket => ({
      count: 0,
      sums: { temperature: 0, humidity: 0, vibration: 0, power: 0, pressure: 0, rpm: 0 },
      counts: { temperature: 0, humidity: 0, vibration: 0, power: 0, pressure: 0, rpm: 0 },
      signals: new Map(),
    });
    const add = (bucket: Bucket, reading: (typeof readings)[number]) => {
      bucket.count += 1;
      for (const metric of metrics) {
        const value = reading[metric];
        if (value !== null) {
          bucket.sums[metric] += value;
          bucket.counts[metric] += 1;
        }
      }
      for (const [name, value] of Object.entries(reading.assetSignals ?? {})) {
        if (!Number.isFinite(value)) continue;
        const signal = bucket.signals.get(name) ?? { sum: 0, count: 0, latest: value, latestTimestamp: 0 };
        signal.sum += value;
        signal.count += 1;
        if (reading.timestamp >= signal.latestTimestamp) {
          signal.latest = value;
          signal.latestTimestamp = reading.timestamp;
        }
        bucket.signals.set(name, signal);
      }
    };
    const averages = (bucket: Bucket) => ({
      avgTemperature: bucket.counts.temperature ? bucket.sums.temperature / bucket.counts.temperature : null,
      avgHumidity: bucket.counts.humidity ? bucket.sums.humidity / bucket.counts.humidity : null,
      avgVibration: bucket.counts.vibration ? bucket.sums.vibration / bucket.counts.vibration : null,
      avgPower: bucket.counts.power ? bucket.sums.power / bucket.counts.power : null,
      avgPressure: bucket.counts.pressure ? bucket.sums.pressure / bucket.counts.pressure : null,
      avgRpm: bucket.counts.rpm ? bucket.sums.rpm / bucket.counts.rpm : null,
      assetSignals: Object.fromEntries(Array.from(bucket.signals, ([name, signal]) => [name, signal.sum / signal.count])),
    });

    const timelineBuckets = new Map<number, Bucket>();
    const assetBuckets = new Map<string, Bucket>();
    const latestByAsset = new Map<string, number>();
    const overall = makeBucket();
    const readingsByAsset = new Map<string, typeof readings>();
    for (const reading of readings) {
      if (!reading.assetId) continue;
      add(overall, reading);
      const assetReadings = readingsByAsset.get(reading.assetId) ?? [];
      assetReadings.push(reading);
      readingsByAsset.set(reading.assetId, assetReadings);
      const timestamp = Math.floor(reading.timestamp / intervalMs) * intervalMs;
      const timelineBucket = timelineBuckets.get(timestamp) ?? makeBucket();
      add(timelineBucket, reading);
      timelineBuckets.set(timestamp, timelineBucket);
      const assetBucket = assetBuckets.get(reading.assetId) ?? makeBucket();
      add(assetBucket, reading);
      assetBuckets.set(reading.assetId, assetBucket);
      latestByAsset.set(reading.assetId, Math.max(latestByAsset.get(reading.assetId) ?? 0, reading.timestamp));
    }

    const trendFor = (items: typeof readings, metric: "temperature" | "vibration" | "pressure") => {
      const firstHalf: number[] = [];
      const secondHalf: number[] = [];
      // Split the observed samples, not the entire selected range; sparse but
      // healthy histories can still yield a descriptive early/recent comparison.
      const observedStart = items[0]?.timestamp;
      const observedEnd = items[items.length - 1]?.timestamp;
      if (observedStart === undefined || observedEnd === undefined || observedStart === observedEnd) return null;
      const splitAt = observedStart + (observedEnd - observedStart) / 2;
      for (const item of items) {
        const value = item[metric];
        if (value === null) continue;
        (item.timestamp < splitAt ? firstHalf : secondHalf).push(value);
      }
      if (firstHalf.length === 0 || secondHalf.length === 0) return null;
      const firstMean = firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length;
      const recentMean = secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length;
      return {
        firstHalfMean: firstMean,
        recentHalfMean: recentMean,
        changePercent: Math.abs(firstMean) < Number.EPSILON ? null : ((recentMean - firstMean) / Math.abs(firstMean)) * 100,
      };
    };
    const maxMetric = (items: typeof readings, metric: "temperature" | "vibration" | "power" | "pressure" | "rpm") => {
      let maximum: number | null = null;
      for (const item of items) {
        const value = item[metric];
        if (value !== null && (maximum === null || value > maximum)) maximum = value;
      }
      return maximum;
    };
    const overallAlerts = alertRecords.reduce((sum, item) => ({
      activeCritical: sum.activeCritical + (item.status !== "resolved" && item.severity === "critical" ? 1 : 0),
      activeWarning: sum.activeWarning + (item.status !== "resolved" && item.severity === "warning" ? 1 : 0),
      eventsInPeriod: sum.eventsInPeriod + (item.createdAt.getTime() >= startTime && item.createdAt.getTime() <= endTime ? 1 : 0),
    }), { activeCritical: 0, activeWarning: 0, eventsInPeriod: 0 });

    return {
      overall: {
        sampleCount: overall.count,
        ...averages(overall),
        peakTemperature: maxMetric(readings, "temperature"),
        peakVibration: maxMetric(readings, "vibration"),
        peakPower: maxMetric(readings, "power"),
        peakRpm: maxMetric(readings, "rpm"),
        alerts: overallAlerts,
      },
      timeline: Array.from(timelineBuckets, ([timestamp, bucket]) => ({ timestamp, ...averages(bucket), count: bucket.count }))
        .sort((left, right) => left.timestamp - right.timestamp),
      assets: assetRecords.map((asset) => {
        const bucket = assetBuckets.get(asset.assetId) ?? makeBucket();
        const assetReadings = (readingsByAsset.get(asset.assetId) ?? []).sort((left, right) => left.timestamp - right.timestamp);
        return {
          ...asset,
          sampleCount: bucket.count,
          latestReadingAt: latestByAsset.get(asset.assetId) ?? null,
          ...averages(bucket),
          peakTemperature: maxMetric(assetReadings, "temperature"),
          peakVibration: maxMetric(assetReadings, "vibration"),
          peakPower: maxMetric(assetReadings, "power"),
          peakPressure: maxMetric(assetReadings, "pressure"),
          peakRpm: maxMetric(assetReadings, "rpm"),
          trends: {
            temperature: trendFor(assetReadings, "temperature"),
            vibration: trendFor(assetReadings, "vibration"),
            pressure: trendFor(assetReadings, "pressure"),
          },
          alerts: alertSummaryByAsset.get(asset.assetId) ?? { activeCritical: 0, activeWarning: 0, eventsInPeriod: 0 },
          assetSignals: Array.from(bucket.signals, ([name, signal]) => ({
            name,
            average: signal.sum / signal.count,
            latest: signal.latest,
            latestAt: signal.latestTimestamp,
          })).sort((left, right) => left.name.localeCompare(right.name)),
        };
      }).sort((left, right) => left.name.localeCompare(right.name)),
    };
  });
}

// ============ Alert Threshold Functions ============
export async function getAlertThresholds(deviceId: number): Promise<AlertThreshold[]> {
  return withDb(async (db) => {
    return db.select().from(alertThresholds).where(eq(alertThresholds.deviceId, deviceId));
  });
}

export async function createAlertThreshold(threshold: InsertAlertThreshold): Promise<AlertThreshold> {
  return withDb(async (db) => {
    const [created] = await db.insert(alertThresholds).values(threshold).returning();
    return created;
  });
}

export async function updateAlertThreshold(id: number, data: Partial<InsertAlertThreshold>): Promise<AlertThreshold | undefined> {
  return withDb(async (db) => {
    await db.update(alertThresholds).set({ ...data, updatedAt: new Date() }).where(eq(alertThresholds.id, id));
    const result = await db.select().from(alertThresholds).where(eq(alertThresholds.id, id)).limit(1);
    return result[0];
  });
}

export async function deleteAlertThreshold(id: number): Promise<boolean> {
  return withDb(async (db) => {
    await db.delete(alertThresholds).where(eq(alertThresholds.id, id));
    return true;
  });
}

export async function upsertAlertThresholds(deviceId: number, thresholds: InsertAlertThreshold[]): Promise<void> {
  return withDb(async (db) => db.transaction(async (tx) => {
    await tx.delete(alertThresholds).where(eq(alertThresholds.deviceId, deviceId));
    if (thresholds.length > 0) {
      await tx.insert(alertThresholds).values(thresholds.map((threshold) => ({ ...threshold, deviceId })));
    }
  }));
}

// ============ Alert Functions ============
export async function createAlert(alert: InsertAlert): Promise<Alert> {
  return withDb(async (db) => {
    const [created] = await db.insert(alerts).values({
      ...alert,
      errorCode: getAlertErrorCode(alert),
    }).returning();
    return created;
  });
}

export async function getAlertAssignees() {
  return withDb(async (db) => db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users).where(eq(users.role, "engineer")).orderBy(asc(users.name)));
}

export async function assignAlert(id: number, assignedToId: number | null) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1).for("update");
    if (!current) return undefined;
    if (current.status === "resolved") throw new Error("Resolved alerts cannot be reassigned");
    if (assignedToId !== null) {
      const [assignee] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.id, assignedToId), eq(users.role, "engineer"))).limit(1);
      if (!assignee) throw new Error("Select an active engineer/technician account");
    }
    const [updated] = await tx.update(alerts).set({
      assignedToId,
      assignedAt: assignedToId === null ? null : new Date(),
      updatedAt: new Date(),
    }).where(eq(alerts.id, id)).returning();
    return updated;
  }));
}

export async function startAlertDowntime(id: number, actorId: number, isAdmin: boolean) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1).for("update");
    if (!current) return undefined;
    if (current.status === "resolved") throw new Error("Resolved alerts cannot start downtime");
    if (!isAdmin && current.assignedToId !== actorId) throw new Error("Only the assigned technician can record downtime");
    if (current.downtimeStartedAt) return current;
    const [updated] = await tx.update(alerts).set({ downtimeStartedAt: new Date(), updatedAt: new Date() })
      .where(eq(alerts.id, id)).returning();
    return updated;
  }));
}

export async function resolveAlert(id: number, actorId: number, isAdmin: boolean) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1).for("update");
    if (!current) return undefined;
    if (current.status === "resolved") throw new Error("Alert is already resolved");
    if (!isAdmin && current.assignedToId !== actorId) throw new Error("Only the assigned technician can resolve this alert");
    if (!current.assignedToId && !isAdmin) throw new Error("Assign a technician before resolving this alert");
    const resolvedAt = new Date();
    const [updated] = await tx.update(alerts).set({ status: "resolved", resolvedAt, resolvedById: actorId, updatedAt: resolvedAt })
      .where(eq(alerts.id, id)).returning();
    return updated;
  }));
}

export async function acknowledgeAlert(id: number, actorId: number) {
  return withDb(async (db) => db.transaction(async (tx) => {
    const [current] = await tx.select().from(alerts).where(eq(alerts.id, id)).limit(1).for("update");
    if (!current) return undefined;
    if (current.status !== "active") throw new Error("Only active alerts can be acknowledged");
    const [updated] = await tx.update(alerts).set({ status: "acknowledged", acknowledgedBy: actorId, acknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(alerts.id, id)).returning();
    return updated;
  }));
}

/** Keep incident views aligned with the device and asset inventories shown in the UI. */
function visibleAlertEntitiesCondition() {
  const liveDevice = demoDataEnabled()
    ? eq(devices.id, alerts.deviceId)
    : and(eq(devices.id, alerts.deviceId), eq(devices.isDemo, false));
  const liveAsset = demoDataEnabled()
    ? eq(assets.assetId, alerts.assetId)
    : and(eq(assets.assetId, alerts.assetId), eq(assets.isDemo, false));
  return sql`exists (
    select 1 from ${devices}
    where ${liveDevice}
  ) and (
    ${alerts.assetId} is null or exists (
      select 1 from ${assets}
      where ${liveAsset}
    )
  )`;
}

export async function getAlerts(filters?: {
  deviceId?: number;
  status?: Alert["status"];
  severity?: Alert["severity"];
  limit?: number;
  openOnly?: boolean;
  startTime?: number;
  endTime?: number;
}) {
  return withDb(async (db) => {
    let query = db.select({ ...getTableColumns(alerts), assignedToName: users.name })
      .from(alerts).leftJoin(users, eq(alerts.assignedToId, users.id));
    const conditions = [visibleAlertEntitiesCondition()];

    if (filters?.deviceId) conditions.push(eq(alerts.deviceId, filters.deviceId));
    if (filters?.status) conditions.push(eq(alerts.status, filters.status));
    if (filters?.severity) conditions.push(eq(alerts.severity, filters.severity));
    if (filters?.openOnly) conditions.push(inArray(alerts.status, ["active", "acknowledged"]));
    if (filters?.startTime !== undefined) conditions.push(gte(alerts.createdAt, new Date(filters.startTime)));
    if (filters?.endTime !== undefined) conditions.push(lte(alerts.createdAt, new Date(filters.endTime)));

    const finalQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
    return finalQuery.orderBy(desc(alerts.createdAt)).limit(filters?.limit || 100);
  });
}

export async function getAlertById(id: number) {
  return withDb(async (db) => {
    const [alert] = await db.select({ ...getTableColumns(alerts), assignedToName: users.name })
      .from(alerts).leftJoin(users, eq(alerts.assignedToId, users.id))
      .where(and(eq(alerts.id, id), visibleAlertEntitiesCondition()));
    return alert;
  });
}

export async function updateAlert(id: number, data: Partial<InsertAlert>): Promise<Alert | undefined> {
  return withDb(async (db) => {
    await db.update(alerts).set({ ...data, updatedAt: new Date() }).where(eq(alerts.id, id));
    const result = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
    return result[0];
  });
}

export async function getAlertStats(deviceIds?: number[]) {
  return withDb(async (db) => {
    const [stats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${alerts.status} = 'active')::int`,
      open: sql<number>`count(*) filter (where ${alerts.status} <> 'resolved')::int`,
      acknowledged: sql<number>`count(*) filter (where ${alerts.status} = 'acknowledged')::int`,
      resolved: sql<number>`count(*) filter (where ${alerts.status} = 'resolved')::int`,
      critical: sql<number>`count(*) filter (where ${alerts.severity} = 'critical' and ${alerts.status} <> 'resolved')::int`,
      warning: sql<number>`count(*) filter (where ${alerts.severity} = 'warning' and ${alerts.status} <> 'resolved')::int`,
      info: sql<number>`count(*) filter (where ${alerts.severity} = 'info' and ${alerts.status} <> 'resolved')::int`,
      activeDowntime: sql<number>`count(*) filter (where ${alerts.downtimeStartedAt} is not null and ${alerts.status} <> 'resolved')::int`,
      longestActiveDowntimeSeconds: sql<number | null>`max(floor(extract(epoch from (now() - ${alerts.downtimeStartedAt})))::int) filter (where ${alerts.downtimeStartedAt} is not null and ${alerts.status} <> 'resolved')`,
      averageDowntimeToResolutionSeconds: sql<number | null>`(avg(floor(extract(epoch from (${alerts.resolvedAt} - ${alerts.downtimeStartedAt})))) filter (where ${alerts.downtimeStartedAt} is not null and ${alerts.resolvedAt} is not null))::int`,
      resolvedDowntimeCount: sql<number>`count(*) filter (where ${alerts.downtimeStartedAt} is not null and ${alerts.resolvedAt} is not null)::int`,
    }).from(alerts).where(and(
      visibleAlertEntitiesCondition(),
      deviceIds === undefined ? undefined : deviceIds.length > 0 ? inArray(alerts.deviceId, deviceIds) : sql`false`,
    ));
    return stats;
  });
}

// ============ Firmware & OTA Functions ============
export async function createFirmwareVersion(fw: InsertFirmwareVersion): Promise<FirmwareVersion> {
  return withDb(async (db) => {
    await db.insert(firmwareVersions).values(fw);
    const result = await db.select().from(firmwareVersions).where(eq(firmwareVersions.version, fw.version)).limit(1);
    return result[0];
  });
}

export async function getFirmwareVersions(deviceType?: Device["type"]) {
  return withDb(async (db) => {
    let query = db.select().from(firmwareVersions);
    if (deviceType) query = query.where(eq(firmwareVersions.deviceType, deviceType)) as typeof query;
    return query.orderBy(desc(firmwareVersions.createdAt));
  });
}

export async function createOtaDeployment(deployment: InsertOtaDeployment): Promise<OtaDeployment> {
  return withDb(async (db) => {
    const [created] = await db.insert(otaDeployments).values(deployment).returning();
    return created;
  });
}

export async function getOtaDeployments(filters?: { deviceId?: number; limit?: number }) {
  return withDb(async (db) => {
    let query = db.select().from(otaDeployments);
    if (filters?.deviceId) query = query.where(eq(otaDeployments.deviceId, filters.deviceId)) as typeof query;
    return query.orderBy(desc(otaDeployments.createdAt)).limit(filters?.limit || 50);
  });
}

export async function updateOtaDeployment(id: number, data: Partial<InsertOtaDeployment>): Promise<OtaDeployment | undefined> {
  return withDb(async (db) => {
    await db.update(otaDeployments).set({ ...data, updatedAt: new Date() }).where(eq(otaDeployments.id, id));
    const result = await db.select().from(otaDeployments).where(eq(otaDeployments.id, id)).limit(1);
    return result[0];
  });
}
