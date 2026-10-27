import { afterAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { packageManifestSchema } from "./packages";
import { inspectGlb } from "./model-budget";
import {
  template,
  modelBytes,
  raspberryPiRevision,
  createEquipment,
  workspace,
  modelIdentity,
  simulate,
  database,
} from "./local";
import { withVisibility } from "../demoData";
import { closeDatabase } from "../db";
import { sectionCap } from "../../client/src/components/equipment/section";

test("the Raspberry Pi package has complete stable mappings, a reference outline and bounded closed solids", async () => {
  const t = await template(raspberryPiRevision),
    bytes = await modelBytes(raspberryPiRevision);
  expect(t.components).toHaveLength(61);
  expect(new Set(t.components.map((c) => c.templateComponentId)).size).toBe(61);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(t.sha256);
  expect(inspectGlb(bytes).triangles).toBe(5406);
  expect(bytes.length).toBeLessThan(512 * 1024);
  packageManifestSchema.parse({
    schemaVersion: "smart-factory-model-1",
    name: t.name,
    provenance: "Original parametric reference",
    license: "MIT",
    units: "m",
    handedness: "right",
    upAxis: "+Y",
    components: t.components,
    bindings: t.bindings,
    maintenanceText: t.maintenanceText,
  });
  expect(t.bindings).toEqual([]);
  expect(t.maintenanceText).toBeNull();
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    "",
  );
  for (const c of t.components) {
    let node: T.Object3D | undefined = gltf.scene;
    for (const name of c.nodePath.split("/").filter(Boolean))
      node = node?.children.find((n) => n.name === name);
    expect(node, c.name).toBeTruthy();
    expect(gltf.parser.associations.get(node!)?.nodes).toBe(c.nodeIndex);
    if (c.solid) {
      const mesh = node as T.Mesh;
      const bounds = new T.Box3().setFromObject(mesh);
      const cap = sectionCap(
        mesh.geometry,
        mesh.matrixWorld,
        new T.Plane(
          new T.Vector3(1, 0, 0),
          -bounds.getCenter(new T.Vector3()).x,
        ),
      );
      expect(cap.open, c.name).toBe(false);
      cap.geometry?.dispose();
    }
  }
  const board = t.components.find(
    (c) => c.name === "PCB substrate and mounting holes",
  )!;
  const json = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  const node = json.nodes[board.nodeIndex],
    positions =
      json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
  expect(positions.max[0] - positions.min[0]).toBeCloseTo(0.085, 6);
  expect(positions.max[2] - positions.min[2]).toBeCloseTo(0.056, 6);
  expect(
    t.components.find((c) => c.name === "GPIO contact pins")?.quantity,
  ).toBe(40);
  const pump = JSON.parse(
    readFileSync("fixtures/equipment/local-template.json", "utf8"),
  );
  expect(pump.components).toHaveLength(87);
  expect(
    t.components.some((c) =>
      pump.components.some(
        (p: any) => p.templateComponentId === c.templateComponentId,
      ),
    ),
  ).toBe(false);
});

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "Pi instances retain scoped file authorization and refuse invented pump simulations",
  async () => {
    const t = await template(raspberryPiRevision),
      created = await createEquipment(
        {
          name: "Independent Raspberry Pi reference",
          serialNumber: crypto.randomUUID(),
          kind: "simulated",
          templateRevision: t.revision,
        },
        5,
      );
    const db = await database();
    try {
      const w = await workspace(created.id);
      expect(w.observations).toEqual([]);
      expect(w.history).toEqual([]);
      expect((await modelIdentity(created.id)).templateRevision).toBe(
        raspberryPiRevision,
      );
      await expect(
        withVisibility({ demoOnly: true, includeDemo: true }, () =>
          modelIdentity(created.id),
        ),
      ).rejects.toThrow("Equipment not found");
      const before = await db.execute(
        sql`select count(*)::int as count from equipment_scenario_runs where equipment_id=${created.id}`,
      );
      await expect(simulate(created.id, "normal", 5)).rejects.toThrow(
        "no configured simulation measurements",
      );
      expect(
        await db.execute(
          sql`select count(*)::int as count from equipment_scenario_runs where equipment_id=${created.id}`,
        ),
      ).toEqual(before);
      // A mislabelled workspace must not make its private parent asset public.
      await db.execute(
        sql`update equipment_workspaces set is_demo=true where id=${created.id}`,
      );
      await expect(
        withVisibility({ demoOnly: true, includeDemo: true }, () =>
          modelIdentity(created.id),
        ),
      ).rejects.toThrow("Equipment not found");
    } finally {
      await db.execute(
        sql`delete from equipment_workspaces where id=${created.id}`,
      );
      await db.execute(
        sql`delete from asset_devices where "assetId" in(select id from assets where "assetId"=${"urn:smart-factory:equipment:" + created.id})`,
      );
      await db.execute(
        sql`delete from devices where "deviceId"=${"local-sim-" + created.id}`,
      );
      await db.execute(
        sql`delete from assets where "assetId"=${"urn:smart-factory:equipment:" + created.id}`,
      );
    }
  },
);
afterAll(async () => {
  await closeDatabase();
});
