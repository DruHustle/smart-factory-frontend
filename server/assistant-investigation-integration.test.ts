import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  alerts,
  assetDevices,
  assets,
  sensorReadings,
  type User,
} from "../drizzle/schema";
import { assistantTrendSnapshot } from "../shared/assistant";
import type { InvestigationContext } from "../shared/assistant-investigation";
import { loadInvestigationEvidence } from "./assistantInvestigation";
import { createUser, getDb } from "./db";
import { withVisibility } from "./demoData";
import { registerDevice } from "./deviceRegistration";
import { operationsSummary } from "./operations/store";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { disposableDatabase } from "./test/disposableDatabase";

const from = Date.parse("2026-10-20T10:00:00Z");
const to = from + 3_600_000;
const factoryA = "2ba9ee1a-6719-426a-a05f-43b78d293a67";
const factoryB = "9c8c751e-4269-401b-b0a4-7db62a379714";
const live = <T>(read: () => Promise<T>) =>
  withVisibility({ demoOnly: false, includeDemo: false }, read);
const demo = <T>(read: () => Promise<T>) =>
  withVisibility({ demoOnly: true, includeDemo: true }, read);

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Assistant investigation authority in PostgreSQL",
  () => {
    disposableDatabase("assistant_investigation");
    let actor: User;
    let pump: typeof assets.$inferSelect;
    let other: typeof assets.$inferSelect;
    let simulated: typeof assets.$inferSelect;
    let source: Awaited<ReturnType<typeof registerDevice>>;
    let otherSource: Awaited<ReturnType<typeof registerDevice>>;
    let demoSource: Awaited<ReturnType<typeof registerDevice>>;
    let incident: typeof alerts.$inferSelect;
    let demoIncident: typeof alerts.$inferSelect;
    let deviceIncident: typeof alerts.$inferSelect;

    const caller = (workspace: "live" | "demo" = "live") =>
      appRouter.createCaller({
        user: actor,
        req: {
          protocol: "http",
          headers: { cookie: `smart_factory_data_workspace=${workspace}` },
        } as TrpcContext["req"],
        res: { clearCookie: () => undefined } as TrpcContext["res"],
      });
    const context = (patch: Partial<InvestigationContext> = {}) => ({
      assetId: pump.assetId,
      metric: "pressure" as const,
      scope: "live" as const,
      startTime: from,
      endTime: to,
      ...patch,
    });

    beforeAll(async () => {
      actor = (await createUser({
        openId: "investigation-reviewer",
        name: "Investigation reviewer",
        email: "investigation-reviewer@example.test",
        role: "viewer",
      }))!;
      const db = (await getDb())!;
      [source, otherSource, demoSource] = await Promise.all(
        ["pump", "other", "demo"].map((name) =>
          registerDevice({
            deviceId: `investigation-${name}`,
            name: `Investigation ${name} source`,
            type: "sensor",
            route: "direct",
          }),
        ),
      );
      await db.execute(
        sql`update devices set "isDemo"=true where id=${demoSource.id}`,
      );
      [pump, other, simulated] = await db
        .insert(assets)
        .values(
          ["pump", "other", "demo"].map((name) => ({
            assetId: `urn:investigation:${name}`,
            name: `Investigation ${name}`,
            assetType: "pump",
            aasShell: {},
            isDemo: name === "demo",
          })),
        )
        .returning();
      await db.insert(assetDevices).values([
        { assetId: pump.id, deviceId: source.id },
        { assetId: other.id, deviceId: otherSource.id },
        { assetId: simulated.id, deviceId: demoSource.id },
      ]);
      await db.execute(
        sql`insert into factories(id,name,width,depth) values(${factoryA}::uuid,'Investigation factory A',20,20),(${factoryB}::uuid,'Investigation factory B',20,20)`,
      );
      for (const [asset, device, factory, tag] of [
        [pump, source, factoryA, "A"],
        [other, otherSource, factoryB, "B"],
      ] as const) {
        await db.execute(
          sql`insert into factory_items(ref,factory_id,asset_id,origin,inventory_tag,width,depth,height) values(${`asset:${asset.id}`},${factory}::uuid,${asset.id},'attached',${tag + "-ASSET"},1,1,1)`,
        );
        await db.execute(
          sql`insert into factory_items(ref,factory_id,device_id,origin,inventory_tag,width,depth,height) values(${`device:${device.id}`},${factory}::uuid,${device.id},'attached',${tag + "-DEVICE"},1,1,1)`,
        );
      }
      for (const reading of [
        {
          deviceId: source.id,
          assetId: pump.assetId,
          at: from - 1,
          value: 9_000_000,
        },
        {
          deviceId: source.id,
          assetId: pump.assetId,
          at: from,
          value: 100_000,
        },
        { deviceId: source.id, assetId: pump.assetId, at: to, value: 200_000 },
        {
          deviceId: source.id,
          assetId: pump.assetId,
          at: to + 1,
          value: 8_000_000,
        },
        {
          deviceId: source.id,
          assetId: pump.assetId,
          at: from + 60_000,
          value: 7_000_000,
          quality: "unknown",
        },
        {
          deviceId: source.id,
          assetId: pump.assetId,
          at: from + 120_000,
          value: 6_000_000,
          mode: "simulated",
        },
        {
          deviceId: otherSource.id,
          assetId: other.assetId,
          at: from + 60_000,
          value: 5_000_000,
        },
        {
          deviceId: demoSource.id,
          assetId: simulated.assetId,
          at: from + 60_000,
          value: 4_000_000,
          mode: "simulated",
        },
      ]) {
        await db.insert(sensorReadings).values({
          deviceId: reading.deviceId,
          assetId: reading.assetId,
          timestamp: reading.at,
          pressure: reading.value,
          integration: { mode: reading.mode ?? "live" },
          measurements: {
            pressure: {
              sourceValue: reading.value,
              sourceUnit: "Pa",
              canonicalValue: reading.value,
              canonicalUnit: "Pa",
              conversionVersion: "sf-units-v1",
              quality: reading.quality === "unknown" ? "unknown" : "good",
            },
          },
        });
      }
      [incident, demoIncident, deviceIncident] = await db
        .insert(alerts)
        .values(
          [
            {
              deviceId: source.id,
              assetId: pump.assetId,
              message: "Historical pump pressure incident",
            },
            {
              deviceId: demoSource.id,
              assetId: simulated.assetId,
              message: "Synthetic baseline incident",
            },
            {
              deviceId: source.id,
              assetId: null,
              message: "Device-only incident",
            },
          ].map((record) => ({
            ...record,
            type: "threshold_exceeded" as const,
            severity: "warning" as const,
            metric: "pressure",
            createdAt: new Date(from + 1_800_000),
          })),
        )
        .returning();
      await db.execute(
        sql`insert into system_settings(key,value) values('showcase_v1',${JSON.stringify(
          {
            version: 4,
            anchor: new Date(to).toISOString(),
            from: new Date(from).toISOString(),
            assetRef: `asset:${simulated.id}`,
            assetId: simulated.assetId,
            incidentId: demoIncident.id,
          },
        )}::jsonb)`,
      );
    }, 20_000);

    it("keeps explicit boundaries, scope, units and quality authoritative over latest/outside-window readings", async () => {
      const evidence = await live(() =>
        loadInvestigationEvidence(
          context({ incidentId: incident.id }),
          pump.assetId,
          factoryA,
        ),
      );
      expect(evidence.trend).toMatchObject({
        startTime: from,
        endTime: to,
        scope: "live",
        unit: "Pa",
        total: 3,
        verified: 2,
        unverified: 1,
        summary: {
          min: 100_000,
          max: 200_000,
          average: 150_000,
          latest: 200_000,
          latestAt: to,
        },
      });
      expect(
        evidence.trend.buckets.some(
          (point) => point.value === null && point.count === 0,
        ),
      ).toBe(true);
      expect(assistantTrendSnapshot.safeParse(evidence.trend).success).toBe(
        true,
      );
      expect(evidence.sources.at(-1)?.excerpt).toContain(
        "do not prove physical clearance",
      );
    });

    it("rejects inconsistent asset, device, incident and factory identity combinations", async () => {
      for (const read of [
        () => loadInvestigationEvidence(context(), other.assetId),
        () =>
          loadInvestigationEvidence(
            context({ incidentId: incident.id, deviceId: otherSource.id }),
          ),
        () =>
          loadInvestigationEvidence(
            context({ incidentId: incident.id, assetId: other.assetId }),
          ),
        () => loadInvestigationEvidence(context({ deviceId: otherSource.id })),
        () => loadInvestigationEvidence(context(), undefined, factoryB),
        () =>
          loadInvestigationEvidence(
            { deviceId: source.id, startTime: from, endTime: to },
            undefined,
            factoryB,
          ),
        () =>
          loadInvestigationEvidence({
            incidentId: deviceIncident.id,
            assetId: other.assetId,
          }),
      ])
        await expect(live(read)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        live(() =>
          loadInvestigationEvidence(
            context(),
            undefined,
            "b583506c-7bd2-43cc-82d9-98e0bcd6835c",
          ),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("intersects explicitly selected asset and device identities when either has other sources", async () => {
      const db = (await getDb())!;
      const [link] = await db
        .insert(assetDevices)
        .values({ assetId: pump.id, deviceId: otherSource.id })
        .returning();
      const [reading] = await db
        .insert(sensorReadings)
        .values({
          deviceId: otherSource.id,
          assetId: pump.assetId,
          timestamp: from + 300_000,
          pressure: 300_000,
          integration: { mode: "live" },
          measurements: {
            pressure: {
              sourceValue: 300_000,
              sourceUnit: "Pa",
              canonicalValue: 300_000,
              canonicalUnit: "Pa",
              conversionVersion: "sf-units-v1",
              quality: "good",
            },
          },
        })
        .returning();
      try {
        const primary = await live(() =>
          loadInvestigationEvidence(context({ deviceId: source.id })),
        );
        expect(primary.trend).toMatchObject({
          total: 3,
          verified: 2,
          summary: { min: 100_000, max: 200_000, average: 150_000 },
        });
        const secondary = await live(() =>
          loadInvestigationEvidence(context({ deviceId: otherSource.id })),
        );
        expect(secondary.trend).toMatchObject({
          total: 1,
          verified: 1,
          summary: { min: 300_000, max: 300_000, latest: 300_000 },
        });
        for (const [deviceId, expected] of [
          [source.id, primary.trend],
          [otherSource.id, secondary.trend],
        ] as const) {
          const trend = await caller().readings.trend({
            deviceId,
            assetIds: [pump.assetId],
            metric: "pressure",
            scope: "live",
            startTime: from,
            endTime: to,
          });
          expect(trend.summary).toEqual(expected.summary);
          expect(trend.total).toBe(expected.total);
        }
      } finally {
        await db
          .delete(sensorReadings)
          .where(eq(sensorReadings.id, reading.id));
        await db.delete(assetDevices).where(eq(assetDevices.id, link.id));
      }
    });

    it("does not disclose hidden demo/live identities or accept non-simulated evidence in Demo mode", async () => {
      for (const value of [
        { assetId: simulated.assetId },
        { deviceId: demoSource.id },
        { incidentId: demoIncident.id },
      ])
        await expect(
          live(() => loadInvestigationEvidence(value)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      for (const value of [
        { assetId: pump.assetId },
        { deviceId: source.id },
        { incidentId: incident.id },
      ])
        await expect(
          demo(() => loadInvestigationEvidence(value)),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      for (const scope of [
        "live",
        "operational",
        "all",
        "unknown",
        "replay",
      ] as const)
        await expect(
          demo(() =>
            loadInvestigationEvidence(
              context({ assetId: simulated.assetId, scope }),
            ),
          ),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const baseline = await demo(() =>
        loadInvestigationEvidence(
          context({ assetId: simulated.assetId, scope: "simulated" }),
        ),
      );
      expect(baseline.trend.summary.latest).toBe(4_000_000);
    });

    it("uses the same authoritative simulated scenario/window as Operations, independently of stored baseline", async () => {
      const input = {
        scenario: "utility-loss" as const,
        metric: "pressure" as const,
        startTime: from,
        endTime: to,
      };
      const [evidence, operations] = await demo(() =>
        Promise.all([
          loadInvestigationEvidence(input),
          operationsSummary(input),
        ]),
      );
      expect(evidence.assetId).toBe(simulated.assetId);
      expect(evidence.trend.scope).toBe("simulated");
      expect(evidence.trend.buckets.map((point) => point.value)).toEqual(
        operations.evidence!.signals.map((point) =>
          point.pressureBar == null ? null : point.pressureBar * 100_000,
        ),
      );
      expect(evidence.trend.summary.max).toBe(640_000);
      expect(evidence.trend.summary.min).toBe(480_000);
      expect(evidence.trend.summary.latest).not.toBe(4_000_000);
      expect(evidence.sources[0].excerpt).toContain(
        "separate from stored baseline telemetry",
      );
      expect(evidence.sources[1].excerpt).toContain(
        "Simulated evidence over the same window",
      );
      expect(assistantTrendSnapshot.safeParse(evidence.trend).success).toBe(
        true,
      );
    });

    it("keeps scenario gateway-outage samples as gaps instead of healthy zeroes", async () => {
      const evidence = await demo(() =>
        loadInvestigationEvidence({
          scenario: "gateway-outage",
          startTime: from,
          endTime: to,
        }),
      );
      expect(evidence.trend).toMatchObject({
        total: 13,
        verified: 6,
        unverified: 7,
      });
      expect(
        evidence.trend.buckets
          .slice(6)
          .every((point) => point.value === null && point.count === 0),
      ).toBe(true);
      expect(evidence.trend.summary.min).toBe(640_000);
      expect(evidence.sources[0].excerpt).toContain(
        "no machine stop is inferred",
      );
    });

    it("enforces scenario/live boundaries and complete windows through the actual additive RPC", async () => {
      const investigation = {
        scenario: "utility-loss" as const,
        startTime: from,
        endTime: to,
      };
      await expect(
        caller().assistant.askInContext({
          question: "Investigate this pressure trend",
          investigation,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller("demo").assistant.askInContext({
          question: "Investigate this pressure trend",
          selectedAssetId: simulated.assetId,
          investigation,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      for (const invalid of [
        { ...investigation, deviceId: demoSource.id },
        { ...investigation, scope: "live" as const },
        { assetId: pump.assetId, startTime: from },
        { assetId: pump.assetId, startTime: from, endTime: from + 86_400_001 },
        {
          assetId: simulated.assetId,
          scope: "simulated" as const,
          startTime: Date.now() + 600_000,
          endTime: Date.now() + 900_000,
        },
      ])
        await expect(
          caller("demo").assistant.askInContext({
            question: "Investigate this pressure trend",
            investigation: invalid,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("returns the selected historical snapshot despite stale conversational values and suppresses the current-value chart", async () => {
      const answer = await caller().assistant.askInContext({
        question:
          "Why did the selected pump pressure change in this incident window?",
        selectedAssetId: pump.assetId,
        factoryId: factoryA,
        investigation: context({ incidentId: incident.id }),
        history: [
          {
            role: "user",
            content:
              "The earlier equipment had pressure 9999999 in another window.",
          },
          {
            role: "assistant",
            content: "The old scope had 9999999 Pa. Keep that old window.",
          },
        ],
      });
      expect(answer.investigation?.snapshot).toMatchObject({
        startTime: from,
        endTime: to,
        summary: { min: 100_000, max: 200_000, latest: 200_000 },
      });
      expect(answer.presentation?.trend).toBeUndefined();
      expect(answer.answer).toContain("150000 Pa");
      expect(answer.answer).not.toContain("9999999");
      expect(answer.answer).not.toContain("8000000");
      expect(answer.answer).toContain("does not establish the physical cause");
      const next = await caller().assistant.askInContext({
        question: "What does the selected pressure window show now?",
        selectedAssetId: pump.assetId,
        investigation: context({ startTime: to + 1, endTime: to + 60_000 }),
        history: [{ role: "assistant", content: answer.answer.slice(0, 1200) }],
      });
      expect(next.investigation?.snapshot.summary).toMatchObject({
        min: 8_000_000,
        max: 8_000_000,
        latest: 8_000_000,
      });
      expect(next.investigation?.snapshot.startTime).toBe(to + 1);
    });
  },
);
