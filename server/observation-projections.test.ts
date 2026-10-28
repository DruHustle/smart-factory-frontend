import { describe, expect, it } from "vitest";
import { devices } from "../drizzle/schema";
import { getDb, getDevices } from "./db";
import { disposableDatabase } from "./test/disposableDatabase";
import { listInventory, inventoryFilter } from "./inventory";
import { monitoringPage, monitoringInput } from "./monitoring";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "observed status projection parity",
  () => {
    disposableDatabase("observed_status");
    it("keeps SQL totals, filters and displayed rows consistent for legacy metadata and future receipts", async () => {
      const now = Date.now();
      const cases = [
        {
          metadata: {
            commissioning: { freshnessSeconds: 0 },
            freshnessMs: 30000,
          },
          state: "unknown",
        },
        {
          metadata: { commissioning: { freshnessSeconds: 99999 } },
          state: "unknown",
        },
        { metadata: { freshnessMs: 99999999 }, state: "unknown" },
        {
          metadata: {
            commissioning: { freshnessSeconds: "bad" },
            freshnessMs: 30000,
          },
          state: "unknown",
        },
        { metadata: { freshnessMs: 30000 }, state: "unknown", future: true },
        {
          metadata: { commissioning: { freshnessSeconds: 30 } },
          state: "live",
        },
        { metadata: { freshnessMs: 30000 }, state: "stale", stale: true },
      ];
      const db = (await getDb())!;
      await db.insert(devices).values(
        cases.map((example, index) => ({
          deviceId: `projection-${index}`,
          name: `Projection ${index}`,
          type: "sensor" as const,
          status: example.future ? ("offline" as const) : ("online" as const),
          lastSeen: new Date(
            now + (example.future ? 60000 : example.stale ? -60000 : -1000),
          ),
          metadata: example.metadata,
        })),
      );
      const inventory = await listInventory(
        inventoryFilter.parse({ search: "projection" }),
      );
      const monitoring = await monitoringPage(
        monitoringInput.parse({ search: "projection" }),
      );
      const legacy = await getDevices();
      expect(inventory.total).toBe(cases.length);
      expect(monitoring.total).toBe(cases.length);
      for (const [index, example] of cases.entries()) {
        const identifier = `projection-${index}`;
        expect(
          inventory.items.find((item) => item.identifier === identifier)
            ?.status,
        ).toBe(example.state);
        expect(
          monitoring.items.find((item) => item.deviceId === identifier)
            ?.observedStatus,
        ).toBe(example.state);
        expect(
          legacy.find((item) => item.deviceId === identifier)?.observedStatus,
        ).toBe(example.state);
      }
      for (const status of ["unknown", "live", "stale"] as const) {
        const expected = cases.filter(
          (example) => example.state === status,
        ).length;
        const filteredInventory = await listInventory(
          inventoryFilter.parse({ search: "projection", status }),
        );
        const filteredMonitoring = await monitoringPage(
          monitoringInput.parse({ search: "projection", status }),
        );
        expect(filteredInventory.total).toBe(expected);
        expect(filteredMonitoring.total).toBe(expected);
        expect(
          filteredInventory.items.every((item) => item.status === status),
        ).toBe(true);
        expect(
          filteredMonitoring.items.every(
            (item) => item.observedStatus === status,
          ),
        ).toBe(true);
      }
    });
  },
);
