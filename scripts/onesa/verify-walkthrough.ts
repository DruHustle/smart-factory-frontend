import "dotenv/config";
import { sql } from "drizzle-orm";
import { rows, database, status } from "../../server/onesa/store";
import { closeDatabase } from "../../server/db";
if (
  process.env.NODE_ENV === "production" ||
  !process.env.DATABASE_URL?.includes("127.0.0.1:55432/smart_factory_iot_e2e")
)
  throw new Error("Only the isolated walkthrough database is allowed");
const db = await database();
const deadline = Date.now() + 30000;
let history: Record<string, unknown>[] = [];
do {
  history = await rows(
    db,
    sql`select payload from proposed_receiver_history where payload->>'scenarioRunId'='deterministic-pump-v1'`,
  );
  if (history.length >= 38) break;
  await new Promise((r) => setTimeout(r, 250));
} while (Date.now() < deadline);
const source = await rows(
  db,
  sql`select count(*) as n from sensor_readings where integration->>'scenarioRunId'='deterministic-pump-v1'`,
);
if (Number(source[0].n) !== 10 || history.length !== 38)
  throw new Error(
    `Expected 10 source samples / 38 acknowledged events; received ${source[0].n} / ${history.length}`,
  );
const events = history.map((r) => r.payload as any);
if (events.some((e) => e.mode !== "simulated"))
  throw new Error("Simulator misclassified");
const equipment = new Set(events.map((e) => e.equipmentId)),
  components = new Set(events.map((e) => e.componentId));
if (equipment.size !== 2 || components.size !== 6)
  throw new Error("Instance/component routing mismatch");
const s = await status();
if (!s.lastAcknowledgment || s.backlog !== 0)
  throw new Error("Consumer acknowledgment missing or delivery pending");
console.log(
  JSON.stringify(
    {
      verification: "protocol and proposed contract; NOT Onesa twin acceptance",
      protocol: "MQTT via existing edge relay and .NET 10 subscriber",
      sourceSamples: Number(source[0].n),
      persistedReceiverEvents: history.length,
      equipmentInstances: equipment.size,
      mappedComponents: components.size,
      sourceAlarms: events.filter((e) => e.kind === "source_alarm").length,
      connectionEvents: events.filter((e) => e.kind === "source_connection")
        .length,
      mode: "simulated",
      lastAcknowledgment: s.lastAcknowledgment,
      backlog: s.backlog,
    },
    null,
    2,
  ),
);
await closeDatabase();
