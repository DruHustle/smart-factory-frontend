/** Operator-only demo installer; separate from the disposable test seeder. */
import { sql } from "drizzle-orm";
import { closeDatabase, getDb } from "../../server/db";
import { publicDemoDeployment } from "../../shared/access-policy";
import { planShowcase, seedCompleteShowcase } from "./complete";
const apply = process.argv.includes("--apply");
if (
  !publicDemoDeployment() ||
  process.env.SHOWCASE_INSTALL_APPROVED !== "read-only-showcase-v4"
)
  throw Error(
    "Explicit public-demo deployment and SHOWCASE_INSTALL_APPROVED=read-only-showcase-v4 are required. No records were changed.",
  );
try {
  const plan = await planShowcase();
  if (!apply) {
    console.log(JSON.stringify({ action: "plan", ...plan }));
  } else {
    const db = (await getDb())!;
    const [guard] = await db.execute<{ definition: string }>(
      sql`select pg_get_functiondef('queue_incident_notifications()'::regprocedure) as definition`,
    );
    if (!guard.definition.includes("Authored evidence must never enqueue"))
      throw Error(
        "The demo notification isolation migration must be applied before installation.",
      );
    // A retained claim prevents concurrent/partial retries from silently overwriting evidence.
    const claims = await db.execute(
      sql`insert into system_settings(key,value) values('showcase_install_v4',${JSON.stringify({ state: "installing", startedAt: new Date().toISOString() })}::jsonb) on conflict(key) do nothing returning key`,
    );
    const [retainedClaim] = await db.execute<{ value: { state?: string } }>(
      sql`select value from system_settings where key='showcase_install_v4'`,
    );
    if (
      !claims.length &&
      (plan.installedVersion < 4 || retainedClaim?.value.state !== "complete")
    )
      throw Error(
        "A prior install needs operator review. Retain the original evidence and review its protected backup; do not delete records to retry.",
      );
    const [before] = await db.execute(
      sql`select count(*)::int as n from notification_inbox where "emailStatus" in('pending','processing','retrying')`,
    );
    const result = await seedCompleteShowcase(false);
    const [after] = await db.execute(
      sql`select count(*)::int as n from notification_inbox where "emailStatus" in('pending','processing','retrying')`,
    );
    if (Number(after.n) > Number(before.n))
      throw Error(
        "External delivery queue increased; review before declaring the installation complete.",
      );
    await db.execute(
      sql`update system_settings set value=${JSON.stringify({ state: "complete", version: result.version, anchor: result.anchor })}::jsonb where key='showcase_install_v4'`,
    );
    console.log(
      JSON.stringify({
        action: "installed",
        version: result.version,
        chapters: result.chapters?.length,
        recordedAt: result.anchor,
        externalDeliveryRequests: 0,
        operationalSettingsChanged: false,
      }),
    );
  }
} finally {
  await closeDatabase();
}
