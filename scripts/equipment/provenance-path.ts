/** Fixture-only setup/assertions for actual edge -> MQTT -> .NET -> Node. */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, closeDatabase } from "../../server/db";
import { devices, assets, assetDevices } from "../../drizzle/schema";
if (
  process.env.NODE_ENV === "production" ||
  !process.env.DATABASE_URL?.includes("127.0.0.1:55432/smart_factory_e2e")
)
  throw Error("Only disposable provenance-path database allowed");
const db = (await getDb())!;
if (process.argv[2] === "seed") {
  const [gateway] = await db
    .insert(devices)
    .values({
      deviceId: "onesa-demo-gateway",
      name: "Smart Factory simulated/replay proof",
      type: "gateway",
      status: "offline",
      metadata: {
        commissioning: {
          route: "direct",
          revision: 1,
          maxLatenessSeconds: 120,
          clockSkewSeconds: 30,
          legacyCurrent: false,
          legacyUnits: {},
        },
      },
      isDemo: false,
    })
    .returning();
  const registrations = JSON.parse(
    readFileSync("fixtures/equipment/equipment.json", "utf8"),
  );
  for (const r of registrations) {
    const [asset] = await db
      .insert(assets)
      .values({
        assetId: r.externalAssetId,
        name: r.name,
        assetType: "pump",
        serialNumber: r.serialNumber,
        aasShell: {},
        isDemo: false,
      })
      .returning();
    await db
      .insert(assetDevices)
      .values({ assetId: asset.id, deviceId: gateway.id, protocol: "mqtt" });
  }
} else {
  const rows = await db.execute(
    sql`select integration->>'mode' as mode,count(*)::int as count, count(distinct "assetId")::int as assets,bool_and(integration->>'gatewayReceivedAt' ~ 'Z$') as canonical from sensor_readings where integration->>'sessionId' in ('v4-simulated-path','v4-replay-path') group by integration->>'mode' order by mode`,
  );
  if (process.argv[2] === "outage") {
    if (rows.length) throw Error("Unexpected receiver data during outage");
    console.log(JSON.stringify({ receiverRows: 0, phase: "outage" }));
  } else {
    if (
      rows.length !== 2 ||
      rows.some((r: any) => r.count !== 10 || r.assets !== 2 || !r.canonical)
    )
      throw Error(
        "Smart Factory ingestion path mismatch: " + JSON.stringify(rows),
      );
    console.log(
      JSON.stringify({
        verification:
          "actual Smart Factory edge durable publisher / Mosquitto / .NET 10 / authenticated Node; optional peer export disabled",
        sourceModes: rows,
        sourceSamples: 20,
        physicalEquipment: false,
      }),
    );
  }
}
await closeDatabase();
