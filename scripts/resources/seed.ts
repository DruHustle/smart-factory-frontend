/** Explicit synthetic operational-state fixtures, restricted to disposable local storage. */
import { sql } from "drizzle-orm";
import {
  getDb,
  closeDatabase,
  ingestTelemetryByDeviceId,
} from "../../server/db";
import { registerDevice } from "../../server/deviceRegistration";
import { buildAasDocuments } from "../../server/aasModel";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error("Only disposable local resource fixtures allowed");
const db = (await getDb())!;
for (const state of ["active", "stale", "disconnected"]) {
  const name = `Synthetic resource arm ${state}`,
    assetId = `urn:resource:arm:${state}`,
    deviceId = `resource-gateway-${state}`;
  const device = await registerDevice({
    deviceId,
    name: `Synthetic ${state} gateway`,
    type: "gateway",
    route: "direct",
    freshnessSeconds: 120,
  });
  const identity = {
    assetId,
    name,
    assetType: "robotic_arm",
    manufacturer: "Synthetic",
    model: "Software fixture",
    manufacturerStreet: "Test 1",
    manufacturerZipcode: "00000",
    manufacturerCityTown: "Simulation",
    manufacturerNationalCode: "DE",
    manufacturerArticleNumber: "SIM",
    orderCodeOfManufacturer: "SIM",
  };
  const aas = buildAasDocuments(identity);
  const [asset] = await db.execute(
    sql`insert into assets("assetId",name,"assetType","aasShell","aasSubmodels") values(${assetId},${name},'robotic_arm',${JSON.stringify(aas.shell)}::json,${JSON.stringify(aas.submodels)}::json) returning id`,
  );
  await db.execute(
    sql`insert into asset_devices("assetId","deviceId",protocol,endpoint) values(${asset.id},${device.id},'ada031_v4_serial','serial:///synthetic/no-hardware')`,
  );
  await ingestTelemetryByDeviceId({
    deviceId,
    gatewayId: deviceId,
    assetId,
    timestamp: Date.now() - (state === "stale" ? 3600000 : 100),
    assetSignals: {
      successful_cycles: 2,
      interrupted_cycles: 0,
      failed_cycles: 0,
      cycle_count: 2,
      active_profile: 0,
    },
    integration: {
      mode: "live",
      sourceQuality: "good",
      sourceConnection: state === "disconnected" ? "offline" : "online",
      gatewayReceivedAt: new Date().toISOString(),
    },
  });
}
await closeDatabase();
console.log(
  "Synthetic resource fixtures ready; no hardware interface was invoked.",
);
