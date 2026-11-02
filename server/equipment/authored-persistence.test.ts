import { afterAll, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { authoredAssets } from "../../shared/authored-assets";
import { closeDatabase } from "../db";
import {
  importModel,
  importedBytes,
  importedTemplate,
  validateModelPackage,
} from "./packages";
import {
  createEquipment,
  database,
  modelChange,
  replaceModel,
  workspace,
} from "./local";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "authored native installation survives an older package reader",
  () => {
    afterAll(() => closeDatabase());
    it("reuses an immutable package at the storage-count limit while rejecting a new package", async () => {
      const model = authoredAssets[0].models.compact;
      const bytes = await readFile(
        new URL(`../../client/public${model.url}`, import.meta.url),
      );
      const existing = await importModel(bytes, model.manifest, 5);
      const db = await database(),
        prefix = "quota-fixture-" + randomUUID() + "-";
      const [initial] = await db.execute(
        sql`select count(*) as count from equipment_model_packages`,
      );
      expect(Number(initial.count)).toBeLessThanOrEqual(100);
      const additions = 100 - Number(initial.count);
      // Only the explicit disposable TEST_DATABASE_URL fixture is used here.
      await db.execute(sql`insert into equipment_model_packages (id,manifest,glb,sha256,bytes,created_by)
      select ${prefix} || sequence::text,manifest,glb,sha256,bytes,5 from equipment_model_packages
      cross join generate_series(1,${additions}) as sequence where id=${existing.revision}`);
      try {
        const [atLimit] = await db.execute(
          sql`select count(*) as count from equipment_model_packages`,
        );
        expect(Number(atLimit.count)).toBe(100);
        expect((await importModel(bytes, model.manifest, 5)).revision).toBe(
          existing.revision,
        );
        const newManifest = {
          ...model.manifest,
          name: "New package at quota " + randomUUID(),
        };
        await expect(importModel(bytes, newManifest, 5)).rejects.toThrow(
          /storage limit/,
        );
        const newId = validateModelPackage(bytes, newManifest).id;
        const [count] = await db.execute(
          sql`select count(*) as count from equipment_model_packages where id=${newId}`,
        );
        expect(Number(count.count)).toBe(0);
      } finally {
        await db.execute(
          sql`delete from equipment_model_packages where id like ${prefix + "%"}`,
        );
      }
    });
    for (const asset of authoredAssets) {
      it(`${asset.slug} stores immutable bytes and metadata and retains installed IDs through replacement/restart`, async () => {
        const model = asset.models.compact;
        const created = await createEquipment(
          {
            name: "Authored durability fixture",
            serialNumber: randomUUID(),
            kind: "real",
            templateRevision: model.revision,
          },
          5,
        );
        try {
          const before = await workspace(created.id);
          expect(before.templateRevision).toMatch(
            /^local-import:[a-f0-9]{64}$/,
          );
          expect(before.renderer.available).toBe(true);
          const stored = await importedTemplate(before.templateRevision);
          expect(stored.provenance).toBe(model.manifest.provenance);
          expect(stored.license).toBe("MIT");
          expect(stored.components).toEqual(model.manifest.components);
          expect(stored.bindings).toEqual([]);
          const review = await modelChange(
            created.id,
            model.revision,
            before.version,
          );
          await replaceModel(
            created.id,
            model.revision,
            before.version,
            review.reviewToken,
            5,
          );
          await closeDatabase();
          const after = await workspace(created.id);
          expect(after.templateRevision).toBe(before.templateRevision);
          expect(after.components.map((c) => c.installedComponentId)).toEqual(
            before.components.map((c) => c.installedComponentId),
          );
          expect(after.renderer.available).toBe(true);
          expect(
            createHash("sha256")
              .update(await importedBytes(after.templateRevision))
              .digest("hex"),
          ).toBe(model.sha256);
          const db = await database();
          const [count] = await db.execute(
            sql`select count(*) as count from equipment_model_packages where id=${after.templateRevision}`,
          );
          expect(Number(count.count)).toBe(1);
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
    }
  },
);
