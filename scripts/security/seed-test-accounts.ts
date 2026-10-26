import { randomUUID } from "node:crypto";
import { getUserByEmail, createUser, closeDatabase } from "../../server/db";
import { sdk } from "../../server/_core/sdk";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw new Error("Security fixtures require a disposable local _e2e database");
for (const role of ["admin", "engineer", "operator", "viewer"] as const) {
  const email = `security-${role}@example.test`;
  if (!(await getUserByEmail(email)))
    await createUser({
      email,
      openId: randomUUID(),
      name: `Local security ${role}`,
      role,
      password: await sdk.hashPassword("Synthetic-security-only-2026!"),
    });
}
console.log("Individual security fixture accounts ready");
await closeDatabase();
