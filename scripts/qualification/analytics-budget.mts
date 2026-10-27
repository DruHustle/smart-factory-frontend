/** Measured disposable large-history acceptance; no factory data or live services. */
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
const base = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(base.hostname) ||
  base.port !== "55451" ||
  !base.pathname.endsWith("_e2e")
)
  throw Error("Only the owned disposable performance PostgreSQL is allowed");
const name = `analytics_${Date.now()}_e2e`,
  admin = postgres(base.href, { max: 1, ssl: false });
await admin.unsafe(`create database "${name}"`);
const target = new URL(base);
target.pathname = "/" + name;
process.env.DATABASE_URL = target.href;
process.env.DATABASE_SSL_MODE = "disable";
process.env.ENABLE_DEMO_DATA = "false";
let close: (() => Promise<void>) | undefined;
try {
  const { getDb, closeDatabase } = await import("../../server/db");
  close = closeDatabase;
  const db = (await getDb())!;
  await migrate(db, { migrationsFolder: "drizzle" });
  const client = (db as any).$client as ReturnType<typeof postgres>;
  const start = Date.now() - 86400000,
    end = Date.now();
  await client`insert into devices("deviceId",name,type) values('budget-source','Synthetic budget source','sensor')`;
  await client`insert into assets("assetId",name,"assetType","aasShell") values('urn:budget:asset','Synthetic budget asset','motor','{}'::json)`;
  await client.unsafe(
    `insert into sensor_readings("deviceId","assetId",timestamp,temperature,integration,measurements) select 1,'urn:budget:asset',$1::bigint+n*250,20+(n%100)::double precision/10,jsonb_build_object('mode',case when n%10<8 then 'live' when n%10=8 then 'simulated' else 'replay' end),jsonb_build_object('temperature',jsonb_build_object('canonicalUnit','°C','conversionVersion','sf-units-v1','quality','good','canonicalValue',20+(n%100)::double precision/10)) from generate_series(0,299999)n`,
    [start],
  );
  await client`analyze sensor_readings`;
  let mainQuery = "",
    mainParameters: unknown[] = [];
  (client.options as any).debug = (
    _connection: unknown,
    query: string,
    parameters: unknown[],
  ) => {
    if (query.startsWith("with samples as materialized")) {
      mainQuery = query;
      mainParameters = parameters;
    }
  };
  const { getAssetTelemetry } = await import("../../server/assetTelemetry");
  const before = process.memoryUsage();
  let peakRss = before.rss,
    peakHeap = before.heapUsed;
  const sampling = setInterval(() => {
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
  }, 10);
  const begun = performance.now();
  let result;
  try {
    result = await getAssetTelemetry(
      ["urn:budget:asset"],
      start,
      end,
      60000,
      "live",
    );
  } finally {
    clearInterval(sampling);
  }
  const durationMs = performance.now() - begun;
  if (
    result.overall.sampleCount !== 240000 ||
    result.timeline.length > 601 ||
    result.assets.length !== 1
  )
    throw Error("Large-history scope or response bound failed");
  if (!mainQuery) throw Error("Actual SQL aggregation query was not captured");
  (client.options as any).debug = undefined;
  const plan = await client.unsafe(
    "explain (analyze,buffers,format json) " + mainQuery,
    mainParameters as any[],
  );
  const evidence = {
    source: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    dataset:
      "300000 synthetic rows; 240000 live, 30000 simulated, 30000 replay",
    durationMs,
    returnedBytes: Buffer.byteLength(JSON.stringify(result)),
    returnedBuckets: result.timeline.length,
    sampleCount: result.overall.sampleCount,
    processMemory: {
      before,
      after: process.memoryUsage(),
      peakRss,
      peakHeap,
      rssIncrease: peakRss - before.rss,
      heapIncrease: peakHeap - before.heapUsed,
    },
    plan: plan[0]["QUERY PLAN"],
    physicalEquipment: false,
  };
  const folder =
    process.env.QUALIFICATION_EVIDENCE_DIR ??
    "/private/tmp/factory-product-experience/analytics-budget";
  mkdirSync(folder, { recursive: true });
  writeFileSync(folder + "/result.json", JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      status: "PASS",
      ...evidence,
      plan: "retained in result.json",
    }),
  );
} finally {
  await close?.();
  await admin.unsafe(`drop database "${name}" with (force)`);
  await admin.end();
}
