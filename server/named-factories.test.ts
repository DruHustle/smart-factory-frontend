import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { appRouter } from "./routers";
import { createUser, getDb, closeDatabase, type User } from "./db";
import type { TrpcContext } from "./_core/context";
import { currentRequestDatabase, withMutationActor } from "./database-scope";
import {
  namedFactoryDraft,
  type NamedFactory,
  type NamedFactoryDraft,
} from "../shared/named-factory";

const empty = (name: string): NamedFactoryDraft => ({
  document: { name, width: 40, depth: 30, zones: [], placements: [] },
  dimensions: {},
  tags: {},
});
it("requires a full measured footprint, distinct factory tags and in-bounds rotated equipment", () => {
  const draft = empty("Measured floor"),
    ref = "asset:1";
  draft.document.placements.push({
    ref,
    x: 19,
    z: 0,
    rotation: 0,
    zoneId: null,
  });
  draft.tags[ref] = "PUMP-01";
  expect(namedFactoryDraft.safeParse(draft).success).toBe(false);
  draft.dimensions[ref] = { width: 4, depth: 1, height: 2 };
  expect(namedFactoryDraft.safeParse(draft).success).toBe(false);
  draft.document.placements[0].rotation = 90;
  expect(namedFactoryDraft.safeParse(draft).success).toBe(true);
  draft.document.placements.push({
    ref: "asset:2",
    x: 0,
    z: 0,
    rotation: 0,
    zoneId: null,
  });
  draft.dimensions["asset:2"] = { width: 1, depth: 1, height: 1 };
  draft.tags["asset:2"] = "pump-01";
  expect(namedFactoryDraft.safeParse(draft).success).toBe(false);
});

it("does not trust a vendor extension as proof that an imported or registered AAS is unpublished", async () => {
  const { isPlannedAsset, plannedAssetShell } =
      await import("./planned-assets"),
    assetId = "urn:smart-factory:planned:" + crypto.randomUUID(),
    aasShell = plannedAssetShell(assetId, "Planned pump", "pump");
  expect(isPlannedAsset({ assetId, aasShell })).toBe(true);
  expect(isPlannedAsset({ assetId, aasShell, aasxImported: true })).toBe(false);
  expect(isPlannedAsset({ assetId: "urn:vendor:registered", aasShell })).toBe(
    false,
  );
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "team factories and transactional activity",
  () => {
    const tag = crypto.randomUUID();
    let engineer: User, teammate: User, admin: User, viewer: User;
    const created = new Set<string>();
    const caller = (user: User) =>
      appRouter.createCaller({
        user,
        req: { headers: { cookie: "smart_factory_data_workspace=live" } },
        res: {},
        visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
      } as unknown as TrpcContext);
    const create = async (person = engineer) => {
      const factory = await caller(person).factories.create(
        empty("Factory " + tag + "-" + crypto.randomUUID()),
      );
      created.add(factory.id);
      return factory;
    };
    const addPump = (
      factory: NamedFactory,
      name = "Measured pump",
      identifier = "PUMP-01",
    ) =>
      caller(engineer).factories.add({
        id: factory.id,
        expectedVersion: factory.version,
        item: {
          name,
          identifier,
          kind: "asset",
          itemType: "pump",
          dimensions: { width: 2, depth: 1, height: 2 },
        },
      });
    beforeAll(async () => {
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
      const make = (role: User["role"], name: string) =>
        createUser({
          openId: "factory-" + role + "-" + name + "-" + tag,
          email: name.toLowerCase() + "-" + tag + "@example.test",
          role,
          name,
        });
      engineer = (await make("engineer", "Ada"))!;
      teammate = (await make("engineer", "Grace"))!;
      admin = (await make("admin", "Lin"))!;
      viewer = (await make("viewer", "Viewer"))!;
    });
    afterAll(async () => {
      // Keep append-only audit history in this disposable database; remove only this test's inventory/users.
      for (const id of created) {
        let factory = await caller(admin).factories.get({ id });
        for (const p of factory.document.placements)
          factory = await caller(admin).factories.deleteItem({
            id,
            expectedVersion: factory.version,
            ref: p.ref,
          });
      }
      const db = await getDb();
      if (db && engineer && teammate && admin && viewer)
        await db.execute(
          sql`delete from users where id in (${engineer.id},${teammate.id},${admin.id},${viewer.id})`,
        );
      vi.unstubAllEnvs();
      await closeDatabase();
    });
    it("shares named factories with the team, preserves roles and stamps the authenticated actor", async () => {
      const factory = await create();
      expect(
        (await caller(viewer).factories.list()).some(
          (f) => f.id === factory.id,
        ),
      ).toBe(true);
      const log = await caller(viewer).factories.activity.list({
        factoryId: factory.id,
      });
      expect(log.items[0]).toMatchObject({
        actorId: engineer.id,
        actorName: "Ada",
        actorRole: "engineer",
        action: "factory.created",
      });
      await expect(
        caller(viewer).factories.save({
          id: factory.id,
          expectedVersion: factory.version,
          draft: empty("Forbidden rename"),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(viewer).factories.add({
          id: factory.id,
          expectedVersion: factory.version,
          item: {
            name: "Forbidden",
            identifier: "",
            kind: "asset",
            itemType: "pump",
            dimensions: { width: 1, depth: 1, height: 1 },
          },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const renamed = await caller(teammate).factories.save({
        id: factory.id,
        expectedVersion: factory.version,
        draft: empty(factory.name + " renamed"),
      });
      expect(renamed.name).toContain("renamed");
      expect(
        (await caller(admin).factories.activity.list({ factoryId: factory.id }))
          .items[0],
      ).toMatchObject({
        actorId: teammate.id,
        actorName: "Grace",
        action: "factory.updated",
      });
    });
    it("adds canonical inventory, moves a measured footprint and rejects stale saves without an audit fiction", async () => {
      const initial = await create(),
        added = await addPump(initial);
      expect(added.factory.items).toHaveLength(1);
      expect(
        (await caller(viewer).inventory.list({ factoryId: initial.id }))
          .items[0],
      ).toMatchObject({
        ref: added.ref,
        name: "Measured pump",
        factoryTag: "PUMP-01",
      });
      const draft = structuredClone({
        document: added.factory.document,
        dimensions: added.factory.dimensions,
        tags: added.factory.tags,
      });
      draft.document.placements[0] = {
        ...draft.document.placements[0],
        x: 4,
        z: 3,
        rotation: 90,
      };
      const saved = await caller(teammate).factories.save({
        id: initial.id,
        expectedVersion: added.factory.version,
        draft,
      });
      expect(saved.document.placements[0]).toMatchObject({
        x: 4,
        z: 3,
        rotation: 90,
      });
      const log = await caller(viewer).factories.activity.list({
        factoryId: initial.id,
      });
      const move = log.items.find((e) => e.action === "placement.changed")!;
      expect(move).toMatchObject({ actorId: teammate.id, actorName: "Grace" });
      const detail = await caller(viewer).factories.activity.get({
        factoryId: initial.id,
        id: move.id,
      });
      expect(detail.before).toMatchObject({ x: 0, z: 0 });
      expect(detail.after).toMatchObject({ x: 4, z: 3, rotation: 90 });
      await expect(
        caller(engineer).factories.save({
          id: initial.id,
          expectedVersion: added.factory.version,
          draft,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (
          await caller(viewer).factories.activity.list({
            factoryId: initial.id,
          })
        ).items,
      ).toHaveLength(log.items.length);
      expect(
        (await caller(viewer).factories.get({ id: initial.id })).document
          .placements,
      ).toEqual(saved.document.placements);
    });
    it("updates existing inventory edits in the factory log and never records connection secrets", async () => {
      let factory = await create();
      const added = await caller(engineer).factories.add({
        id: factory.id,
        expectedVersion: factory.version,
        item: {
          name: "Factory sensor",
          identifier: "sensor-" + tag.slice(0, 16),
          kind: "device",
          itemType: "sensor",
          dimensions: { width: 0.2, depth: 0.2, height: 0.2 },
        },
      });
      factory = added.factory;
      const id = Number(added.ref.split(":")[1]);
      await caller(teammate).devices.update({ id, name: "Calibrated sensor" });
      expect(
        (await caller(viewer).factories.get({ id: factory.id })).items[0].name,
      ).toBe("Calibrated sensor");
      await withMutationActor(engineer, async () => {
        const db = (await getDb())!;
        await db.execute(
          sql`update devices set metadata=${JSON.stringify({ connectionMode: "unconfigured", password: "synthetic-secret-must-not-enter-log" })}::json where id=${id}`,
        );
      });
      const log = await caller(viewer).factories.activity.list({
        factoryId: factory.id,
      });
      const detail = await caller(viewer).factories.activity.get({
        factoryId: factory.id,
        id: log.items[0].id,
      });
      expect(log.items[0]).toMatchObject({
        actorId: engineer.id,
        actorName: "Ada",
        action: "inventory.updated",
      });
      expect(JSON.stringify(detail)).not.toContain("synthetic-secret");
      expect(detail.after).toMatchObject({
        configurationChanged: true,
        configurationKeys: ["password"],
      });
      expect(
        log.items.some(
          (e) => e.action === "inventory.updated" && e.actorId === teammate.id,
        ),
      ).toBe(true);
    });
    it("attributes AASX import connections to the importing engineer in the factory history", async () => {
      const factory = await create();
      const gateway = await caller(engineer).factories.add({
        id: factory.id,
        expectedVersion: factory.version,
        item: {
          name: "Import gateway",
          identifier: "import-gw-" + tag.slice(0, 12),
          kind: "device",
          itemType: "gateway",
          dimensions: { width: 0.5, depth: 0.5, height: 0.5 },
        },
      });
      const { importAasxAssets } = await import("./db");
      const imported = await importAasxAssets(
        [
          {
            shell: {
              id: "urn:factory-import:" + crypto.randomUUID(),
              idShort: "ImportedPump",
              assetInformation: { assetKind: "Instance" },
            },
            submodels: [],
            conceptDescriptions: [],
          },
        ],
        teammate.id,
        {
          mode: "gateway",
          deviceId: Number(gateway.ref.split(":")[1]),
          protocol: "mqtt",
          endpoint: "mqtt://private-import-endpoint-must-not-enter-history",
          tagMappings: [],
        },
      );
      try {
        expect(imported).toHaveLength(1);
        const event = (
          await caller(viewer).factories.activity.list({
            factoryId: factory.id,
          })
        ).items.find((e) => e.action === "connection.added");
        expect(event).toMatchObject({
          targetRef: gateway.ref,
          actorId: teammate.id,
          actorName: teammate.name,
          actorRole: "engineer",
        });
        const detail = await caller(viewer).factories.activity.get({
          factoryId: factory.id,
          id: event!.id,
        });
        expect(detail.after).toMatchObject({ endpointConfigured: true });
        expect(JSON.stringify(detail)).not.toContain("private-import-endpoint");
      } finally {
        const db = (await getDb())!;
        await db.execute(
          sql`delete from asset_devices where "assetId"=${imported[0].id}`,
        );
      }
    });
    it("audits connection changes without endpoint secrets and blocks deleting a linked device", async () => {
      const pump = await addPump(await create());
      const sensor = await caller(engineer).factories.add({
        id: pump.factory.id,
        expectedVersion: pump.factory.version,
        item: {
          name: "Linked sensor",
          identifier: "linked-" + tag.slice(0, 12),
          kind: "device",
          itemType: "sensor",
          dimensions: { width: 0.2, depth: 0.2, height: 0.2 },
        },
      });
      const db = (await getDb())!;
      await withMutationActor(teammate, () =>
        db.transaction(async (tx) => {
          // Use the request-scoped connection, exactly as the existing inventory link helper does.
          const scoped = (await getDb())!;
          await scoped.execute(
            sql`insert into asset_devices("assetId","deviceId",protocol,endpoint,"tagMappings") values(${Number(pump.ref.split(":")[1])},${Number(sensor.ref.split(":")[1])},'mqtt','mqtt://synthetic:must-stay-private@fixture','[]'::json)`,
          );
        }),
      );
      const log = await caller(viewer).factories.activity.list({
        factoryId: pump.factory.id,
      });
      const connection = log.items.find(
        (e) => e.action === "connection.added",
      )!;
      expect(connection).toMatchObject({
        actorId: teammate.id,
        actorName: "Grace",
      });
      const detail = await caller(viewer).factories.activity.get({
        factoryId: pump.factory.id,
        id: connection.id,
      });
      expect(JSON.stringify(detail)).not.toContain("must-stay-private");
      expect(detail.after).toMatchObject({
        protocol: "mqtt",
        endpointConfigured: true,
      });
      await caller(teammate).thresholds.upsert({
        deviceId: Number(sensor.ref.split(":")[1]),
        metric: "temperature",
        unit: "°C",
        minValue: 0,
        maxValue: 80,
        warningMax: 70,
      });
      const workflows = await caller(viewer).factories.activity.list({
        factoryId: pump.factory.id,
      });
      expect(
        workflows.items.some(
          (e) =>
            e.action === "alert_thresholds.insert" && e.actorId === teammate.id,
        ),
      ).toBe(true);
      await expect(
        caller(admin).factories.deleteItem({
          id: pump.factory.id,
          expectedVersion: sensor.factory.version,
          ref: sensor.ref,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await withMutationActor(engineer, async () => {
        await (await getDb())!.execute(
          sql`delete from asset_devices where "deviceId"=${Number(sensor.ref.split(":")[1])}`,
        );
      });
    });
    it("removes app-owned standalone 3D inventory without inventing a remote AAS publication", async () => {
      const { createEquipment, template } = await import("./equipment/local");
      const created = await createEquipment(
        {
          name: "Standalone model fixture",
          serialNumber: crypto.randomUUID(),
          kind: "real",
          templateRevision: (await template()).revision,
        },
        engineer.id,
      );
      const ref = "equipment:" + created.id,
        initial = await create();
      const attached = await caller(engineer).factories.attach({
        id: initial.id,
        expectedVersion: initial.version,
        ref,
        tag: "CAD-01",
        dimensions: { width: 2, depth: 2, height: 2 },
      });
      const oldUrl = process.env.AAS_PROVISIONING_API_URL,
        oldToken = process.env.AAS_PROVISIONING_TOKEN;
      vi.stubEnv("AAS_PROVISIONING_API_URL", "http://127.0.0.1:1/api/assets");
      vi.stubEnv(
        "AAS_PROVISIONING_TOKEN",
        "synthetic-standalone-deletion-service-token",
      );
      const remote = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(
          Error("A standalone model must not call remote AAS provisioning"),
        );
      try {
        const result = await caller(admin).factories.deleteItem({
          id: initial.id,
          expectedVersion: attached.factory.version,
          ref,
        });
        expect(result.total).toBe(0);
        expect(remote).not.toHaveBeenCalled();
        await expect(
          caller(viewer).inventory.item({ ref }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(
          (
            await (await getDb())!.execute(
              sql`select id from equipment_workspaces where id=${created.id}`,
            )
          ).length,
        ).toBe(0);
        expect(
          (
            await caller(viewer).factories.activity.list({
              factoryId: initial.id,
            })
          ).items.some(
            (e) =>
              e.action === "inventory.deleted" &&
              e.targetRef === ref &&
              e.actorId === admin.id,
          ),
        ).toBe(true);
      } finally {
        remote.mockRestore();
        vi.stubEnv("AAS_PROVISIONING_API_URL", oldUrl ?? "");
        vi.stubEnv("AAS_PROVISIONING_TOKEN", oldToken ?? "");
      }
    });
    it("deletes only the confirmed factory member and its authoritative inventory record, retaining actor/history", async () => {
      const first = await create(),
        second = await create();
      const added = await addPump(first);
      await expect(
        caller(admin).factories.deleteItem({
          id: second.id,
          expectedVersion: second.version,
          ref: added.ref,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller(engineer).factories.deleteItem({
          id: first.id,
          expectedVersion: added.factory.version,
          ref: added.ref,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await caller(viewer).inventory.item({ ref: added.ref })).name,
      ).toBe("Measured pump");
      const deleted = await caller(admin).factories.deleteItem({
        id: first.id,
        expectedVersion: added.factory.version,
        ref: added.ref,
      });
      expect(deleted.items).toEqual([]);
      expect(deleted.document.placements).toEqual([]);
      expect(
        (await caller(viewer).inventory.list({ factoryId: first.id })).total,
      ).toBe(0);
      await expect(
        caller(viewer).inventory.item({ ref: added.ref }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const log = await caller(viewer).factories.activity.list({
        factoryId: first.id,
      });
      const deletion = log.items.find((e) => e.action === "inventory.deleted")!;
      expect(deletion).toMatchObject({
        actorId: admin.id,
        actorName: "Lin",
        actorRole: "admin",
        targetRef: added.ref,
      });
      expect(
        (
          await caller(viewer).factories.activity.get({
            factoryId: first.id,
            id: deletion.id,
          })
        ).before,
      ).toMatchObject({ name: "Measured pump", tag: "PUMP-01" });
      expect(
        (await caller(viewer).factories.get({ id: second.id })).items,
      ).toEqual([]);
    });
    it("swaps factory tags atomically, refuses membership removal through layout save and protects demo fixtures", async () => {
      const first = await addPump(await create(), "First pump", "A");
      const second = await addPump(first.factory, "Second pump", "B");
      const draft = structuredClone({
        document: second.factory.document,
        dimensions: second.factory.dimensions,
        tags: second.factory.tags,
      });
      [draft.tags[first.ref], draft.tags[second.ref]] = [
        draft.tags[second.ref],
        draft.tags[first.ref],
      ];
      const saved = await caller(engineer).factories.save({
        id: first.factory.id,
        expectedVersion: second.factory.version,
        draft,
      });
      expect(saved.tags).toMatchObject({ [first.ref]: "B", [second.ref]: "A" });
      await expect(
        caller(engineer).factories.save({
          id: saved.id,
          expectedVersion: saved.version,
          draft: empty(saved.name),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const sharedDemo = { ...admin, email: "admin@dev.local" };
      await expect(caller(sharedDemo).factories.list()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(sharedDemo).factories.create(empty("Forbidden demo write")),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("paginates all activity and rejects changes to past entries", async () => {
      const factory = await create(),
        db = (await getDb())!;
      await db.execute(
        sql`select record_factory_activity(${factory.id},'test.pagination',null,null,jsonb_build_object('number',n)) from generate_series(1,155) n`,
      );
      const first = await caller(viewer).factories.activity.list({
        factoryId: factory.id,
      });
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).toBeTruthy();
      const all = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await caller(viewer).factories.activity.list({
          factoryId: factory.id,
          cursor,
        });
        expect(page.items.length).toBeLessThanOrEqual(50);
        all.push(...page.items);
        cursor = page.nextCursor;
      }
      expect(all).toHaveLength(156);
      expect(new Set(all.map((e) => e.id)).size).toBe(156);
      expect(
        all.every(
          (row, index) =>
            index === 0 || BigInt(all[index - 1].id) > BigInt(row.id),
        ),
      ).toBe(true);
      for (const cursor of ["abc", "0", "9999999999999999999"])
        await expect(
          caller(viewer).factories.activity.list({
            factoryId: factory.id,
            cursor,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const error = await db
        .execute(
          sql`update factory_activity set actor_name='Forged' where id=${first.items[0].id}::bigint`,
        )
        .catch((e) => e);
      expect(error.cause?.message ?? error.message).toMatch(/append-only/);
      const removal = await db
        .execute(
          sql`delete from factory_activity where id=${first.items[0].id}::bigint`,
        )
        .catch((e) => e);
      expect(removal.cause?.message ?? removal.message).toMatch(/append-only/);
    });
    it("isolates concurrent actors and releases request transactions before later async work", async () => {
      const [one, two] = await Promise.all([
        create(engineer),
        create(teammate),
      ]);
      const logs = await Promise.all([
        caller(viewer).factories.activity.list({ factoryId: one.id }),
        caller(viewer).factories.activity.list({ factoryId: two.id }),
      ]);
      expect(logs[0].items[0].actorId).toBe(engineer.id);
      expect(logs[1].items[0].actorId).toBe(teammate.id);
      let release!: () => void, later!: Promise<unknown>;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await withMutationActor(engineer, async () => {
        expect(currentRequestDatabase()).toBeTruthy();
        later = gate.then(async () => {
          expect(currentRequestDatabase()).toBeUndefined();
          return (await getDb())!.execute(sql`select 1 as alive`);
        });
      });
      release();
      expect(((await later) as Array<{ alive: number }>)[0].alive).toBe(1);
    });
  },
);
