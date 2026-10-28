import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import { sql } from "drizzle-orm";
import { disposableDatabase } from "../test/disposableDatabase";
import { getDb } from "../db";
import { notificationPage, readNotification } from "../notifications";
import { demoInfrastructure } from "./demo";
import * as collector from "./collector";
import {
  infrastructureView,
  storeRecoveryEvidence,
  installRecoveryEvidence,
} from "./store";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "disposable infrastructure boundary regressions",
  () => {
    disposableDatabase("infrastructure_boundaries");
    let counter = 0;
    const epoch = Date.now();
    beforeAll(() => {
      vi.stubEnv("INFRASTRUCTURE_FRONTEND_ORIGIN", "");
      vi.stubEnv("ALLOWED_ORIGIN", "");
      vi.stubEnv("AAS_REPOSITORY_URL", "");
    });
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(epoch + ++counter * 3600000);
      await (await getDb())!.execute(
        sql`truncate infrastructure_snapshots,infrastructure_collection_lease,infrastructure_service_state,infrastructure_events,infrastructure_recovery_receipts cascade`,
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    const receipt = () => ({
      kind: "backup" as const,
      receiptId: randomUUID(),
      observedAt: new Date().toISOString(),
      outcome: "verified" as const,
      source: "operator-verifier" as const,
      scope: "application-databases" as const,
      artifactSha256: "a".repeat(64),
      sourceRevision: null,
    });
    it("retains owner-scoped notification history when bounded infrastructure events expire", async () => {
      const db = (await getDb())!;
      const event = randomUUID();
      const [owner] = await db.execute(
        sql`insert into users("openId",email,role) values(${randomUUID()},'retention-admin@example.test','admin') returning id`,
      );
      await db.execute(
        sql`insert into infrastructure_events values(${event},'api','Application API','healthy','unavailable',now(),'incident','FIXTURE_FAILURE',${randomUUID()})`,
      );
      const [notice] = await db.execute(
        sql`insert into notification_inbox("userId",kind,title,body,"emailStatus","infrastructureEventId") values(${owner.id},'infrastructure','Recorded incident','Retained investigation history','inbox_only',${event}) returning id`,
      );
      await db.execute(
        sql`delete from infrastructure_events where id=${event}`,
      );
      const retained = (await notificationPage(Number(owner.id))).items.find(
        (n) => n.id === Number(notice.id),
      );
      expect(retained).toMatchObject({
        title: "Recorded incident",
        infrastructureEventId: null,
        readAt: null,
      });
      expect(
        await readNotification(Number(owner.id), Number(notice.id)),
      ).toBeTruthy();
      // Retention must not expose administrator evidence after demotion.
      await db.execute(
        sql`update users set role='engineer' where id=${owner.id}`,
      );
      expect((await notificationPage(Number(owner.id))).items).toEqual([]);
    });
    it("keeps a simultaneous receipt identifier immutable", async () => {
      const r = receipt(),
        results = await Promise.allSettled([
          storeRecoveryEvidence(r),
          storeRecoveryEvidence({ ...r, artifactSha256: "b".repeat(64) }),
        ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const rows = await (await getDb())!.execute(
        sql`select receipt from infrastructure_recovery_receipts`,
      );
      expect(rows).toHaveLength(1);
    });
    it("retains the last successful backup alongside a more recent failed attempt", async () => {
      const r = receipt();
      await storeRecoveryEvidence(r);
      await storeRecoveryEvidence({
        ...r,
        receiptId: randomUUID(),
        outcome: "failed",
        observedAt: new Date(Date.now() + 1000).toISOString(),
      });
      const data = await collector.collectInfrastructure();
      expect(data.recovery.map((r) => r.outcome).sort()).toEqual([
        "failed",
        "verified",
      ]);
    });
    it("does not duplicate another replica’s probes before its first snapshot exists", async () => {
      await (await getDb())!.execute(
        sql`insert into infrastructure_collection_lease(slot) values(${Math.floor(Date.now() / 60000)})`,
      );
      const spy = vi.spyOn(collector, "collectInfrastructure"),
        data = await infrastructureView();
      expect(spy).not.toHaveBeenCalled();
      expect(data.snapshot.stale).toBe(true);
      expect(data.snapshot.coverage.explanation).toContain(
        "another API instance",
      );
    });
    it("includes the final history bucket, distinguishes samples from points and resolves an older notification event", async () => {
      const db = (await getDb())!,
        now = Date.now(),
        from = now - 7200000,
        sample = demoInfrastructure().snapshot;
      // Deliberately straddle UTC bucket boundaries: 121 samples in a two-hour range.
      const times = [
        from + 1,
        ...Array.from({ length: 119 }, (_, i) => from + 30000 + i * 60000),
        now - 1,
      ];
      for (const t of times) {
        const at = new Date(t).toISOString();
        await db.execute(
          sql`insert into infrastructure_snapshots(collected_at,snapshot) values(${at}::timestamptz,${JSON.stringify({ ...sample, synthetic: false, collectedAt: at })}::jsonb)`,
        );
      }
      const id = randomUUID(),
        older = new Date(from - 3600000).toISOString();
      await db.execute(
        sql`insert into infrastructure_events values(${id},'api','Application API','healthy','unavailable',${older}::timestamptz,'incident','FIXTURE_FAILURE',${randomUUID()})`,
      );
      await db.execute(
        sql`insert into infrastructure_collection_lease(slot) values(${Math.floor(now / 60000)})`,
      );
      const data = await infrastructureView("2h", id);
      expect(data.historyWindow.returned).toBe(121);
      expect(data.historyWindow.points).toBe(120);
      expect(data.historyWindow.coveredSlots).toBe(120);
      expect(data.history.at(-1)?.at).toBe(new Date(now - 1).toISOString());
      expect(data.events.some((e) => e.id === id)).toBe(true);
    });
    it("rejects an unrelated bearer/session and accepts only validated dedicated recovery metadata", async () => {
      const token = "disposable-recovery-token-32-characters-only";
      vi.stubEnv("INFRASTRUCTURE_RECOVERY_TOKEN", token);
      const app = express();
      app.use(express.json({ limit: "8kb" }));
      installRecoveryEvidence(app);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const address = server.address() as { port: number },
        url = `http://127.0.0.1:${address.port}/api/internal/recovery-status`;
      try {
        const send = (bearer: string, body: unknown) =>
          fetch(url, {
            method: "POST",
            headers: {
              Authorization: "Bearer " + bearer,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        expect(
          (await send("ordinary-session-or-unrelated-service-token", receipt()))
            .status,
        ).toBe(401);
        const invalid = await send(token, { ...receipt(), password: token });
        expect(invalid.status).toBe(400);
        expect(JSON.stringify(await invalid.json())).not.toContain(token);
        expect(
          await (await getDb())!.execute(
            sql`select * from infrastructure_recovery_receipts`,
          ),
        ).toHaveLength(0);
        expect((await send(token, receipt())).status).toBe(202);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    });
  },
);
