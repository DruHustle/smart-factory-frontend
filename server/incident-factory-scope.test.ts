import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { alerts } from "../drizzle/schema";
import { createUser, getAlertPage, getAlerts, getAlertStats, getDb } from "./db";
import { registerDevice } from "./deviceRegistration";
import { incidentActionQueue } from "./incidentActions";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "factory incident boundaries",
  () => {
    disposableDatabase("incident_factory");

    it("keeps list, pagination, action queue and export inside the saved factory boundary", async () => {
      const db = (await getDb())!;
      const firstFactory = crypto.randomUUID(),
        secondFactory = crypto.randomUUID();
      const engineer = (await createUser({
        openId: "scope-engineer",
        name: "Scope engineer",
        email: "scope@example.test",
        role: "engineer",
      }))!;
      const devices = [];
      for (const key of ["placed", "shared", "outside"])
        devices.push(
          await registerDevice({
            deviceId: `scope-${key}`,
            name: `Scope ${key}`,
            type: "gateway",
            route: "direct",
          }),
        );
      await db.execute(sql`insert into factories(id,name,width,depth) values
      (${firstFactory}::uuid,'Scope first',40,30),(${secondFactory}::uuid,'Scope second',40,30)`);
      const assets = await db.execute<{ id: number; assetId: string }>(sql`
      insert into assets("assetId",name,"assetType","aasShell") values
      ('urn:scope:first','First asset','pump','{}'::json),
      ('urn:scope:second','Second asset','pump','{}'::json) returning id,"assetId"`);
      await db.execute(sql`insert into factory_items(ref,factory_id,device_id,origin,inventory_tag,width,depth,height)
      values(${`device:${devices[0].id}`},${firstFactory}::uuid,${devices[0].id},'attached','SOURCE-01',1,1,1)`);
      for (const [index, factory] of [firstFactory, secondFactory].entries()) {
        await db.execute(sql`insert into factory_items(ref,factory_id,asset_id,origin,inventory_tag,width,depth,height)
        values(${`asset:${assets[index].id}`},${factory}::uuid,${assets[index].id},'attached','PUMP-01',1,1,1)`);
        await db.execute(sql`insert into asset_devices("assetId","deviceId",protocol)
        values(${assets[index].id},${devices[1].id},'mqtt')`);
      }
      const events = await db
        .insert(alerts)
        .values([
          {
            deviceId: devices[0].id,
            type: "system_error",
            severity: "warning",
            message: "Placed source",
            sourceCondition: "active",
            status: "resolved",
          },
          {
            deviceId: devices[1].id,
            assetId: assets[0].assetId,
            type: "system_error",
            severity: "warning",
            message: "First asset",
            sourceCondition: "cleared",
            acknowledgedAt: new Date(),
          },
          {
            deviceId: devices[1].id,
            type: "system_error",
            severity: "warning",
            message: "Shared source",
            status: "acknowledged",
          },
          {
            deviceId: devices[1].id,
            assetId: assets[1].assetId,
            type: "system_error",
            severity: "warning",
            message: "Second asset",
          },
          {
            deviceId: devices[2].id,
            type: "system_error",
            severity: "warning",
            message: "Outside source",
          },
        ])
        .returning();
      const expected = [events[0].id, events[1].id, events[2].id].sort();
      // A newer unrelated incident must not consume the limit before the
      // selected source is applied, and source filters cannot widen a factory.
      expect(
        (await getAlerts({ factoryId: firstFactory, deviceIds: [devices[0].id], limit: 1 }))
          .map((row) => row.id),
      ).toEqual([events[0].id]);
      expect(
        await getAlerts({ factoryId: firstFactory, deviceIds: [devices[2].id], limit: 1 }),
      ).toEqual([]);
      expect(
        (await getAlerts({ deviceIds: [devices[1].id], assetIds: [assets[0].assetId] }))
          .map((row) => row.id).sort(),
      ).toEqual([events[1].id, events[2].id].sort());
      expect(
        (await getAlerts({ factoryId: firstFactory, openOnly: true }))
          .map((row) => row.id)
          .sort(),
      ).toEqual(expected);
      expect(
        (await getAlerts({ factoryId: secondFactory }))
          .map((row) => row.id)
          .sort(),
      ).toEqual([events[2].id, events[3].id].sort());
      const page = await getAlertPage(
        { factoryId: firstFactory, openOnly: true },
        0,
        2,
      );
      expect(page).toMatchObject({
        total: 3,
        returned: 2,
        hasMore: true,
        summary: { total: 3, warning: 3 },
      });
      expect(await getAlertStats(undefined, firstFactory)).toMatchObject({
        open: 3,
        warning: 3,
      });
      const remainder = await getAlertPage(
        { factoryId: firstFactory, openOnly: true },
        1,
        2,
      );
      expect(
        [...page.items, ...remainder.items].map((row) => row.id).sort(),
      ).toEqual(expected);
      expect(remainder).toMatchObject({ returned: 1, hasMore: false });
      expect(
        (await getAlerts({ factoryId: firstFactory, acknowledged: false })).map(
          (row) => row.id,
        ),
      ).toEqual([events[0].id]);
      expect(
        (
          await getAlertPage({
            factoryId: firstFactory,
            sourceCondition: "cleared",
            acknowledged: true,
          })
        ).total,
      ).toBe(1);
      for (const event of events)
        await db.execute(sql`insert into incident_actions(alert_id,title,owner_id,created_by)
        values(${event.id},${event.message},${engineer.id},${engineer.id})`);
      expect(
        (await incidentActionQueue(0, 25, firstFactory)).items
          .map((row) => row.incidentId)
          .sort(),
      ).toEqual(expected);

      const caller = appRouter.createCaller({
        user: engineer,
        req: { headers: { cookie: "smart_factory_data_workspace=live" } },
        res: {},
        visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
      } as unknown as TrpcContext);
      const report = await caller.export.alertHistoryReport({
        factoryId: firstFactory,
        deviceId: devices[1].id,
        sourceCondition: "cleared",
        acknowledged: true,
        startTime: 0,
        endTime: Date.now() + 1000,
      });
      expect(report.metadata).toMatchObject({
        total: 1,
        returned: 1,
        scope: {
          factoryId: firstFactory,
          deviceId: devices[1].id,
          sourceCondition: "cleared",
          acknowledged: true,
        },
      });
      expect(report.html).toContain("First asset");
      expect(report.html).not.toContain("Second asset");
      expect(
        (await caller.alerts.list({ factoryId: firstFactory })).length,
      ).toBe(3);
      expect(
        (await caller.alerts.page({ factoryId: firstFactory })).total,
      ).toBe(3);
      expect(
        (await caller.alerts.actionQueue({ factoryId: firstFactory })).items,
      ).toHaveLength(3);

      const missing = crypto.randomUUID();
      for (const result of await Promise.allSettled([
        getAlerts({ factoryId: missing }),
        getAlertPage({ factoryId: missing }),
        incidentActionQueue(0, 25, missing),
      ])) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ code: "NOT_FOUND" });
      }
      await expect(
        caller.alerts.list({ factoryId: "not-a-factory" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  },
);
