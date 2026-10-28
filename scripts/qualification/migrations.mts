/** Exercises the actual worker executable against its own disposable database. */
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_e2e")
)
  throw Error("Disposable local _e2e storage required");
const connection = postgres(url.toString(), { max: 1 }),
  name = "worker_migration_" + randomUUID().replaceAll("-", "") + "_e2e";
const root = resolve("../smart-factory-backend"),
  directory = resolve(root, "deploy/migrations"),
  dotnet = process.env.QUALIFICATION_DOTNET ?? "dotnet";
let target: ReturnType<typeof postgres> | undefined;
try {
  await connection.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = "/" + name;
  target = postgres(url.toString(), { max: 1 });
  const env = {
    ...process.env,
    DOTNET_ENVIRONMENT: "Development",
    PostgresConnectionString: `Host=${url.hostname};Port=${url.port};Database=${name};Username=postgres;Password=postgres;SSL Mode=Disable`,
    TELEMETRY_MIGRATIONS_DIR: directory,
  };
  const run = () =>
    spawnSync(
      dotnet,
      [
        resolve(
          root,
          "src/Services/TelemetryService/bin/Release/net10.0/TelemetryService.dll",
        ),
        "--migrate",
      ],
      { cwd: root, env, encoding: "utf8", timeout: 30000 },
    );
  const first = run();
  if (first.status !== 0)
    throw Error(
      "Actual initial migration failed: " + first.stderr.slice(-1000),
    );
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  );
  const rows = await target`select name,hash from telemetry_schema_migrations`;
  if (rows.length !== manifest.length)
    throw Error("Migration ledger incomplete");
  const second = run();
  if (second.status !== 0) throw Error("Idempotent migration failed");
  const [schema] =
    await target`select count(*)::int as n from information_schema.columns where table_name='TelemetryRecords' and column_name in('UnitsJson','MappingJson','TransportRetained','AcceptedAt','TransportRetainVerified')`;
  if (schema.n !== 5) throw Error("Worker contract columns absent");
  await target`update telemetry_schema_migrations set hash=${"0".repeat(64)} where name=${manifest.at(-1)}`;
  const altered = run();
  if (
    altered.status === 0 ||
    !altered.stderr.includes("Applied telemetry migration content changed")
  )
    throw Error("Altered migration identity did not fail closed");
  console.log(
    JSON.stringify({
      environment: "disposable-local",
      runtime: "net10.0",
      initial: true,
      idempotent: true,
      appliedMigrations: rows.length,
      requiredColumns: schema.n,
      alteredHashRejected: true,
    }),
  );
} finally {
  if (target) await target.end();
  await connection.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
  await connection.end();
}
