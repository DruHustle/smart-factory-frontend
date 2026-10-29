import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { saveNetworkSnapshot, networkView } from "./store";
import { demoNetwork } from "./demo";
import { closeDatabase, getDb } from "../db";
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "operational network diagnostics store",
  () => {
    const id = "diagnostics-test-" + crypto.randomUUID();
    afterAll(async () => {
      const db = await getDb();
      if (db) {
        await db.execute(
          sql`delete from system_settings where value->'report'->>'gatewayId' in (${id},${id + "-demo"})`,
        );
        await db.execute(
          sql`delete from devices where "deviceId" in (${id},${id + "-demo"})`,
        );
      }
      await closeDatabase();
    });
    it("requires a registered operational gateway, retains only the newest bounded snapshot and marks stale evidence", async () => {
      const db = (await getDb())!;
      const report = {
        ...demoNetwork().snapshots[0],
        components: [],
        connections: [],
        ports: [],
        streams: [],
        gatewayId: id,
        observedAt: new Date(Date.now() - 180000).toISOString(),
      };
      await expect(saveNetworkSnapshot(report, 42)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await db.execute(
        sql`insert into devices("deviceId",name,type,"isDemo") values(${id},${id},'gateway',false),(${id + "-demo"},${id + " demo"},'gateway',true)`,
      );
      await expect(
        saveNetworkSnapshot({ ...report, gatewayId: id + "-demo" }, 42),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        saveNetworkSnapshot(
          {
            ...report,
            observedAt: new Date(Date.now() + 600000).toISOString(),
          },
          42,
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await saveNetworkSnapshot(report, 42);
      const stale = await networkView();
      expect(stale.synthetic).toBe(false);
      expect(stale.stale).toBe(true);
      expect(stale.snapshots.some((s) => s.gatewayId === id)).toBe(true);
      const fresh = { ...report, observedAt: new Date().toISOString() };
      await saveNetworkSnapshot(fresh, null);
      await expect(saveNetworkSnapshot(report, 42)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(
        (await networkView()).snapshots.filter((s) => s.gatewayId === id),
      ).toEqual([fresh]);
      const rows = await db.execute(
        sql`select key from system_settings where value->'report'->>'gatewayId'=${id}`,
      );
      expect(rows).toHaveLength(1);
    });
  },
);
