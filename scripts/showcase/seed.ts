import { closeDatabase } from "../../server/db";
import { seedCompleteShowcase } from "./complete";
import { seedBasicShowcase } from "./basic";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.SHOWCASE_SEED !== "true" ||
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error(
    "Showcase seeding requires SHOWCASE_SEED=true and an explicit disposable local _e2e database",
  );
try {
  await (process.env.SHOWCASE_COMPLETE === "true"
    ? seedCompleteShowcase(true)
    : seedBasicShowcase(true));
} finally {
  await closeDatabase();
}
