import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as store from "./store";
import { drain } from "./worker";
import { CONTRACT, registrationSchema, mappingSchema } from "./contract";
import { createReceiver } from "../../scripts/onesa/receiver";
import { closeDatabase } from "../db";
const registrations = JSON.parse(
  readFileSync("fixtures/equipment/equipment.json", "utf8"),
).map((r: unknown) => registrationSchema.parse(r));
const mappings = JSON.parse(
  readFileSync("fixtures/equipment/mappings.json", "utf8"),
).map((r: unknown) => mappingSchema.parse(r));
const scope = {
  installationId: "53ded05b-c1aa-4faa-aa65-4747637baac0",
  workspaceId: "proposed-test-workspace",
};
const token = "isolated-contract-test-token-only";
let server: Server,
  base: string,
  fault = 0;
let receiverClient: ReturnType<typeof postgres>;
const sample = (
  n = 1,
  mode = "simulated",
  extra: Record<string, unknown> = {},
) => ({
  deviceId: registrations[0].deviceId,
  assetId: registrations[0].externalAssetId,
  ingestionId: n.toString(16).padStart(64, "0"),
  timestamp: Date.parse("2026-10-20T09:00:00Z") + n * 1000,
  temperature: 45,
  pressure: 2,
  vibration: 1,
  rpm: 1450,
  integration: {
    mode,
    ...(mode === "simulated" ? { scenarioRunId: "run-01" } : {}),
    ...(mode === "replay" ? { replayRunId: "replay-01" } : {}),
    sourceQuality: "good",
    sourceConnection: "online",
    gatewayReceivedAt: "2026-10-20T09:01:00Z",
  },
  ...extra,
});
async function reset() {
  const db = await store.database();
  await db.execute(
    sql`truncate onesa_outbox,onesa_equipment,onesa_installation,onesa_audit,proposed_receiver_history,proposed_receiver_current,proposed_receiver_alarms restart identity`,
  );
  fault = 0;
}
async function setup() {
  for (let i = 0; i < 2; i++) {
    await store.saveRegistration(registrations[i], 0, 5);
    await store.saveMapping(mappings[i], 5);
  }
}
async function capture(s = sample()) {
  const db = await store.database();
  await db.transaction((tx) => store.capture(tx, s));
}
async function queued() {
  return store.rows(
    await store.database(),
    sql`select * from onesa_outbox order by id`,
  );
}
async function ready() {
  await (
    await store.database()
  ).execute(
    sql`update onesa_outbox set next_attempt=now()-interval '1 second'`,
  );
}
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "durable proposed-contract delivery with real PostgreSQL and HTTP",
  () => {
    beforeAll(async () => {
      receiverClient = postgres(process.env.TEST_DATABASE_URL!, { max: 2 });
      const app = await createReceiver(
        drizzle(receiverClient),
        { ...scope, token, mappings },
        () => fault,
      );
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    beforeEach(async () => {
      for (const [k, v] of Object.entries({
        ONESA_ENABLED: "true",
        ENABLE_DEMO_ACCOUNTS: "false",
        ONESA_INSTALLATION_ID: scope.installationId,
        ONESA_WORKSPACE_ID: scope.workspaceId,
        ONESA_INGESTION_URL: base + "/proposed/v1/batches",
        ONESA_APPROVED_ORIGIN: base,
        ONESA_SERVICE_TOKEN: token,
        ONESA_CONTRACT_ID: CONTRACT,
        ONESA_ALLOW_LOCAL_HTTP: "true",
        ONESA_BATCH_SIZE: "10",
        ONESA_MAX_QUEUE_ROWS: "100",
      }))
        vi.stubEnv(k, v);
      await reset();
    });
    afterEach(() => vi.unstubAllEnvs());
    afterAll(async () => {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      await closeDatabase();
      await receiverClient.end();
    });
    it("persists two separate instances, rename identity and optimistic reconciliation conflicts", async () => {
      await setup();
      const preview = await store.previewRegistration({
        ...registrations[0],
        name: "Renamed source",
      });
      await store.saveRegistration(
        { ...registrations[0], name: "Renamed source" },
        preview.expectedVersion,
        5,
      );
      await expect(store.saveMapping(mappings[0], 5)).rejects.toThrow(
        /conflict/,
      );
      const s = await store.status();
      expect(s.equipment).toHaveLength(2);
      expect(s.equipment![0].registration.equipmentId).not.toBe(
        s.equipment![1].registration.equipmentId,
      );
      await expect(
        store.previewMapping({
          ...mappings[1],
          expectedVersion: 2,
          targets: mappings[1].targets.map((t) => ({
            ...t,
            equipmentId: mappings[0].targets[0].equipmentId,
          })),
        }),
      ).rejects.toThrow(/different installed/);
    });
    it("captures durably, survives connection recreation, and confirms persisted receipts", async () => {
      await setup();
      await capture();
      await closeDatabase();
      await drain();
      expect((await queued()).every((r) => r.state === "acknowledged")).toBe(
        true,
      );
      expect((await store.status()).lastAcknowledgment).toBeTruthy();
      const history = await store.rows(
        await store.database(),
        sql`select * from proposed_receiver_history`,
      );
      expect(history).toHaveLength(4);
    });
    it("deduplicates unchanged delivery after lost receipts and preserves IDs/timestamps", async () => {
      await setup();
      await capture();
      let lost = true;
      const lose: typeof fetch = async (...args) => {
        const response = await fetch(...args);
        if (lost) {
          lost = false;
          throw new Error("receipt lost");
        }
        return response;
      };
      await drain(lose);
      expect((await queued()).every((r) => r.state === "pending")).toBe(true);
      const first = (await queued()).map((r) => r.payload);
      await ready();
      await drain();
      expect((await queued()).map((r) => r.payload)).toEqual(first);
      const history = await store.rows(
        await store.database(),
        sql`select * from proposed_receiver_history`,
      );
      expect(history).toHaveLength(4);
      expect(
        (await queued()).every((r) =>
          (r.receipt as any[]).every((r) => r.status === "duplicate"),
        ),
      ).toBe(true);
    });
    it("keeps acquisition working during outage and recovers the persisted backlog", async () => {
      await setup();
      fault = 503;
      await capture(sample(1));
      await drain();
      await capture(sample(2));
      expect((await store.status()).backlog).toBeGreaterThan(0);
      fault = 0;
      await ready();
      await drain();
      expect((await queued()).every((r) => r.state === "acknowledged")).toBe(
        true,
      );
    });
    it("does not block acquisition while an HTTP receipt body is delayed", async () => {
      await setup();
      await capture();
      let release!: () => void, reading!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        reading = resolve;
      });
      const delivering = drain(async (_url, options) => {
        const batch = JSON.parse(String(options!.body));
        return new Response(
          new ReadableStream(
            {
              async pull(controller) {
                reading();
                await blocked;
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      schema: CONTRACT,
                      workspaceId: scope.workspaceId,
                      results: batch.items.map((e: any) => ({
                        eventId: e.eventId,
                        status: "accepted",
                        ingestedAt: new Date().toISOString(),
                        code: "ok",
                      })),
                    }),
                  ),
                );
                controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 200 },
        );
      });
      await started;
      let accepted = false;
      try {
        accepted = await Promise.race([
          capture(sample(2)).then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
        ]);
      } finally {
        release();
        await delivering;
      }
      expect(accepted).toBe(true);
    });
    it("does not accept an HTTP success without a complete valid receipt", async () => {
      await setup();
      await capture();
      await drain(async () => new Response("{}", { status: 202 }));
      expect(
        (await queued()).every(
          (r) => r.state === "pending" && r.error_code === "invalid_receipt",
        ),
      ).toBe(true);
      expect((await store.status()).lastAcknowledgment).toBeNull();
    });
    it("suspends invalid credentials and requires an authorized resume", async () => {
      await setup();
      await capture();
      vi.stubEnv("ONESA_SERVICE_TOKEN", "incorrect-token-which-is-long-enough");
      await drain();
      expect((await store.status()).error).toBe("credentials_rejected");
      vi.stubEnv("ONESA_SERVICE_TOKEN", token);
      await ready();
      await drain();
      expect((await queued()).some((r) => r.state === "pending")).toBe(true);
      await store.retryQuarantine(5);
      await drain();
      expect((await queued()).every((r) => r.state === "acknowledged")).toBe(
        true,
      );
    });
    it("quarantines permanent errors and preserves unmapped measurements for explicit retry", async () => {
      await capture();
      await drain();
      expect((await queued())[0].state).toBe("quarantine");
      await setup();
      await store.retryQuarantine(5);
      await drain();
      expect((await queued()).every((r) => r.state === "acknowledged")).toBe(
        true,
      );
      await capture(sample(2));
      await drain(async () => new Response("{}", { status: 422 }));
      expect((await queued()).some((r) => r.state === "quarantine")).toBe(true);
    });
    it("enforces persistent destination/workspace/installation isolation", async () => {
      await setup();
      await capture();
      vi.stubEnv("ONESA_WORKSPACE_ID", "unapproved-other");
      await expect(drain()).rejects.toThrow(/scope differs/);
      expect((await queued())[0].state).toBe("captured");
    });
    it("bounds backlog and accounts for capacity and retention discards", async () => {
      await setup();
      vi.stubEnv("ONESA_MAX_QUEUE_ROWS", "10");
      for (let n = 1; n <= 11; n++) await capture(sample(n));
      expect(await queued()).toHaveLength(10);
      expect((await store.status()).discarded).toBe(1);
      await (
        await store.database()
      ).execute(
        sql`update onesa_outbox set created_at=now()-interval '31 days'`,
      );
      await drain();
      expect(await queued()).toHaveLength(0);
      expect((await store.status()).discarded).toBe(11);
    });
    it("handles mixed per-item receipts without resending accepted items", async () => {
      await setup();
      await capture();
      let accepted: string | undefined;
      await drain(async (_url, options) => {
        const b = JSON.parse(String(options!.body));
        accepted = b.items[0].eventId;
        return Response.json({
          schema: CONTRACT,
          workspaceId: scope.workspaceId,
          results: b.items.map((e: any, i: number) => ({
            eventId: e.eventId,
            status: i === 0 ? "accepted" : i === 1 ? "rejected" : "retry",
            ingestedAt: i === 0 ? new Date().toISOString() : null,
            code: i === 0 ? "ok" : i === 1 ? "invalid" : "busy",
          })),
        });
      });
      expect(
        (await queued()).filter((r) => r.state === "acknowledged"),
      ).toHaveLength(1);
      expect(
        (await queued()).filter((r) => r.state === "quarantine"),
      ).toHaveLength(1);
      await ready();
      let sent: string[] = [];
      await drain(async (...args) => {
        sent = JSON.parse(String(args[1]!.body)).items.map(
          (e: any) => e.eventId,
        );
        return fetch(...args);
      });
      expect(sent).not.toContain(accepted);
      expect(sent).toHaveLength(2);
    });
    it("deduplicates source alarms and isolates replay, simulated runs and out-of-order live state", async () => {
      await setup();
      await capture(sample(10, "live"));
      await drain();
      await capture(sample(5, "live"));
      await drain();
      await capture(sample(12, "replay"));
      await drain();
      await capture(sample(13, "simulated"));
      await drain();
      const states = await store.rows(
        await store.database(),
        sql`select * from proposed_receiver_current`,
      );
      const live = states.filter((r) => (r.payload as any).mode === "live");
      expect(live).toHaveLength(4);
      expect(
        live.every(
          (r) => (r.payload as any).observedAt === "2026-10-20T09:00:10.000Z",
        ),
      ).toBe(true);
      expect(states.some((r) => (r.payload as any).mode === "replay")).toBe(
        false,
      );
      expect(
        states.filter((r) => (r.payload as any).mode === "simulated"),
      ).toHaveLength(4);
    });
    it("projects repeated identifiable source alarms once and prevents simulated live incidents", async () => {
      await setup();
      for (const n of [1, 2]) {
        const s = sample(n);
        s.integration = {
          ...s.integration,
          sourceEvents: [
            {
              id: "one-source-alarm",
              origin: "source",
              code: "test-hot",
              state: "active",
              componentId: registrations[0].components[2].componentId,
            },
          ],
        } as any;
        await capture(s);
        await drain();
      }
      const alarms = await store.rows(
        await store.database(),
        sql`select * from proposed_receiver_alarms`,
      );
      expect(alarms).toHaveLength(1);
      expect(Number(alarms[0].live_incidents)).toBe(0);
    });
    it("rejects unauthorized/version requests and reports missing target mappings", async () => {
      expect(
        (
          await fetch(base + "/proposed/v1/batches", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(base + "/proposed/v1/batches", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + token,
            },
            body: JSON.stringify({ schema: "wrong" }),
          })
        ).status,
      ).toBe(422);
    });
  },
);
