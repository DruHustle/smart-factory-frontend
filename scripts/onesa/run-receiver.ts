import "dotenv/config";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createReceiver } from "./receiver";
import { mappingSchema } from "../../server/onesa/contract";
if (
  !process.env.ONESA_RECEIVER_DATABASE_URL ||
  !process.env.ONESA_SERVICE_TOKEN ||
  !process.env.ONESA_WORKSPACE_ID ||
  !process.env.ONESA_INSTALLATION_ID
)
  throw new Error("Set isolated receiver database and explicit fixture scope");
const client = postgres(process.env.ONESA_RECEIVER_DATABASE_URL, { max: 2 });
const mappings = JSON.parse(
  await readFile("fixtures/equipment/mappings.json", "utf8"),
).map((m: unknown) => mappingSchema.parse(m));
const app = await createReceiver(drizzle(client), {
  token: process.env.ONESA_SERVICE_TOKEN,
  workspaceId: process.env.ONESA_WORKSPACE_ID,
  installationId: process.env.ONESA_INSTALLATION_ID,
  mappings,
});
app.listen(18640, "127.0.0.1", () =>
  console.log("PROPOSED contract-test receiver on loopback :18640; not Onesa"),
);
