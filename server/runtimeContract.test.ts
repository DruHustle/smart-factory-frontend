import { describe, it, expect } from "vitest";
import {
  runtimeCompatibility,
  requiredCapabilities,
  runtimeContractVersion,
} from "../shared/runtime-contract";
import { disposableDatabase } from "./test/disposableDatabase";
import { getRuntimeContract, migrationManifest } from "./runtimeContract";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
const compatible = {
  contractVersion: runtimeContractVersion,
  schema: { ready: true },
  capabilities: [...requiredCapabilities],
  versioned: true,
};
it("rejects ready-but-incompatible, unversioned and incomplete services", () => {
  expect(runtimeCompatibility({ status: "ready" })).toBeTruthy();
  expect(
    runtimeCompatibility({
      ...compatible,
      capabilities: requiredCapabilities.slice(1),
    }),
  ).toBeTruthy();
  expect(
    runtimeCompatibility({ ...compatible, schema: { ready: false } }),
  ).toBeTruthy();
  expect(
    runtimeCompatibility({ ...compatible, versioned: false }, true),
  ).toBeTruthy();
  expect(runtimeCompatibility(compatible, true)).toBeNull();
});
it("requires an API that honors provider selection before enabling the newer picker", () => {
  expect(runtimeCompatibility({ ...compatible, capabilities: requiredCapabilities.filter((c) => c !== "assistant-provider-selection-v1") }, true))
    .toContain("required workspace capabilities");
});
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "applied migration identity",
  () => {
    disposableDatabase("runtime");
    it("compares migration content hashes rather than health or timestamps", async () => {
      expect((await getRuntimeContract()).schema.ready).toBe(true);
      const expected = await migrationManifest();
      expect(expected.digest).toMatch(/^[a-f0-9]{64}$/);
      await (await getDb())!.execute(
        sql`update drizzle.__drizzle_migrations set hash='incorrect' where hash=${expected.hashes.at(-1)!}`,
      );
      expect((await getRuntimeContract()).schema.ready).toBe(false);
    });
  },
);

describe.skipIf(!process.env.TEST_DATABASE_URL)("operating receipts", () => {
  disposableDatabase("receipts");
  it("retains the newest bounded receipt and reports unknown recovery evidence", async () => {
    const { storeWorkerReceipt, telemetryWorkerReceipt, operatingEvidence } =
      await import("./operatingEvidence");
    const now = Date.now(),
      report = {
        worker: "telemetry",
        source: "a".repeat(40),
        runtime: "10.0.14",
        contractVersion: 2,
        migrationsDigest: "b".repeat(64),
        mqttSubscribed: false,
        observedAt: new Date(now).toISOString(),
        pending: 7,
        quarantined: 2,
        failedAttempts: 3,
        oldestPendingAt: new Date(now - 60000).toISOString(),
      };
    await storeWorkerReceipt(report);
    await storeWorkerReceipt({
      ...report,
      pending: 99,
      observedAt: new Date(now - 1000).toISOString(),
    });
    expect(await telemetryWorkerReceipt()).toMatchObject({
      fresh: true,
      pending: 7,
      mqttSubscribed: false,
    });
    await expect(
      storeWorkerReceipt({ ...report, pending: -1 }),
    ).rejects.toThrow();
    await expect(
      storeWorkerReceipt({
        ...report,
        observedAt: new Date(now + 120000).toISOString(),
      }),
    ).rejects.toThrow();
    const evidence = await operatingEvidence();
    expect(evidence.backup.state).toBe("unknown");
    expect(evidence.ingress.quarantined).toBe(0);
    await (await getDb())!.execute(
      sql`update runtime_worker_status set received_at=now()-interval '2 minutes'`,
    );
    expect((await telemetryWorkerReceipt())!.fresh).toBe(false);
  });
});
