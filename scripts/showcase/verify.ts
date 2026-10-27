/** Disposable fixture acceptance. This never targets a production database. */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { getDb, closeDatabase } from "../../server/db";
import { planShowcase, seedCompleteShowcase } from "./complete";
import { workspace } from "../../server/equipment/local";
import { withVisibility } from "../../server/demoData";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.SHOWCASE_SEED !== "true" ||
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error("Disposable local fixture verification only");
try {
  const db = (await getDb())!;
  const snapshot = () =>
    db.execute(
      sql`select (select count(*) from sensor_readings)::int as readings,(select count(*) from alerts)::int as incidents,(select count(*) from security_events)::int as events,(select count(*) from notification_inbox)::int as inbox`,
    );
  const before = await snapshot(),
    s = await seedCompleteShowcase(false),
    after = await snapshot();
  assert.deepEqual(
    after,
    before,
    "Installation must retain original evidence and avoid duplicate rows",
  );
  assert.equal(s.chapters?.length, 12);
  const w = await withVisibility({ demoOnly: true, includeDemo: true }, () =>
    workspace(s.equipmentId, "simulated"),
  );
  assert.equal(w.components.length, 87);
  assert.equal(w.viewpoints.length, 2);
  assert.ok(
    w.observations.filter((o) => o.value != null && o.unitVerified).length >= 4,
  );
  const [modes] = await db.execute<{ count: number }>(
    sql`select count(distinct integration->>'mode')::int as count from sensor_readings r join devices d on d.id=r."deviceId" where d."deviceId" like 'showcase.%'`,
  );
  assert.equal(modes.count, 2);
  const states = await db.execute<{ status: string }>(
    sql`select distinct a.status::text as status from alerts a join devices d on d.id=a."deviceId" where d."isDemo"=true`,
  );
  for (const state of ["active", "acknowledged", "resolved"])
    assert.ok(states.some((s) => s.status === state));
  const queued = await db.execute(
    sql`select n.id from notification_inbox n join alerts a on a.id=n."alertId" join devices d on d.id=a."deviceId" where d."isDemo"=true and n."emailStatus" in('pending','processing','retrying')`,
  );
  assert.equal(
    queued.length,
    0,
    "Demo incidents must never enter the delivery queue",
  );
  const current = await db.execute(
    sql`select id from devices where ("deviceId" like 'showcase.%' or "deviceId"='smart-factory-public-simulator') and "lastSeen" is not null`,
  );
  assert.equal(
    current.length,
    0,
    "Simulation must not assert current connectivity",
  );
  const [finding] = await db.execute(
    sql`select installed_component_id,target from security_findings where id=${s.securityFindingId}`,
  );
  assert.ok(finding.installed_component_id);
  assert.equal((finding.target as any).kind, "asset");
  // A colliding operational identity must be refused before fixture authoring.
  const [collision] = await db.execute<{ id: number }>(
    sql`insert into assets("assetId",name,"assetType","aasShell","isDemo") values('urn:smart-factory:showcase:collision-test','Private collision sentinel','other','{}'::jsonb,false) returning id`,
  );
  try {
    await assert.rejects(() => planShowcase(), /collides with non-demo/);
  } finally {
    await db.execute(
      sql`delete from assets where id=${collision.id} and "assetId"='urn:smart-factory:showcase:collision-test' and name='Private collision sentinel'`,
    );
  }
  // Even an owner-linked, demo-labelled notification must not reveal a private source.
  const [privateDevice] = await db.execute<{ id: number }>(
    sql`select id from devices where "isDemo"=false order by id limit 1`,
  );
  const [demoOwner] = await db.execute<{ id: number }>(
    sql`select id from users where email='demo@dev.local'`,
  );
  if (privateDevice && demoOwner) {
    const [incident] = await db.execute<{ id: number }>(
      sql`insert into alerts("deviceId",type,severity,message,"errorCode") values(${privateDevice.id},'system_error','info','Private isolation sentinel','SF-SYS-000') returning id`,
    );
    await db.execute(
      sql`insert into notification_inbox("alertId","userId",kind,title,body,"emailStatus") values(${incident.id},${demoOwner.id},'isolation_fixture','Private isolation sentinel','Private evidence must remain hidden','demo_only')`,
    );
  }
  console.log(
    "Complete showcase verified: idempotence, 12 chapters, 87 components, bound measurements, histories, mapped evidence, no email queue or live connectivity claim.",
  );
} finally {
  await closeDatabase();
}
