import { customType, uuid, bigint, boolean, index, integer, json, jsonb, pgEnum, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// `user` remains temporarily for rows created by older releases. Authorization
// treats it as the viewer role until those accounts are explicitly upgraded.
export const roleEnum = pgEnum("role", ["user", "viewer", "operator", "engineer", "admin"]);
export const deviceTypeEnum = pgEnum("device_type", ["sensor", "actuator", "controller", "gateway", "edge_device"]);
export const deviceStatusEnum = pgEnum("device_status", ["online", "offline", "maintenance", "error"]);
export const assetLifecycleStageEnum = pgEnum("asset_lifecycle_stage", ["planned", "engineered", "commissioned", "operational", "maintenance", "decommissioned"]);
export const metricEnum = pgEnum("metric", ["temperature", "humidity", "vibration", "power", "pressure", "rpm"]);
export const alertTypeEnum = pgEnum("alert_type", ["threshold_exceeded", "device_offline", "firmware_update", "maintenance_required", "system_error"]);
export const alertSeverityEnum = pgEnum("alert_severity", ["info", "warning", "critical"]);
export const alertStatusEnum = pgEnum("alert_status", ["active", "acknowledged", "resolved"]);
export const otaStatusEnum = pgEnum("ota_status", ["pending", "downloading", "installing", "completed", "failed", "rolled_back"]);

/**
 * Core user table backing auth flow.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  password: text("password"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  authVersion: integer("auth_version").default(0).notNull(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  passwordChangeRequired: boolean("password_change_required").default(false).notNull(),
  temporaryCredentialExpiresAt: timestamp("temporary_credential_expires_at", { withTimezone: true }),
  temporaryCredentialUsedAt: timestamp("temporary_credential_used_at", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("users_email_identity_unique").on(sql`lower(${table.email})`)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Only hashes are persisted; logout/expiry never leaves reusable bearer tokens. */
export const sessionRevocations = pgTable("session_revocations", {
  sessionHash: varchar("session_hash", { length: 64 }).primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("session_revocations_expiry").on(table.expiresAt)]);

/** Deployment-wide feature switches edited by authorized administrators. */
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").$type<boolean | string | number | null>().notNull(),
  updatedBy: integer("updatedBy"),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Devices table - represents IoT edge devices in the factory
 */
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceId: varchar("deviceId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: deviceTypeEnum("type").notNull(),
  status: deviceStatusEnum("status").default("offline").notNull(),
  location: varchar("location", { length: 255 }),
  zone: varchar("zone", { length: 100 }),
  firmwareVersion: varchar("firmwareVersion", { length: 50 }),
  lastSeen: timestamp("lastSeen", { withTimezone: true }),
  isDemo: boolean("isDemo").default(false).notNull(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type Device = typeof devices.$inferSelect;
export type InsertDevice = typeof devices.$inferInsert;

/** Industrial equipment record. Connectivity devices remain in `devices`. */
export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  assetId: varchar("assetId", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  assetType: varchar("assetType", { length: 100 }).notNull(),
  manufacturer: varchar("manufacturer", { length: 255 }),
  model: varchar("model", { length: 255 }),
  manufacturerStreet: varchar("manufacturerStreet", { length: 255 }),
  manufacturerZipcode: varchar("manufacturerZipcode", { length: 32 }),
  manufacturerCityTown: varchar("manufacturerCityTown", { length: 255 }),
  manufacturerNationalCode: varchar("manufacturerNationalCode", { length: 2 }),
  manufacturerArticleNumber: varchar("manufacturerArticleNumber", { length: 128 }),
  orderCodeOfManufacturer: varchar("orderCodeOfManufacturer", { length: 128 }),
  ratedValue: varchar("ratedValue", { length: 80 }),
  ratedUnit: varchar("ratedUnit", { length: 32 }),
  serialNumber: varchar("serialNumber", { length: 128 }),
  location: varchar("location", { length: 255 }),
  zone: varchar("zone", { length: 100 }),
  lifecycleStage: assetLifecycleStageEnum("lifecycleStage").default("planned").notNull(),
  aasShell: json("aasShell").$type<Record<string, unknown>>().notNull(),
  aasSubmodels: json("aasSubmodels").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  aasConceptDescriptions: json("aasConceptDescriptions").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  aasxImported: boolean("aasxImported").default(false).notNull(),
  aasxPackageId: varchar("aasxPackageId", { length: 128 }),
  /** Monotonic application revision for optimistic updates and history. */
  aasVersion: integer("aasVersion").default(1).notNull(),
  isDemo: boolean("isDemo").default(false).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

/** Append-only snapshots preserve each AAS state before later edits. */
export const assetVersions = pgTable("asset_versions", {
  id: serial("id").primaryKey(),
  assetId: integer("assetId").notNull(),
  version: integer("version").notNull(),
  changeType: varchar("changeType", { length: 32 }).notNull(),
  changeNote: text("changeNote"),
  changedBy: integer("changedBy").notNull(),
  snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(),
  sha256: varchar("sha256", { length: 64 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("asset_versions_asset_version_unique").on(table.assetId, table.version),
]);

export type AssetVersion = typeof assetVersions.$inferSelect;

/** Shared fixed-window counters so login throttling is consistent across replicas. */
export const loginRateLimits = pgTable("login_rate_limits", {
  keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (table) => [index("login_rate_limits_reset_at_idx").on(table.resetAt)]);

/** A machine may have multiple gateways/sensors connected to it. */
export const assetDevices = pgTable("asset_devices", {
  id: serial("id").primaryKey(),
  assetId: integer("assetId").notNull(),
  deviceId: integer("deviceId").notNull(),
  protocol: varchar("protocol", { length: 32 }).default("mqtt").notNull(),
  endpoint: varchar("endpoint", { length: 512 }),
  tagMappings: json("tagMappings").$type<Array<Record<string, unknown>>>().default([]).notNull(),
  lastSeen: timestamp("lastSeen", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const assetLifecycleEvents = pgTable("asset_lifecycle_events", {
  id: serial("id").primaryKey(),
  assetId: integer("assetId").notNull(),
  fromStage: assetLifecycleStageEnum("fromStage"),
  toStage: assetLifecycleStageEnum("toStage").notNull(),
  changedBy: integer("changedBy").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Sensor readings table - stores time-series sensor data
 */
export const sensorReadings = pgTable("sensor_readings", {
  id: serial("id").primaryKey(),
  deviceId: integer("deviceId").notNull(),
  /** Stable AAS identifier for readings attributed to one industrial asset. */
  assetId: varchar("assetId", { length: 128 }),
  /** Validated device-specific numeric signals such as ADA031 joint targets. */
  assetSignals: jsonb("assetSignals").$type<Record<string, number>>(),
  /** Stable digest supplied by the ingestion service; retries must not inflate analytics. */
  ingestionId: varchar("ingestionId", { length: 64 }),
  integration: jsonb("integration").$type<Record<string, unknown>>(),
  temperature: real("temperature"),
  humidity: real("humidity"),
  vibration: real("vibration"),
  power: real("power"),
  pressure: real("pressure"),
  rpm: real("rpm"),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("sensor_readings_asset_timestamp_idx").on(table.assetId, table.timestamp),
  index("sensor_readings_device_timestamp_idx").on(table.deviceId, table.timestamp),
  uniqueIndex("sensor_readings_ingestion_id_unique").on(table.ingestionId),
]);

export type SensorReading = typeof sensorReadings.$inferSelect;
export type InsertSensorReading = typeof sensorReadings.$inferInsert;

/**
 * Alert thresholds table - custom thresholds per device
 */
export const alertThresholds = pgTable("alert_thresholds", {
  id: serial("id").primaryKey(),
  deviceId: integer("deviceId").notNull(),
  metric: metricEnum("metric").notNull(),
  minValue: real("minValue"),
  maxValue: real("maxValue"),
  warningMin: real("warningMin"),
  warningMax: real("warningMax"),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("alert_thresholds_device_id_idx").on(table.deviceId)]);

export type AlertThreshold = typeof alertThresholds.$inferSelect;
export type InsertAlertThreshold = typeof alertThresholds.$inferInsert;

/**
 * Alerts table - stores triggered alerts
 */
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  deviceId: integer("deviceId").notNull(),
  /** Null means a device/connectivity incident; an AAS id identifies a specific machine. */
  assetId: varchar("assetId", { length: 128 }),
  type: alertTypeEnum("type").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  metric: varchar("metric", { length: 50 }),
  value: real("value"),
  threshold: real("threshold"),
  message: text("message").notNull(),
  /** Stable Smart Factory classification; vendor supplied codes can be recorded when available. */
  errorCode: varchar("errorCode", { length: 64 }).notNull().default("SF-SYS-000"),
  status: alertStatusEnum("status").default("active").notNull(),
  assignedToId: integer("assignedToId").references(() => users.id, { onDelete: "set null" }),
  assignedAt: timestamp("assignedAt", { withTimezone: true }),
  /** Set explicitly when an authorized technician/admin confirms factory downtime. */
  downtimeStartedAt: timestamp("downtimeStartedAt", { withTimezone: true }),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt", { withTimezone: true }),
  resolvedById: integer("resolvedById").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("alerts_status_created_at_idx").on(table.status, table.createdAt),
  index("alerts_assignee_status_idx").on(table.assignedToId, table.status),
]);

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

/** Durable per-user incident inbox and transactional email delivery queue. */
export const notificationInbox = pgTable("notification_inbox", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  alertId: integer("alertId").references(() => alerts.id, { onDelete: "cascade" }),
  securityFindingId: uuid("securityFindingId"),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("readAt", { withTimezone: true }),
  emailStatus: varchar("emailStatus", { length: 32 }).default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }).defaultNow().notNull(),
  lastError: text("lastError"),
  acceptedAt: timestamp("acceptedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("notification_inbox_user_created_idx").on(table.userId, table.createdAt),
  index("notification_inbox_delivery_idx").on(table.emailStatus, table.nextAttemptAt)]);

/**
 * Firmware versions table - available firmware for OTA updates
 */
export const firmwareVersions = pgTable("firmware_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 50 }).notNull().unique(),
  deviceType: deviceTypeEnum("deviceType").notNull(),
  releaseNotes: text("releaseNotes"),
  fileUrl: varchar("fileUrl", { length: 512 }),
  fileSize: integer("fileSize"),
  checksum: varchar("checksum", { length: 128 }),
  isStable: boolean("isStable").default(false).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export type FirmwareVersion = typeof firmwareVersions.$inferSelect;
export type InsertFirmwareVersion = typeof firmwareVersions.$inferInsert;

/**
 * OTA deployments table - tracks firmware deployments to devices
 */
export const otaDeployments = pgTable("ota_deployments", {
  id: serial("id").primaryKey(),
  deviceId: integer("deviceId").notNull(),
  firmwareVersionId: integer("firmwareVersionId").notNull(),
  previousVersion: varchar("previousVersion", { length: 50 }),
  status: otaStatusEnum("status").default("pending").notNull(),
  progress: integer("progress").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt", { withTimezone: true }),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type OtaDeployment = typeof otaDeployments.$inferSelect;
export type InsertOtaDeployment = typeof otaDeployments.$inferInsert;

/** Optional Onesa adapter; credentials remain exclusively in deployment secrets. */
export const onesaInstallation = pgTable("onesa_installation", {
  singleton: boolean("singleton").primaryKey().default(true),
  installationId: uuid("installation_id").notNull(),
  workspaceId: varchar("workspace_id", { length: 128 }).notNull(),
  destinationFingerprint: text("destination_fingerprint").notNull(),
  suspended: boolean("suspended").notNull().default(false),
  lastAck: timestamp("last_ack", { withTimezone: true }),
  lastTransport: timestamp("last_transport", { withTimezone: true }),
  lastError: varchar("last_error", { length: 80 }),
  discarded: bigint("discarded", { mode: "number" }).notNull().default(0),
  captured: bigint("captured", { mode: "number" }).notNull().default(0),
  acknowledged: bigint("acknowledged", { mode: "number" }).notNull().default(0),
  quarantined: bigint("quarantined", { mode: "number" }).notNull().default(0),
});
export const onesaEquipment = pgTable("onesa_equipment", {
  equipmentId: uuid("equipment_id").primaryKey(),
  externalAssetId: varchar("external_asset_id", { length: 128 })
    .unique()
    .notNull(),
  deviceId: varchar("device_id", { length: 128 }).notNull(),
  registration: jsonb("registration").notNull(),
  mapping: jsonb("mapping"),
  version: integer("version").notNull().default(0),
  retired: boolean("retired").notNull().default(false),
  updatedBy: integer("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const onesaOutbox = pgTable(
  "onesa_outbox",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    sourceId: varchar("source_id", { length: 64 }).unique().notNull(),
    equipmentId: uuid("equipment_id"),
    payload: jsonb("payload").notNull(),
    state: varchar("state", { length: 24 }).notNull().default("captured"),
    attempts: integer("attempts").notNull().default(0),
    nextAttempt: timestamp("next_attempt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 80 }),
    receipt: jsonb("receipt"),
    normalized: boolean("normalized").notNull().default(false),
  },
  (t) => [index("onesa_outbox_pending_idx").on(t.state, t.nextAttempt, t.id)],
);
export const onesaAudit = pgTable("onesa_audit", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedByDefaultAsIdentity(),
  actor: integer("actor").notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  equipmentId: uuid("equipment_id"),
  version: integer("version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** App-owned equipment work; no Onesa configuration or account is required. */
export const equipmentWorkspaces = pgTable("equipment_workspaces", {
  isStandalone: boolean("is_standalone").notNull().default(false),
  bindings: jsonb("bindings"),
  sourceDeviceId: varchar("source_device_id", { length: 64 }),
  id: uuid("id").primaryKey(),
  assetId: integer("asset_id").notNull().unique(),
  templateRevision: text("template_revision").notNull(),
  components: jsonb("components").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  selectedComponent: uuid("selected_component"),
  annotations: jsonb("annotations").notNull().default([]),
  viewpoints: jsonb("viewpoints").notNull().default([]),
  version: integer("version").notNull().default(1),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const equipmentScenarioRuns = pgTable("equipment_scenario_runs", {
  id: uuid("id").primaryKey(),
  equipmentId: uuid("equipment_id")
    .notNull()
    .references(() => equipmentWorkspaces.id),
  scenario: varchar("scenario", { length: 16 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});
export const equipmentModelPackages = pgTable("equipment_model_packages", {
  id: text("id").primaryKey(),
  manifest: jsonb("manifest").notNull(),
  glb: bytea("glb").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  bytes: integer("bytes").notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
