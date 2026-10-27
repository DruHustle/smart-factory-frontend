import { migrate } from "drizzle-orm/postgres-js/migrator";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, vi } from "vitest";
import { closeDatabase, getDb } from "../db";
/** Creates and drops only its own random local _e2e database. */
export function disposableDatabase(label: string) {
  let connection: ReturnType<typeof postgres>, name = "", previous: string | undefined;
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.endsWith("_e2e")) throw Error("Explicit disposable local _e2e storage required");
    const started = performance.now();
    name = `${label}_${randomUUID().replaceAll("-", "")}_e2e`; connection = postgres(url.toString(), { max: 1 });
    await connection.unsafe(`CREATE DATABASE "${name}"`); console.info("[Disposable setup]", { stage:"database-created",elapsedMs:Math.round(performance.now()-started) }); url.pathname = "/" + name;
    previous = process.env.DATABASE_URL; await closeDatabase(); process.env.DATABASE_URL = url.toString();
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false"); vi.stubEnv("ENABLE_DEMO_DATA", "false"); vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false"); vi.stubEnv("ONESA_ENABLED", "false");
    console.info("[Disposable setup]", { stage:"migration-start",elapsedMs:Math.round(performance.now()-started) });
    await migrate((await getDb())!, { migrationsFolder: "./drizzle" });
    console.info("[Disposable setup]", { stage:"ready",elapsedMs:Math.round(performance.now()-started) });
  }, 20000);
  afterAll(async () => { await closeDatabase(); if (name) { await connection.unsafe(`DROP DATABASE "${name}"`); await connection.end(); } if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; vi.unstubAllEnvs(); });
}
