import { beforeEach, afterEach, vi as envMock } from "vitest";
import { it, expect, describe, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { inspectGlb } from "./model-budget";
import {
  createEquipment,
  template,
  workspace,
  simulate,
  saveWork,
  database,
  renameEquipment,
  modelChange,
  replaceModel,
} from "./local";
import { closeDatabase } from "../db";
import { sql } from "drizzle-orm";
it("admits the bounded local GLB and rejects arbitrary resource fetches", () => {
  const bytes = readFileSync("fixtures/equipment/pump-motor.glb");
  expect(inspectGlb(bytes).triangles).toBeGreaterThan(0);
  expect(() => inspectGlb(Buffer.alloc(30))).toThrow();
  const length = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  json.buffers[0].uri = "http://169.254.169.254/latest/meta-data";
  let data = Buffer.from(JSON.stringify(json));
  data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4, 32)]);
  const binary = bytes.subarray(20 + length);
  const out = Buffer.alloc(20);
  out.write("glTF");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(20 + data.length + binary.length, 8);
  out.writeUInt32LE(data.length, 12);
  out.write("JSON", 16);
  expect(() => inspectGlb(Buffer.concat([out, data, binary]))).toThrow(/URI/);
});
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "local equipment without Onesa configuration",
  () => {
    afterAll(async () => {
      vi.unstubAllEnvs();
      await closeDatabase();
    });
    it("reviews added detailed parts without changing the three existing installed identities", async () => {
      const t = await template(),
        created = await createEquipment(
          {
            name: "Detailed revision review",
            serialNumber: crypto.randomUUID(),
            kind: "real",
            templateRevision: "smart-factory-illustrative-pump-motor-2",
          },
          5,
        );
      try {
        const before = await workspace(created.id),
          preview = await modelChange(created.id, t.revision, 1);
        expect(preview.reviewToken).toBe(
          (await modelChange(created.id, t.revision, 1)).reviewToken,
        );
        expect(preview.components).toHaveLength(t.components.length);
        await replaceModel(created.id, t.revision, 1, preview.reviewToken, 5);
        const after = await workspace(created.id);
        for (const c of before.components)
          expect(
            after.components.find(
              (p) => p.templateComponentId === c.templateComponentId,
            )?.installedComponentId,
          ).toBe(c.installedComponentId);
        expect(
          new Set(after.components.map((c) => c.installedComponentId)).size,
        ).toBe(t.components.length);
      } finally {
        const db = await database();
        await db.execute(
          sql`delete from equipment_workspaces where id=${created.id}`,
        );
        await db.execute(
          sql`delete from assets where "assetId"=${"urn:smart-factory:equipment:" + created.id}`,
        );
      }
    });
    it("creates two isolated instances, persists notes and keeps real equipment empty", async () => {
      vi.stubEnv("ONESA_ENABLED", "false");
      vi.stubEnv("ONESA_SERVICE_TOKEN", "");
      vi.stubEnv("ONESA_WORKSPACE_ID", "");
      const t = await template();
      const a = await createEquipment(
          {
            name: "Independent pump A",
            serialNumber: "LOCAL-A",
            kind: "simulated",
            templateRevision: t.revision,
          },
          5,
        ),
        b = await createEquipment(
          {
            name: "Independent pump B",
            serialNumber: "LOCAL-B",
            kind: "real",
            templateRevision: t.revision,
          },
          5,
        );
      try {
        const first = await workspace(a.id),
          second = await workspace(b.id);
        expect(first.components[1].templateComponentId).toBe(
          second.components[1].templateComponentId,
        );
        expect(first.components[1].installedComponentId).not.toBe(
          second.components[1].installedComponentId,
        );
        expect(
          second.observations.every(
            (o) => o.value === null && o.mode === "unknown",
          ),
        ).toBe(true);
        await simulate(a.id, "alarm", 5);
        const alarm = await workspace(a.id);
        expect(
          alarm.observations.find((o) => o.metric === "temperature")?.value,
        ).toBe(90);
        expect((await workspace(b.id)).history).toHaveLength(0);
        await simulate(a.id, "stale", 5);
        const stale = await workspace(a.id);
        expect(
          stale.observations.every(
            (o) => o.mode === "simulated" && o.freshness === "stale",
          ),
        ).toBe(true);
        const component = stale.components[1].installedComponentId;
        await saveWork(
          {
            id: a.id,
            expectedVersion: stale.version,
            selectedComponent: component,
            annotations: [
              {
                id: crypto.randomUUID(),
                componentId: component,
                text: "Local persistent note",
              },
            ],
            viewpoints: [],
          },
          5,
        );
        await renameEquipment(a.id, "Renamed independent pump", 2, 5);
        await closeDatabase();
        const restored = await workspace(a.id);
        expect(restored.name).toBe("Renamed independent pump");
        expect(restored.selectedComponent).toBe(component);
        expect(restored.annotations[0].text).toBe("Local persistent note");
        await expect(
          saveWork(
            {
              id: a.id,
              expectedVersion: 1,
              selectedComponent: component,
              annotations: [],
              viewpoints: [],
            },
            5,
          ),
        ).rejects.toThrow(/revision conflict/);
        expect(restored.renderer.available).toBe(true);
      } finally {
        const db = await database();
        for (const id of [a.id, b.id]) {
          const w = await workspace(id);
          await db.execute(
            sql`delete from equipment_scenario_runs where equipment_id=${id}`,
          );
          await db.execute(
            sql`delete from equipment_workspaces where id=${id}`,
          );
          await db.execute(
            sql`delete from sensor_readings where "assetId"=${w.externalAssetId}`,
          );
          await db.execute(
            sql`delete from asset_devices where "assetId" in (select id from assets where "assetId"=${w.externalAssetId})`,
          );
          await db.execute(
            sql`delete from assets where "assetId"=${w.externalAssetId}`,
          );
        }
      }
    });
  },
);

it.skipIf(!process.env.TEST_DATABASE_URL)(
  "uses the existing attributed source pipeline with explicit units and stream selection",
  async () => {
    const { assets, devices, assetDevices } =
      await import("../../drizzle/schema");
    const { ingestTelemetryByDeviceId } = await import("../db");
    const db = await database(),
      id = crypto.randomUUID(),
      source = "binding-" + id.slice(0, 8),
      assetId = "urn:smart-factory:binding-test:" + id;
    const [asset] = await db
      .insert(assets)
      .values({
        assetId,
        name: "Synthetic protocol source",
        assetType: "pump",
        aasShell: {},
        isDemo: false,
      })
      .returning();
    const [device] = await db
      .insert(devices)
      .values({
        deviceId: source,
        name: "Synthetic source",
        type: "sensor",
        metadata: { connectionMode: "direct_mqtt" },
      })
      .returning();
    await db
      .insert(assetDevices)
      .values({ assetId: asset.id, deviceId: device.id, protocol: "mqtt" });
    const t = await template();
    const bindings = t.bindings
      .filter((b) => b.sourceKey === "pressure")
      .map((b) => ({ ...b, sourceUnit: "Pa" as const }));
    let created: { id: string } | undefined;
    try {
      created = await createEquipment(
        {
          name: "Local source view",
          serialNumber: "Declared test",
          kind: "real",
          templateRevision: t.revision,
          existingAssetId: asset.id,
          sourceBindings: bindings,
        },
        5,
      );
      await ingestTelemetryByDeviceId({
        deviceId: source,
        assetId,
        pressure: 200000,
        timestamp: Date.now(),
        integration: {
          mode: "simulated",
          scenarioRunId: "declared-test-run",
          sourceQuality: "good",
          sourceConnection: "online",
          gatewayReceivedAt: new Date().toISOString(),
        },
      });
      const live = await workspace(created.id);
      expect(live.observations[0].value).toBeNull();
      const simulated = await workspace(created.id, "simulated");
      expect(simulated.externalAssetId).toBe(assetId);
      expect(simulated.observations[0].value).toBeCloseTo(2);
      expect(simulated.observations[0].rawValue).toBe(200000);
      expect(simulated.observations[0].mode).toBe("simulated");
    } finally {
      if (created)
        await db.execute(
          sql`delete from equipment_workspaces where id=${created.id}`,
        );
      await db.execute(
        sql`delete from sensor_readings where "assetId"=${assetId}`,
      );
      await db.execute(
        sql`delete from asset_devices where "assetId"=${asset.id}`,
      );
      await db.execute(sql`delete from assets where id=${asset.id}`);
      await db.execute(sql`delete from devices where id=${device.id}`);
      await closeDatabase();
    }
  },
);

beforeEach(() => envMock.stubEnv("ENABLE_DEMO_ACCOUNTS", "false"));
afterEach(() => envMock.unstubAllEnvs());
