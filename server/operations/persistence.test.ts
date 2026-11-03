import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { router } from "../_core/trpc";
import { operationsRouter } from "./router";
import { createUser, getDb } from "../db";
import { registerDevice } from "../deviceRegistration";
import { withVisibility } from "../demoData";
import * as visibility from "../demoData";
import * as fixtures from "../demoTarget";
import * as store from "./store";
import { disposableDatabase } from "../test/disposableDatabase";
import {
  defaultOperationsConfiguration,
  resolveShift,
  type OperationsConfiguration,
  type ProductionPeriod,
} from "../../shared/operations";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";

const config: OperationsConfiguration = {
  ...defaultOperationsConfiguration,
  boundaryLabel: "Packaging line",
  energyMeterBoundary: "Packaging line",
  timeZone: "Africa/Harare",
  idealCycleSeconds: 6,
};
const live = <T>(fn: () => Promise<T>) =>
  withVisibility({ demoOnly: false, includeDemo: false }, fn);
const fixtureRouter = router({ operations: operationsRouter });
function caller(role: User["role"], demo = false) {
  const user = {
    id: 42,
    openId: demo ? "demo-operations" : "operations-test",
    email: "operations@example.test",
    name: "Operations reviewer",
    loginMethod: "password",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } satisfies User;
  return fixtureRouter.createCaller({
    user,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  });
}
describe("operations access boundaries", () => {
  beforeEach(() => {
    vi.spyOn(fixtures, "rejectFixtureMutation").mockResolvedValue(undefined);
    vi.spyOn(visibility, "resolveVisibility").mockResolvedValue({
      demoOnly: false,
      includeDemo: false,
    });
    vi.spyOn(store, "configureOperations").mockResolvedValue({ version: 1 });
    vi.spyOn(store, "setOperationsTimeZone").mockResolvedValue({ version: 0 });
    vi.spyOn(store, "addHandover").mockResolvedValue({
      id: 1,
      shiftKey: "day:2026-11-02T04:00:00Z",
    });
  });
  afterEach(() => vi.restoreAllMocks());
  it("limits configuration to engineers and handover to operators", async () => {
    const timezone = {
      expectedVersion: 0,
      expectedTimeZone: "UTC",
      timeZone: "Europe/Berlin",
    };
    await expect(
      caller("viewer").operations.setTimeZone(timezone),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("operator").operations.setTimeZone(timezone),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("engineer").operations.setTimeZone(timezone);
    await expect(
      caller("viewer").operations.configure({
        expectedVersion: 0,
        configuration: config,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("operator").operations.configure({
        expectedVersion: 0,
        configuration: config,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("engineer").operations.configure({
      expectedVersion: 0,
      configuration: config,
    });
    const note = {
      expectedVersion: 1,
      at: Date.now(),
      text: "Current condition checked",
      nextStep: "Inspect the next shift",
      assetRefs: [],
      incidentIds: [],
    };
    await expect(
      caller("viewer").operations.addHandover(note),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("operator").operations.addHandover(note);
    expect(store.addHandover).toHaveBeenCalledTimes(1);
  });
  it("blocks all shared-demo writes even for an administrator identity", async () => {
    await expect(
      caller("admin", true).operations.setTimeZone({
        expectedVersion: 0,
        expectedTimeZone: "UTC",
        timeZone: "Europe/Berlin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.setOperationsTimeZone).not.toHaveBeenCalled();
    await expect(
      caller("admin", true).operations.configure({
        expectedVersion: 0,
        configuration: config,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.configureOperations).not.toHaveBeenCalled();
  });
  it("rejects duplicate linked evidence and unsupported/future windows", async () => {
    await expect(
      caller("engineer").operations.addHandover({
        expectedVersion: 1,
        at: Date.now(),
        text: "Handover",
        nextStep: "Check",
        assetRefs: ["asset:1", "asset:1"],
        incidentIds: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("viewer").operations.summary({
        startTime: 1000,
        endTime: 10 * 86400000,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("viewer").operations.summary({ at: Date.now() + 86400000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "persisted operations evidence",
  () => {
    disposableDatabase("ot_operations");
    it("changes the shared timezone without commissioning provisional shifts, and protects configured changes", async () => {
      const actor = (await createUser({
        openId: "timezone-engineer",
        name: "Timezone engineer",
        role: "engineer",
        email: "timezone@example.test",
      }))!;
      const db = (await getDb())!;
      const factoryId = "5c4220e3-bf04-43c2-af67-a30c7803f562";
      await db.execute(
        sql`insert into factories(id,name,width,depth) values(${factoryId}::uuid,'Timezone line',20,20)`,
      );
      const at = Date.parse("2026-03-29T10:00:00Z");
      const before = await live(() =>
        store.operationsSummary({ factoryId, at }),
      );
      expect(before.configured).toBe(false);
      expect(before.configuration.timeZone).toBe("UTC");
      await live(() =>
        store.setOperationsTimeZone(
          {
            factoryId,
            expectedVersion: 0,
            expectedTimeZone: "UTC",
            timeZone: "Europe/Berlin",
          },
          actor,
        ),
      );
      const provisional = await live(() =>
        store.operationsSummary({ factoryId, at }),
      );
      expect(provisional.configured).toBe(false);
      expect(provisional.version).toBe(0);
      expect(provisional.shift.timeZone).toBe("Europe/Berlin");
      expect(provisional.shift.startTime).not.toBe(before.shift.startTime);
      expect(new Date(provisional.shift.startTime).toISOString()).toBe("2026-03-29T04:00:00.000Z");
      expect(new Date(resolveShift(provisional.configuration, Date.parse("2026-10-25T10:00:00Z")).startTime).toISOString()).toBe("2026-10-25T05:00:00.000Z");
      await expect(
        live(() =>
          store.setOperationsTimeZone(
            {
              factoryId,
              expectedVersion: 0,
              expectedTimeZone: "UTC",
              timeZone: "Africa/Harare",
            },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        live(() =>
          store.configureOperations(
            {
              factoryId,
              expectedVersion: 0,
              expectedTimeZone: "UTC",
              configuration: config,
            },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await live(() =>
        store.configureOperations(
          {
            factoryId,
            expectedVersion: 0,
            expectedTimeZone: "Europe/Berlin",
            configuration: { ...config, timeZone: "Europe/Berlin" },
          },
          actor,
        ),
      );
      await live(() =>
        store.setOperationsTimeZone(
          {
            factoryId,
            expectedVersion: 1,
            expectedTimeZone: "Europe/Berlin",
            timeZone: "Africa/Harare",
          },
          actor,
        ),
      );
      const configured = await live(() =>
        store.operationsSummary({ factoryId, at }),
      );
      expect(configured.configured).toBe(true);
      expect(configured.version).toBe(2);
      expect(configured.configuration).toMatchObject({
        timeZone: "Africa/Harare",
        boundaryLabel: config.boundaryLabel,
        shifts: config.shifts,
      });
      const audit = await db.execute(
        sql`select kind,detail from ot_operations_activity where scope=${factoryId} order by id`,
      );
      expect(audit.map((row: any) => row.kind)).toEqual([
        "timezone",
        "configuration",
        "timezone",
      ]);
      await expect(
        live(() =>
          store.setOperationsTimeZone(
            {
              factoryId,
              expectedVersion: 1,
              expectedTimeZone: "Europe/Berlin",
              timeZone: "UTC",
            },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("persists scoped settings, input periods, handover and actor audit with version/overlap protection", async () => {
      const actor = (await createUser({
        openId: "operations-engineer",
        name: "Operations engineer",
        role: "engineer",
        email: "operations-engineer@example.test",
      }))!;
      const db = (await getDb())!;
      const unknown = "d1912bf2-cb16-4dc2-9cf6-943f83166277";
      await expect(
        live(() =>
          store.configureOperations(
            { factoryId: unknown, expectedVersion: 0, configuration: config },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await live(() =>
        store.configureOperations(
          { expectedVersion: 0, configuration: config },
          actor,
        ),
      );
      await expect(
        live(() =>
          store.configureOperations(
            { expectedVersion: 0, configuration: config },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const at = Date.parse("2026-10-20T10:00:00Z"),
        shift = resolveShift(config, at);
      const period: ProductionPeriod = {
        startTime: shift.startTime,
        endTime: shift.endTime,
        product: "Batch 12",
        totalCount: 4000,
        goodCount: 3900,
        idealCycleSeconds: 6,
        meterStartKwh: 1000,
        meterEndKwh: 1100,
        meterBoundary: config.boundaryLabel,
        complete: true,
        evidence: "Operator shift sheet batch 12",
        downtime: [],
      };
      const saved = await live(() =>
        store.recordProduction({ expectedVersion: 1, period }, actor),
      );
      await expect(
        live(() =>
          store.recordProduction({ expectedVersion: 1, period }, actor),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await live(() =>
        store.addHandover(
          {
            expectedVersion: 1,
            at,
            text: "Recorded pressure drop is under investigation.",
            nextStep: "Inspect compressor and compare pressure history.",
            assetRefs: [],
            incidentIds: [],
          },
          actor,
        ),
      );
      const summary = await live(() => store.operationsSummary({ at }));
      expect(summary.records).toHaveLength(1);
      expect(summary.records[0]).toMatchObject({
        id: saved.id,
        provenance: "manual",
        author: actor.name,
      });
      expect(summary.analysis).toMatchObject({
        coveragePercent: 100,
        totalCount: 4000,
        goodCount: 3900,
      });
      expect(summary.analysis.oee).not.toBeNull();
      expect(summary.notes[0]).toMatchObject({
        text: "Recorded pressure drop is under investigation.",
        author: actor.name,
      });
      const next = await live(() =>
        store.operationsSummary({ at: shift.endTime }),
      );
      expect(next.notes[0].shiftKey).toBe(summary.shift.key);
      const [audit] = await db.execute(
        sql`select count(*)::int as n from ot_operations_activity where actor_id=${actor.id}`,
      );
      expect(Number(audit.n)).toBe(3);
      await expect(
        live(() =>
          store.addHandover(
            {
              expectedVersion: 1,
              at,
              text: "Bad link",
              nextStep: "Check",
              assetRefs: ["asset:999999999"],
              incidentIds: [],
            },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const demo = await withVisibility(
        { demoOnly: true, includeDemo: true },
        () => store.operationsSummary({ scenario: "healthy" }),
      );
      expect(demo.demo).toBe(true);
      expect(demo.records.every((r) => r.provenance === "simulated")).toBe(
        true,
      );
      expect(demo.notes.some((n) => n.author === actor.name)).toBe(false);
    });
    it("isolates named factories, serializes concurrent entries and retains historical shift definitions", async () => {
      const db = (await getDb())!;
      const actor = (await createUser({
        openId: "scoped-operations",
        name: "Scope engineer",
        role: "engineer",
        email: "scoped-operations@example.test",
      }))!;
      const a = "07122ee2-d024-4c43-a757-9a939a0adb95",
        b = "2014e6b9-d940-42d4-b3c7-689e092ec9a8";
      await db.execute(
        sql`insert into factories(id,name,width,depth) values(${a}::uuid,'Operations factory A',20,20),(${b}::uuid,'Operations factory B',20,20)`,
      );
      await live(() =>
        store.configureOperations(
          { factoryId: a, expectedVersion: 0, configuration: config },
          actor,
        ),
      );
      await live(() =>
        store.configureOperations(
          {
            factoryId: b,
            expectedVersion: 0,
            configuration: { ...config, boundaryLabel: "Other line" },
          },
          actor,
        ),
      );
      const at = Date.parse("2026-10-21T10:00:00Z");
      const device = await registerDevice({
        deviceId: "operations-scope-source",
        name: "Scoped operations source",
        type: "sensor",
        route: "direct",
      });
      await db.execute(
        sql`insert into factory_items(ref,factory_id,device_id,origin,inventory_tag,width,depth,height) values(${`device:${device.id}`},${a}::uuid,${device.id},'attached','OT-SCOPE-01',1,1,1)`,
      );
      await live(() =>
        store.addHandover(
          {
            factoryId: a,
            expectedVersion: 1,
            at,
            text: "A-only handover",
            nextStep: "Review next shift",
            assetRefs: [`device:${device.id}`],
            incidentIds: [],
          },
          actor,
        ),
      );
      await expect(
        live(() =>
          store.addHandover(
            {
              factoryId: b,
              expectedVersion: 1,
              at,
              text: "Cross-factory link",
              nextStep: "Review",
              assetRefs: [`device:${device.id}`],
              incidentIds: [],
            },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (await live(() => store.operationsSummary({ factoryId: b, at }))).notes,
      ).toHaveLength(0);
      await live(() =>
        store.configureOperations(
          {
            factoryId: a,
            expectedVersion: 1,
            configuration: { ...config, timeZone: "Europe/Berlin" },
          },
          actor,
        ),
      );
      const changed = await live(() =>
        store.operationsSummary({ factoryId: a, at }),
      );
      expect(changed.notes[0]).toMatchObject({
        text: "A-only handover",
        timeZone: "Africa/Harare",
      });
      expect(changed.configuration.timeZone).toBe("Europe/Berlin");
      const period: ProductionPeriod = {
        startTime: changed.shift.startTime,
        endTime: changed.shift.endTime,
        product: "Scoped batch",
        totalCount: 4000,
        goodCount: 3900,
        idealCycleSeconds: 6,
        meterStartKwh: null,
        meterEndKwh: null,
        meterBoundary: "",
        complete: true,
        evidence: "Isolated period",
        downtime: [],
      };
      const concurrent = await Promise.allSettled(
        [0, 1].map(() =>
          live(() =>
            store.recordProduction(
              { factoryId: a, expectedVersion: 2, period },
              actor,
            ),
          ),
        ),
      );
      expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(concurrent.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(
        (await live(() => store.operationsSummary({ factoryId: b, at })))
          .records,
      ).toHaveLength(0);
      await expect(
        withVisibility({ demoOnly: true, includeDemo: true }, () =>
          store.recordProduction(
            { factoryId: a, expectedVersion: 2, period },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("keeps handover actions aligned with placed equipment acquisition links without moving explicitly attributed incidents", async () => {
      const db = (await getDb())!;
      const actor = (await createUser({
        openId: "handover-linked-source",
        name: "Linked source engineer",
        role: "engineer",
        email: "handover-linked-source@example.test",
      }))!;
      const factoryId = "0f15c8de-40d7-4717-a875-cd4f718e60e3";
      await db.execute(
        sql`insert into factories(id,name,width,depth) values(${factoryId}::uuid,'Linked production line',20,20)`,
      );
      const [placed, other] = await db.execute(
        sql`insert into assets("assetId",name,"assetType","aasShell") values('urn:operations:placed','Placed pump','pump','{}'::json),('urn:operations:other','Other pump','pump','{}'::json) returning id,"assetId"`,
      );
      const source = await registerDevice({
        deviceId: "handover-linked-sensor",
        name: "Linked acquisition source",
        type: "sensor",
        route: "direct",
      });
      await db.execute(
        sql`insert into asset_devices("assetId","deviceId") values(${placed.id},${source.id}),(${other.id},${source.id})`,
      );
      await db.execute(
        sql`insert into factory_items(ref,factory_id,asset_id,origin,inventory_tag,width,depth,height) values(${`asset:${placed.id}`},${factoryId}::uuid,${placed.id},'attached','OT-LINK-01',1,1,1)`,
      );
      const [unattributed, attributedElsewhere] = await db.execute(
        sql`insert into alerts("deviceId","assetId",type,severity,message) values(${source.id},null,'device_offline','warning','Linked source disconnected'),(${source.id},${other.assetId},'threshold_exceeded','warning','Other pump warning') returning id`,
      );
      await db.execute(
        sql`insert into incident_actions(alert_id,title,created_by) values(${unattributed.id},'Check placed pump acquisition source',${actor.id}),(${attributedElsewhere.id},'Check other pump',${actor.id})`,
      );
      await live(() =>
        store.configureOperations(
          { factoryId, expectedVersion: 0, configuration: config },
          actor,
        ),
      );
      const at = Date.parse("2026-10-22T10:00:00Z");
      const summary = await live(() =>
        store.operationsSummary({ factoryId, at }),
      );
      expect(summary.outstanding.map((action) => action.incidentId)).toEqual([
        unattributed.id,
      ]);
      const note = {
        factoryId,
        expectedVersion: 1,
        at,
        text: "Acquisition source requires inspection",
        nextStep: "Verify delivery",
        assetRefs: [],
        incidentIds: [unattributed.id],
      };
      await live(() => store.addHandover(note, actor));
      await expect(
        live(() =>
          store.addHandover(
            { ...note, incidentIds: [attributedElsewhere.id] },
            actor,
          ),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  },
);
