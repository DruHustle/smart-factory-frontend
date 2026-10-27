/** Explicit, isolated authored data. Never imported by application startup or page rendering. */
import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import {
  getDb,
  closeDatabase,
  ingestTelemetryByDeviceId,
} from "../../server/db";
import { createEquipment, template } from "../../server/equipment/local";
import { seedDemonstration } from "../../server/security/demo";
import { initialize } from "../../server/security/store";
import { assets, devices, alerts, systemSettings } from "../../drizzle/schema";
import { buildAasDocuments } from "../../server/aasModel";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.SHOWCASE_SEED !== "true" ||
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error(
    "Showcase seeding requires SHOWCASE_SEED=true and an explicit disposable local _e2e database",
  );
const uuid = (name: string) => {
  const h = createHash("sha256")
    .update("smart-factory-showcase-v1:" + name)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const db = (await getDb())!,
  key = "showcase_v1",
  [existing] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key));
if (existing) {
  console.log(
    "Isolated authored showcase already exists; retained its original time and evidence.",
  );
  await closeDatabase();
  process.exit(0);
}
const anchor = process.env.SHOWCASE_ANCHOR
  ? Date.parse(process.env.SHOWCASE_ANCHOR)
  : Date.now();
if (!Number.isFinite(anchor) || anchor > Date.now() + 300000)
  throw Error("Provide a valid present or historical showcase anchor");
const equipmentId = uuid("pump"),
  externalAssetId = "urn:smart-factory:showcase:pump-01",
  runId = uuid("observations"),
  t = await template();
const conflicts = await db.execute(
  sql`select 1 from assets where "assetId"=${externalAssetId} union all select 1 from devices where "deviceId" in('smart-factory-public-simulator','showcase.temp:01','showcase-disconnected') limit 1`,
);
if (conflicts.length)
  throw Error(
    "Showcase identity collision; review existing data without changing it",
  );
await createEquipment(
  {
    name: "Showcase pump 01",
    serialNumber: "SIM-PUMP-01",
    kind: "simulated",
    templateRevision: t.revision,
  },
  0,
  {
    id: equipmentId,
    assetId: externalAssetId,
    components: t.components.map((c) => uuid(c.templateComponentId)),
    isDemo: true,
  },
);
const [asset] = await db
  .select()
  .from(assets)
  .where(eq(assets.assetId, externalAssetId));
const identity = {
  assetId: externalAssetId,
  name: "Showcase pump 01",
  assetType: "pump",
  manufacturer: "Synthetic example manufacturer",
  model: "Illustrative pump/motor",
  manufacturerStreet: "Example 1",
  manufacturerZipcode: "00000",
  manufacturerCityTown: "Simulation",
  manufacturerNationalCode: "DE",
  manufacturerArticleNumber: "SIM-01",
  orderCodeOfManufacturer: "SIM-01",
};
const aas = buildAasDocuments(identity);
await db
  .update(assets)
  .set({
    aasShell: aas.shell,
    aasSubmodels: aas.submodels,
    location: "Simulation line A",
    zone: "Showcase",
  })
  .where(eq(assets.id, asset.id));
await db.execute(
  sql`update equipment_workspaces set is_standalone=false where id=${equipmentId} and is_demo=true`,
);
await db.execute(
  sql`insert into equipment_scenario_runs(id,equipment_id,scenario,started_at) values(${runId},${equipmentId},'alarm',${new Date(anchor - 3600000).toISOString()}::timestamptz)`,
);
const [gateway] = await db
  .select()
  .from(devices)
  .where(eq(devices.deviceId, "smart-factory-public-simulator"));
await db
  .update(devices)
  .set({
    name: "Showcase gateway 01",
    location: "Simulation cabinet A",
    zone: "Showcase",
  })
  .where(eq(devices.id, gateway.id));
const policy = {
  route: "gateway",
  gatewayId: gateway.deviceId,
  revision: 1,
  maxLatenessSeconds: 120,
  clockSkewSeconds: 30,
  freshnessSeconds: 60,
  legacyCurrent: false,
  legacyUnits: {},
  reviewedAt: new Date(anchor).toISOString(),
  reviewedBy: 0,
};
const [sensor] = await db
  .insert(devices)
  .values({
    deviceId: "showcase.temp:01",
    name: "Showcase temperature sensor",
    type: "sensor",
    isDemo: true,
    location: "Simulation line A",
    zone: "Showcase",
    metadata: {
      commissioning: policy,
      connectionMode: "gateway",
      gatewayId: gateway.deviceId,
      showcaseVersion: 1,
    },
  })
  .returning();
await db.insert(devices).values({
  deviceId: "showcase-disconnected",
  name: "Commissioning example · disconnected",
  type: "controller",
  isDemo: true,
  zone: "Showcase",
  metadata: { connectionMode: "unconfigured", showcaseVersion: 1 },
});
let lastReading = 0;
for (let n = 0; n <= 60; n++) {
  if (n >= 24 && n <= 29) continue;
  const at = anchor - 3600000 + n * 60000,
    temperature = n === 60 ? 82 : 29 + n * 0.08 + Math.sin(n / 4) * 0.7;
  await ingestTelemetryByDeviceId({
    deviceId: gateway.deviceId,
    gatewayId: gateway.deviceId,
    assetId: externalAssetId,
    timestamp: at,
    temperature,
    pressure: 2.1,
    rpm: 1450,
    vibration: 1.2,
    units: {
      temperature: "Cel",
      pressure: "bar",
      rpm: "rpm",
      vibration: "mm/s",
    },
    integration: {
      mode: "simulated",
      scenarioRunId: runId,
      sessionId: runId,
      sequence: n,
      sourceQuality: "good",
      sourceConnection: "online",
      gatewayReceivedAt: new Date(anchor).toISOString(),
    },
  });
}
await ingestTelemetryByDeviceId({
  deviceId: sensor.deviceId,
  gatewayId: gateway.deviceId,
  timestamp: anchor - 240000,
  temperature: 22.7,
  units: { temperature: "Cel" },
  integration: {
    mode: "simulated",
    scenarioRunId: runId,
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: new Date(anchor).toISOString(),
  },
});
const [reading] = await db.execute(
  sql`select id,measurements from sensor_readings where "assetId"=${externalAssetId} order by timestamp desc limit 1`,
);
lastReading = Number(reading.id);
const evidence = {
  readingId: lastReading,
  occurredAt: anchor,
  receivedAt: new Date(anchor).toISOString(),
  sourceDeviceId: gateway.deviceId,
  gatewayId: gateway.deviceId,
  mode: "simulated",
  quality: "good",
  metric: "temperature",
  value: 82,
  threshold: 80,
  unit: "°C",
  measurement: (reading.measurements as any).temperature,
};
const [incident] = await db
  .insert(alerts)
  .values({
    deviceId: gateway.id,
    assetId: externalAssetId,
    type: "threshold_exceeded",
    severity: "warning",
    metric: "temperature",
    value: 82,
    threshold: 80,
    message: "Simulated temperature above reviewed example threshold",
    errorCode: "SF-THR-TEMP-WARN",
    createdAt: new Date(anchor - 120000),
    lastObservedAt: new Date(anchor),
    evidenceSnapshot: evidence,
    latestEvidenceSnapshot: evidence,
    occurrences: 2,
  })
  .returning();
await db.execute(
  sql`insert into incident_activity(alert_id,kind,detail,created_at) values(${incident.id},'note',${JSON.stringify({ text: "Authored simulation: evidence reviewed; this walkthrough does not establish a physical cause or equipment state." })}::jsonb,${new Date(anchor - 60000).toISOString()}::timestamptz)`,
);
await initialize();
const security = await seedDemonstration(null);
await db.insert(systemSettings).values({
  key,
  value: {
    version: 1,
    anchor: new Date(anchor).toISOString(),
    from: new Date(anchor - 3600000).toISOString(),
    equipmentId,
    assetRef: `asset:${asset.id}`,
    assetId: externalAssetId,
    sensorRef: `device:${sensor.id}`,
    gatewayRef: `device:${gateway.id}`,
    incidentId: incident.id,
    securitySourceId: security.sourceId,
    label: "Isolated authored simulation; no physical equipment connection",
  },
});
await db
  .insert(systemSettings)
  .values({ key: "demo_data_enabled", value: true })
  .onConflictDoUpdate({ target: systemSettings.key, set: { value: true } });
console.log(
  "Isolated read-only showcase ready: AAS, device, gateway, native 3D, gapped measurements, process incident and security investigation.",
);
await closeDatabase();
