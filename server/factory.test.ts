import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  layoutFactory,
  floorModel,
  gatewayLinksForFloor,
} from "../shared/factory-floor";
import type { InventoryItem } from "../shared/inventory";
import { factoryFloor } from "./factory";
import { closeDatabase, getDb } from "./db";
import { withVisibility } from "./demoData";

const fixture = (n: number): InventoryItem => ({
  ref: `device:${n}`,
  kind: "device",
  id: String(n),
  name: `Factory item ${n}`,
  identifier: `factory-${n}`,
  itemType: "sensor",
  location: null,
  zone: `Zone ${n % 4}`,
  configured: false,
  route: "Not configured",
  status: "unknown",
  lastObserved: null,
  sampleAt: null,
  mode: "unknown",
  quality: "unknown",
  freshnessMs: null,
  lifecycle: null,
  aas: false,
  equipmentId: null,
  firmware: null,
});
it("places every item beyond the ordinary list limit, deterministically and without overlapping positions", () => {
  const items = Array.from({ length: 150 }, (_, n) => fixture(n));
  const result = layoutFactory(items);
  expect(result).toEqual(layoutFactory([...items].reverse()));
  expect(result.placements).toHaveLength(items.length);
  expect(new Set(result.placements.map((p) => `${p.x}:${p.z}`)).size).toBe(
    items.length,
  );
  expect(result.zones.reduce((n, z) => n + z.count, 0)).toBe(items.length);
  expect(result.placements.map((p) => p.item.ref).sort()).toEqual(
    items.map((i) => i.ref).sort(),
  );
});
it("uses varied illustrative references and preserves unknown equipment as proxies", () => {
  const expected = {
    "Infeed conveyor": "conveyor",
    "Robot controller": "robot-arm",
    "Feed tank": "storage-tank",
    "Pneumatic valve": "valve",
    "PLC cabinet": "control-cabinet",
    "Edge gateway": "raspberry-pi-4b",
    "Pump motor": "pump-motor",
    "Unknown sensor": null,
  };
  for (const [name, slug] of Object.entries(expected))
    expect(floorModel({ name, itemType: "other" })).toBe(slug);
  expect(
    floorModel({
      name: "Raspberry Pi Edge Gateway",
      itemType: "gateway",
      identifier: "pi-edge-01",
    }),
  ).toBe("raspberry-pi-5");
  expect(
    floorModel({
      name: "esp32-wrover-01",
      itemType: "edge_device",
      identifier: "esp32-wrover-01",
    }),
  ).toBe("esp32-wrover-dht11");
  expect(layoutFactory([]).placements).toEqual([]);
});
it("draws only the recorded Pi gateway parent for the physical sensor", () => {
  const gateway = {
    ...fixture(1),
    itemType: "gateway",
    identifier: "pi-edge-01",
  };
  const sensor = {
    ...fixture(2),
    identifier: "esp32-wrover-01",
    gatewayId: "pi-edge-01",
  };
  expect(gatewayLinksForFloor([gateway, sensor])).toEqual([
    {
      from: gateway.ref,
      to: sensor.ref,
      kind: "gateway",
      label: "Pi-local MQTT/TLS",
    },
  ]);
  expect(gatewayLinksForFloor([sensor])).toEqual([]);
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "complete factory projection and visibility",
  () => {
    const zone = `floor-test-${crypto.randomUUID()}`;
    afterAll(async () => {
      const db = await getDb();
      if (db) {
        await db.execute(
          sql`delete from asset_devices where "assetId" in (select id from assets where zone=${zone})`,
        );
        await db.execute(sql`delete from assets where zone=${zone}`);
        await db.execute(sql`delete from devices where zone=${zone}`);
      }
      await closeDatabase();
    });
    it("returns the entire visible floor and only real links between visible endpoints", async () => {
      const db = (await getDb())!;
      const devices = await db.execute<{ id: number }>(
        sql`insert into devices("deviceId",name,type,zone,"isDemo") select ${zone}||n::text,${zone}||n::text,case when n=1 then 'gateway'::device_type else 'sensor'::device_type end,${zone},n<=60 from generate_series(1,62) as n returning id`,
      );
      const [asset] = await db.execute<{ id: number }>(
        sql`insert into assets("assetId",name,"assetType",zone,"aasShell","isDemo") values(${zone},${zone},'pump',${zone},'{}'::json,true) returning id`,
      );
      for (const d of [devices[0], devices[61]])
        await db.execute(
          sql`insert into asset_devices("assetId","deviceId",protocol) values(${asset.id},${d.id},'opcua')`,
        );
      const demo = await withVisibility(
        { demoOnly: true, includeDemo: true },
        () => factoryFloor(zone),
      );
      expect(demo.complete).toBe(true);
      expect(demo.total).toBe(61);
      expect(demo.items).toHaveLength(61);
      expect(demo.links).toEqual([
        {
          from: `device:${devices[0].id}`,
          to: `asset:${asset.id}`,
          kind: "acquisition",
          label: "opcua",
        },
      ]);
      const live = await withVisibility(
        { demoOnly: false, includeDemo: false },
        () => factoryFloor(zone),
      );
      expect(live.items).toHaveLength(2);
      expect(live.links).toEqual([]);
      const empty = await withVisibility(
        { demoOnly: true, includeDemo: true },
        () => factoryFloor(zone + "-missing"),
      );
      expect(empty.total).toBe(0);
    });
  },
);
