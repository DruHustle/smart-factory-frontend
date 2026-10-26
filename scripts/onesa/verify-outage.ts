import { sql } from "drizzle-orm";
import { database, rows, status } from "../../server/onesa/store";
import { closeDatabase } from "../../server/db";
const db = await database();
const runId = process.argv[2] ?? "outage-pump-v1";
const [r] = await rows(
  db,
  sql`select count(*) as n from sensor_readings where integration->>'scenarioRunId'=${runId}`,
);
const s = await status();
if (Number(r.n) !== 10 || !s.backlog || s.state !== "Error")
  throw new Error("Outage capture/error evidence missing");
console.log(
  JSON.stringify(
    {
      scenarioRunId: runId,
      sourceSamplesDuringReceiverOutage: Number(r.n),
      pendingDeliveries: s.backlog,
      status: s.state,
      error: s.error,
      localAcquisition: "continued",
    },
    null,
    2,
  ),
);
await closeDatabase();
