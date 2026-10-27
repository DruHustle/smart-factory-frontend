import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { observedStatus } from "../shared/inventory";
import { inventoryFilter, listInventory } from "./inventory";
import { registerDevice, registerDeviceInput } from "./deviceRegistration";
import {
  closeDatabase,
  getDb,
  getAssetsForDevice,
  ingestTelemetryByDeviceId,
} from "./db";
import { createEquipment, template } from "./equipment/local";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
it("requires commissioned source freshness and keeps no observations distinct from offline", () => {
  const now = Date.now(),
    recent = new Date(now - 1000).toISOString();
  expect(
    observedStatus({ reported: "online", lastObserved: recent }, now),
  ).toBe("unknown");
  expect(
    observedStatus(
      { reported: "online", lastObserved: recent, freshnessMs: 5000 },
      now,
    ),
  ).toBe("live");
  expect(
    observedStatus(
      { reported: "online", lastObserved: recent, freshnessMs: 100 },
      now,
    ),
  ).toBe("stale");
  expect(
    observedStatus(
      { reported: "offline", lastObserved: recent, freshnessMs: 5000 },
      now,
    ),
  ).toBe("offline");
  expect(observedStatus({ reported: "offline", freshnessMs: 5000 }, now)).toBe(
    "unknown",
  );
});
it("bounds the endpoint and validates supported registration routes", () => {
  expect(inventoryFilter.safeParse({ pageSize: 10000 }).success).toBe(false);
  expect(
    registerDeviceInput.safeParse({
      type: "sensor",
      deviceId: "bad/topic",
      name: "Sensor",
    }).success,
  ).toBe(false);
  expect(
    registerDeviceInput.safeParse({
      type: "sensor",
      deviceId: "sensor-01",
      name: "Sensor",
      route: "gateway",
    }).success,
  ).toBe(false);
});
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "authoritative inventory projection",
  () => {
    const prefix = "inventory-" + crypto.randomUUID().slice(0, 8);
    let equipment: string[] = [];
    beforeAll(() => {
      vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL!);
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
    });
    afterAll(async () => {
      const db = await getDb();
      if (db) {
        for (const id of equipment)
          await db.execute(
            sql`delete from equipment_workspaces where id=${id}`,
          );
        await db.execute(
          sql`delete from sensor_readings where "deviceId" in (select id from devices where name like ${prefix + "%"})`,
        );
        await db.execute(
          sql`delete from asset_devices where "assetId" in(select id from assets where name like ${prefix + "%"})`,
        );
        await db.execute(
          sql`delete from assets where name like ${prefix + "%"}`,
        );
        await db.execute(
          sql`delete from devices where name like ${prefix + "%"}`,
        );
      }
      vi.unstubAllEnvs();
      await closeDatabase();
    });
    it("registers and ingests a direct sensor without an AAS or gateway, preserving kind and provenance", async () => {
      const d = await registerDevice({
        type: "sensor",
        deviceId: prefix + "-direct",
        name: prefix + " direct",
        route: "direct",
        freshnessSeconds: 30,
      });
      await ingestTelemetryByDeviceId({
        deviceId: d.deviceId,
        timestamp: Date.now() - 100,
        temperature: 21,
        units: { temperature: "°C" },
        integration: {
          mode: "live",
          sourceQuality: "good",
          sourceConnection: "online",
          gatewayReceivedAt: new Date().toISOString(),
        },
      });
      const result = await listInventory(
        inventoryFilter.parse({ search: d.deviceId }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        ref: `device:${d.id}`,
        aas: false,
        route: "Direct MQTT",
        status: "live",
        mode: "live",
      });
      expect(await getAssetsForDevice(d.id)).toEqual([]);
    });
    it("preserves every gateway relationship and consolidates an explicit 3D representation", async () => {
      const db = (await getDb())!;
      const g = await registerDevice({
        type: "gateway",
        deviceId: prefix + "-gw",
        name: prefix + " gateway",
        route: "direct",
      });
      for (const n of [1, 2])
        await registerDevice({
          type: "sensor",
          deviceId: prefix + "-child" + n,
          name: prefix + " child" + n,
          route: "gateway",
          gatewayId: g.deviceId,
        });
      const assets = await db.execute(
        sql`insert into assets("assetId",name,"assetType","aasxImported","aasShell") values(${prefix + "-a"},${prefix + " imported AAS"},'other',true,'{}'::json),(${prefix + "-b"},${prefix + " asset two"},'pump',false,'{}'::json) returning id`,
      );
      for (const a of assets)
        await db.execute(
          sql`insert into asset_devices("assetId","deviceId",protocol) values(${a.id},${g.id},'mqtt')`,
        );
      expect(await getAssetsForDevice(g.id)).toHaveLength(2);
      const t = await template();
      const linked = await createEquipment(
        {
          name: prefix + " linked",
          serialNumber: prefix,
          kind: "real",
          templateRevision: t.revision,
          existingAssetId: Number(assets[0].id),
          sourceBindings: t.bindings,
        },
        1,
      );
      equipment.push(linked.id);
      const stand = await createEquipment(
        {
          name: prefix + " standalone",
          serialNumber: prefix,
          kind: "real",
          templateRevision: t.revision,
        },
        1,
      );
      equipment.push(stand.id);
      const result = await listInventory(
        inventoryFilter.parse({ search: prefix }),
      );
      const linkedRows = result.items.filter(
        (i) => i.equipmentId === linked.id,
      );
      expect(linkedRows).toHaveLength(1);
      expect(linkedRows[0]).toMatchObject({
        kind: "asset",
        aas: true,
        status: "unknown",
        sampleAt: null,
      });
      expect(result.items.filter((i) => i.equipmentId === stand.id)).toEqual([
        expect.objectContaining({ kind: "equipment", aas: false }),
      ]);
      const equipmentView = await listInventory(
        inventoryFilter.parse({ view: "equipment", search: prefix }),
      );
      expect(equipmentView.items).toHaveLength(2);
      const first = await listInventory(
        inventoryFilter.parse({ search: prefix, pageSize: 2 }),
      );
      const second = await listInventory(
        inventoryFilter.parse({ search: prefix, pageSize: 2, page: 1 }),
      );
      expect(
        first.items.every((i) => !second.items.some((j) => i.ref === j.ref)),
      ).toBe(true);
    });
    it("enforces direct API authorization for registration and protected engineering", async () => {
      const viewer = appRouter.createCaller({
        user: {
          id: 42,
          role: "viewer",
          openId: prefix,
          email: prefix + "@example.test",
        },
        req: {},
        res: {},
      } as TrpcContext);
      await expect(
        viewer.devices.create({
          deviceId: prefix + "-denied",
          name: prefix + " denied",
          type: "sensor",
          route: "direct",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(viewer.assets.getShell({ id: 1 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        viewer.inventory.list({ search: prefix, pageSize: 2 }),
      ).resolves.toMatchObject({ items: expect.any(Array) });
    });
  },
);
