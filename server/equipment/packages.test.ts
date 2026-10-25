import { beforeEach, afterEach, vi as envMock } from "vitest";
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { validateModelPackage, importModel, importedBytes } from "./packages";
import {
  template,
  database,
  createEquipment,
  workspace,
  modelChange,
  replaceModel,
} from "./local";
import { closeDatabase } from "../db";
const bytes = readFileSync("fixtures/equipment/pump-motor.glb"),
  t = JSON.parse(
    readFileSync("fixtures/equipment/local-template.json", "utf8"),
  );
const manifest = {
  schemaVersion: "smart-factory-model-1",
  name: "Imported original fixture",
  provenance: t.provenance,
  license: "MIT",
  units: "m",
  handedness: "right",
  upAxis: "+Y",
  components: t.components,
  bindings: t.bindings,
  maintenanceText: "Local maintenance text",
};
it("validates immutable package content, mappings, unit semantics and identity ambiguity", () => {
  expect(validateModelPackage(bytes, manifest).id).toMatch(
    /^local-import:[a-f0-9]{64}$/,
  );
  expect(() =>
    validateModelPackage(bytes, {
      ...manifest,
      components: [manifest.components[0], manifest.components[0]],
    }),
  ).toThrow();
  expect(() =>
    validateModelPackage(bytes, {
      ...manifest,
      bindings: [
        { ...manifest.bindings[3], meaning: "vibration_acceleration" },
      ],
    }),
  ).toThrow();
  const changed = structuredClone(manifest);
  changed.components[1].nodeIndex = 2;
  expect(() => validateModelPackage(bytes, changed)).toThrow(
    /mapping mismatch|Ambiguous/,
  );
});
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "local imported model persistence and reviewed replacement",
  { timeout: 30000 },
  () => {
    afterAll(() => closeDatabase());
    it("stores owned bytes across restart and preserves installed IDs under replacement", async () => {
      const v = await importModel(bytes, manifest, 5);
      const created = await createEquipment(
        {
          name: "Imported model instance",
          serialNumber: randomUUID(),
          kind: "real",
          templateRevision: t.revision,
        },
        5,
      );
      try {
        const before = await workspace(created.id);
        const review = await modelChange(created.id, v.revision, 1);
        await replaceModel(created.id, v.revision, 1, review.reviewToken, 5);
        await closeDatabase();
        expect(await importedBytes(v.revision)).toEqual(bytes);
        const after = await workspace(created.id);
        expect(after.components.map((c) => c.installedComponentId)).toEqual(
          before.components.map((c) => c.installedComponentId),
        );
        expect(after.templateRevision).toBe(v.revision);
        await expect(
          replaceModel(created.id, t.revision, 1, review.reviewToken, 5),
        ).rejects.toThrow(/conflict/);
        const unrelated = structuredClone(manifest);
        unrelated.components = unrelated.components.map((c) => ({
          ...c,
          templateComponentId: randomUUID(),
          parentTemplateComponentId: null,
        }));
        unrelated.bindings = [];
        const wrong = await importModel(bytes, unrelated, 5);
        await expect(
          modelChange(created.id, wrong.revision, 2),
        ).rejects.toThrow(/Ambiguous replacement/);
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
  },
);

beforeEach(() => envMock.stubEnv("ENABLE_DEMO_ACCOUNTS", "false"));
afterEach(() => envMock.unstubAllEnvs());

it.skipIf(!process.env.TEST_DATABASE_URL)(
  "keeps equipment data and notes usable when model metadata becomes unavailable",
  async () => {
    const v = await importModel(
      bytes,
      { ...manifest, name: "Missing metadata " + randomUUID() },
      5,
    );
    const created = await createEquipment(
      {
        name: "Model fallback fixture",
        serialNumber: randomUUID(),
        kind: "simulated",
        templateRevision: v.revision,
      },
      5,
    );
    const db = await database();
    let external = "";
    try {
      const { simulate, saveWork, modelBytes } = await import("./local");
      await simulate(created.id, "normal", 5);
      let w = await workspace(created.id);
      external = w.externalAssetId;
      await saveWork(
        {
          id: created.id,
          expectedVersion: w.version,
          selectedComponent: w.components[1].installedComponentId,
          annotations: [
            {
              id: randomUUID(),
              componentId: w.components[1].installedComponentId,
              text: "Preserved local note",
            },
          ],
          viewpoints: [],
        },
        5,
      );
      await db.execute(
        sql`delete from equipment_model_packages where id=${v.revision}`,
      );
      w = await workspace(created.id);
      expect(w.renderer.available).toBe(false);
      expect(w.annotations[0].text).toBe("Preserved local note");
      expect(w.observations.find((o) => o.metric === "pressure")?.value).toBe(
        2,
      );
      await expect(modelBytes(v.revision)).rejects.toThrow();
    } finally {
      await db.execute(
        sql`delete from equipment_scenario_runs where equipment_id=${created.id}`,
      );
      await db.execute(
        sql`delete from equipment_workspaces where id=${created.id}`,
      );
      await db.execute(
        sql`delete from sensor_readings where "assetId"=${external}`,
      );
      await db.execute(
        sql`delete from asset_devices where "assetId" in (select id from assets where "assetId"=${external})`,
      );
      await db.execute(sql`delete from assets where "assetId"=${external}`);
      await closeDatabase();
    }
  },
);
