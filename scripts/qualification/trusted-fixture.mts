/** Registration fixtures only. All readings are delivered through the real broker/worker. */
import { sql } from "drizzle-orm";
import { getDb, closeDatabase } from "../../server/db";
import { registerDevice } from "../../server/deviceRegistration";
import { inventoryFilter, listInventory } from "../../server/inventory";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55452" ||
  url.pathname !== "/smart_factory_trusted_e2e"
)
  throw Error("Only owned disposable trusted-path storage allowed");
try {
  const db = (await getDb())!;
  if (process.argv[2] === "seed") {
    const gateway = await registerDevice({
      deviceId: "gateway:01",
      name: "Synthetic qualification gateway",
      type: "gateway",
      route: "direct",
      freshnessSeconds: 120,
    });
    const child = await registerDevice({
      deviceId: "sensor.temp:01",
      name: "Synthetic punctuated source",
      type: "sensor",
      route: "gateway",
      gatewayId: gateway.deviceId,
      freshnessSeconds: 120,
    });
    const legacy = await registerDevice({
      deviceId: "sensor-01",
      name: "Synthetic legacy identity",
      type: "sensor",
      route: "direct",
      freshnessSeconds: 120,
    });
    const [asset] = await db.execute(
      sql`insert into assets("assetId",name,"assetType","aasShell") values('urn:qualification:motor','Synthetic qualification motor','motor','{}'::json) returning id`,
    );
    for (const device of [gateway, child, legacy])
      await db.execute(
        sql`insert into asset_devices("assetId","deviceId",protocol) values(${asset.id},${device.id},'mqtt')`,
      );
    await db.execute(
      sql`insert into alert_thresholds("deviceId",metric,unit,"maxValue",enabled) values(${child.id},'power','W',1000,true)`,
    );
    console.log(
      JSON.stringify({
        registered: [gateway.deviceId, child.deviceId, legacy.deviceId],
        physicalEquipment: false,
      }),
    );
  } else {
    const readings = await db.execute(
      sql`select r."ingestionId",d."deviceId",r.timestamp,r.power,r.temperature,r."createdAt" as "receivedAt",r.integration,r.measurements from sensor_readings r join devices d on d.id=r."deviceId" order by r.timestamp`,
    );
    const incidents = await db.execute(
      sql`select status,occurrences,last_observed_at from alerts`,
    );
    const sources = await db.execute(
      sql`select "deviceId",metadata,"lastSeen" from devices order by "deviceId"`,
    );
    const rejections = await db.execute(
      sql`select reason,sum(occurrences)::int as count from telemetry_rejections group by reason`,
    );
    const liveInventory = await listInventory(
      inventoryFilter.parse({
        view: "all",
        search: "sensor.temp:01",
        zone: "",
        status: "all",
        mode: "live",
        capability: "all",
        sort: "name",
        page: 0,
        pageSize: 25,
      }),
    );
    console.log(
      JSON.stringify({
        readings,
        incidents,
        sources,
        rejections,
        liveInventory: liveInventory.items,
      }),
    );
  }
} finally {
  await closeDatabase();
}
