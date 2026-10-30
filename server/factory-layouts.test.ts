import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  factoryLayoutDocument,
  type FactoryLayoutDocument,
} from "../shared/factory-layout";
import { appRouter } from "./routers";
import { closeDatabase, createUser, getDb, type User } from "./db";
import type { TrpcContext } from "./_core/context";

const document: FactoryLayoutDocument = {
  name: "Assembly hall",
  width: 40,
  depth: 30,
  zones: [],
  placements: [],
};
it("validates floor bounds and rejects duplicate items and unresolved zones", () => {
  expect(factoryLayoutDocument.safeParse(document).success).toBe(true);
  expect(
    factoryLayoutDocument.safeParse({ ...document, width: Infinity }).success,
  ).toBe(false);
  expect(
    factoryLayoutDocument.safeParse({
      ...document,
      zones: [
        {
          id: crypto.randomUUID(),
          name: "Outside",
          x: 30,
          z: 0,
          width: 10,
          depth: 5,
        },
      ],
    }).success,
  ).toBe(false);
  const item = { ref: "device:1", x: 0, z: 0, rotation: 0, zoneId: null };
  expect(
    factoryLayoutDocument.safeParse({ ...document, placements: [item, item] })
      .success,
  ).toBe(false);
  expect(
    factoryLayoutDocument.safeParse({
      ...document,
      placements: [{ ...item, zoneId: crypto.randomUUID() }],
    }).success,
  ).toBe(false);
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "owned persistent factory layouts",
  () => {
    const tag = crypto.randomUUID();
    let first: User, second: User, deviceId: number;
    const caller = (user: User) =>
      appRouter.createCaller({
        user,
        req: { headers: { cookie: "smart_factory_data_workspace=live" } },
        res: {},
        visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
      } as unknown as TrpcContext);
    beforeAll(async () => {
      vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
      first = (await createUser({
        openId: `layout-a-${tag}`,
        email: `layout-a-${tag}@test.local`,
        role: "viewer",
      }))!;
      second = (await createUser({
        openId: `layout-b-${tag}`,
        email: `layout-b-${tag}@test.local`,
        role: "viewer",
      }))!;
      const db = (await getDb())!;
      const [row] = await db.execute<{ id: number }>(
        sql`insert into devices("deviceId",name,type) values(${`layout-device-${tag}`},'Layout test equipment','sensor') returning id`,
      );
      deviceId = row.id;
    });
    afterAll(async () => {
      const db = await getDb();
      if (db && first && second) {
        await db.execute(
          sql`delete from factory_layouts where owner_id in (${first.id},${second.id})`,
        );
        await db.execute(sql`delete from devices where id=${deviceId}`);
        await db.execute(
          sql`delete from users where id in (${first.id},${second.id})`,
        );
      }
      vi.unstubAllEnvs();
      await closeDatabase();
    });
    it("creates, reopens, version-checks, archives and restores only the owner's layout", async () => {
      const api = caller(first),
        other = caller(second);
      await expect(
        api.assistant.ask({
          question: "What is the security status?",
          demoContext: {
            name: "Untrusted browser state",
            capturedAt: new Date().toISOString(),
            itemCount: 0,
            assetCount: 0,
            deviceCount: 0,
            openIncidents: 0,
            scenario: "normal",
            items: [],
            incidents: [],
            findings: [],
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const created = await api.factoryLayouts.save({
        expectedVersion: 0,
        document: {
          ...document,
          placements: [
            {
              ref: `device:${deviceId}`,
              x: 1,
              z: 2,
              rotation: 45,
              zoneId: null,
            },
          ],
        },
      });
      expect(created.version).toBe(1);
      expect(
        (await api.factoryLayouts.get({ id: created.id })).document
          .placements[0].rotation,
      ).toBe(45);
      await expect(
        other.factoryLayouts.get({ id: created.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        other.factoryLayouts.save({
          id: created.id,
          expectedVersion: 1,
          document,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        other.factoryLayouts.archive({
          id: created.id,
          expectedVersion: 1,
          archived: true,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const updated = await api.factoryLayouts.save({
        id: created.id,
        expectedVersion: 1,
        document: { ...created.document, name: "Reviewed layout" },
      });
      expect(updated.version).toBe(2);
      await expect(
        api.factoryLayouts.save({
          id: created.id,
          expectedVersion: 1,
          document,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await api.factoryLayouts.get({ id: created.id })).document.name,
      ).toBe("Reviewed layout");
      await expect(
        api.factoryLayouts.save({
          expectedVersion: 0,
          document: {
            ...document,
            placements: [
              {
                ref: "device:2147483647",
                x: 0,
                z: 0,
                rotation: 0,
                zoneId: null,
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const archived = await api.factoryLayouts.archive({
        id: created.id,
        expectedVersion: 2,
        archived: true,
      });
      expect(
        (await api.factoryLayouts.list({ archived: false })).some(
          (l) => l.id === created.id,
        ),
      ).toBe(false);
      expect(
        (await api.factoryLayouts.list({ archived: true })).some(
          (l) => l.id === created.id,
        ),
      ).toBe(true);
      await api.factoryLayouts.archive({
        id: created.id,
        expectedVersion: archived.version,
        archived: false,
      });
      expect(
        (await api.factoryLayouts.list({ archived: false })).some(
          (l) => l.id === created.id,
        ),
      ).toBe(true);
      const shared = caller({ ...first, email: "demo@dev.local" });
      await expect(
        shared.factoryLayouts.save({ expectedVersion: 0, document }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        shared.factoryLayouts.get({ id: created.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  },
);
