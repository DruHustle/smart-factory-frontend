import "dotenv/config";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import {
  database,
  saveRegistration,
  saveMapping,
} from "../../server/onesa/store";
import { registrationSchema, mappingSchema } from "../../server/onesa/contract";
import { createUser, getUserByEmail, closeDatabase } from "../../server/db";
import { sdk } from "../../server/_core/sdk";
if (
  process.env.NODE_ENV === "production" ||
  !process.env.DATABASE_URL?.includes("127.0.0.1:55432/smart_factory_e2e")
)
  throw new Error(
    "Fixture seeding is restricted to the documented isolated local database",
  );
const regs = JSON.parse(
  await readFile("fixtures/equipment/equipment.json", "utf8"),
).map((r: unknown) => registrationSchema.parse(r));
const maps = JSON.parse(
  await readFile("fixtures/equipment/mappings.json", "utf8"),
).map((r: unknown) => mappingSchema.parse(r));
const db = await database();
const email = "onesa-fixture@example.test";
let user = await getUserByEmail(email);
if (!user)
  user = await createUser({
    email,
    openId: "onesa-private-fixture",
    name: "Onesa Fixture Engineer",
    role: "admin",
    password: await sdk.hashPassword(
      process.env.ONESA_FIXTURE_PASSWORD ?? "Synthetic-fixture-only-2026!",
    ),
  });
const [gateway] = await db
  .insert((await import("../../drizzle/schema")).devices)
  .values({
    deviceId: regs[0].deviceId,
    name: "Simulated Onesa scenario gateway",
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
  .onConflictDoUpdate({
    target: (await import("../../drizzle/schema")).devices.deviceId,
    set: { name: "Simulated Onesa scenario gateway" },
  })
  .returning();
for (let i = 0; i < regs.length; i++) {
  const r = regs[i];
  const [asset] = await db
    .insert((await import("../../drizzle/schema")).assets)
    .values({
      assetId: r.externalAssetId,
      name: r.name,
      assetType: "pump",
      serialNumber: r.serialNumber,
      aasShell: {},
      isDemo: false,
    })
    .onConflictDoUpdate({
      target: (await import("../../drizzle/schema")).assets.assetId,
      set: { name: r.name },
    })
    .returning();
  await db.execute(
    sql`insert into asset_devices ("assetId","deviceId",protocol) select ${asset.id},${gateway.id},'mqtt' where not exists (select 1 from asset_devices where "assetId"=${asset.id} and "deviceId"=${gateway.id})`,
  );
  const existing = await db.execute(
    sql`select equipment_id from onesa_equipment where equipment_id=${r.equipmentId}`,
  );
  if (!existing.length) {
    await saveRegistration(r, 0, user!.id);
    await saveMapping(maps[i], user!.id);
  }
}
console.log(
  "Seeded isolated individual engineering account and two simulated source registrations; no Onesa registration performed.",
);
await closeDatabase();
