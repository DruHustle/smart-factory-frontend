/** Explicit legacy read-only examples and operational fixtures in owned local storage. */
import { sql } from "drizzle-orm";
import { initializeDemoScenario, getDb, closeDatabase } from "../server/db";
import { registerDevice } from "../server/deviceRegistration";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error("Only disposable local _e2e storage may seed browser fixtures");
await initializeDemoScenario({ allowAlongsideLive: true });
const source = await registerDevice({
  deviceId: "e2e-incident-source",
  name: "E2E incident source",
  type: "sensor",
  route: "direct",
  freshnessSeconds: 120,
});
const db = (await getDb())!;
for (const message of [
  "E2E service review due",
  "E2E viewer investigation",
  "E2E operator acknowledgement",
]) {
  await db.execute(
    sql`insert into alerts("deviceId",type,severity,message,"errorCode") values(${source.id},'system_error','warning',${message},'SF-E2E-REVIEW')`,
  );
}
await closeDatabase();
