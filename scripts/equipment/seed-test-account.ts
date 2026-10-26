import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getUserByEmail, createUser, closeDatabase } from "../../server/db";
import { sdk } from "../../server/_core/sdk";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw new Error(
    "Only an isolated local _e2e database may use this fixture account",
  );
const email = "local-equipment@example.test";
if (!(await getUserByEmail(email)))
  await createUser({
    email,
    openId: randomUUID(),
    name: "Local Equipment Engineer",
    role: "admin",
    password: await sdk.hashPassword("Synthetic-fixture-only-2026!"),
  });
console.log("Individual local equipment fixture account ready");
await closeDatabase();
