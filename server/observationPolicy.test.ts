import { describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { disposableDatabase } from "./test/disposableDatabase";
import {
  registerDevice,
  registerDeviceInput,
  updateCommissioning,
} from "./deviceRegistration";
import {
  getDb,
  ingestTelemetryByDeviceId,
  getDeviceByDeviceId,
  getLatestReading,
  getSensorReadings,
  getAssetTelemetry,
} from "./db";
import {
  assets,
  assetDevices,
  alertThresholds,
  alerts,
  sensorReadings,
} from "../drizzle/schema";
import { inventoryFilter, listInventory } from "./inventory";
import { canonicalUnits, convertMeasurement } from "../shared/measurements";
import { currentSample } from "../shared/measurements";

it("shares the compatible identity and engineering conversion contract", () => {
  for (const id of ["a", "sensor.temp:01", "legacy_01", "sensor-01"])
    expect(
      registerDeviceInput.safeParse({ deviceId: id, name: "Synthetic sensor" })
        .success,
    ).toBe(true);
  for (const id of ["bad/topic", "+", "bad#id", ":starts", "a".repeat(65)])
    expect(
      registerDeviceInput.safeParse({ deviceId: id, name: "Synthetic sensor" })
        .success,
    ).toBe(false);
  expect(convertMeasurement("temperature", 77, "°F")).toBe(25);
  expect(convertMeasurement("power", 1.5, "kW")).toBe(1500);
  expect(convertMeasurement("pressure", 2, "bar")).toBe(200000);
  expect(convertMeasurement("vibration", 0.002, "m/s")).toBe(2);
  expect(() => convertMeasurement("vibration", 2, "g")).toThrow(
    "unsupported_unit",
  );
});
it("does not use current connectivity to relabel an older or simulated measurement as current", () => {
  const now = Date.now(),
    reading = {
      timestamp: now - 1000,
      integration: {
        mode: "live",
        evidence: { eligible: true, validForMs: 30000 },
      },
    };
  expect(currentSample(reading, now)).toBe(true);
  expect(currentSample({ ...reading, timestamp: now - 60000 }, now)).toBe(
    false,
  );
  expect(
    currentSample(
      {
        ...reading,
        integration: { ...reading.integration, mode: "simulated" },
      },
      now,
    ),
  ).toBe(false);
  expect(
    currentSample(
      {
        ...reading,
        integration: {
          mode: "live",
          evidence: { eligible: false, validForMs: 30000 },
        },
      },
      now,
    ),
  ).toBe(false);
});
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "trusted observations in PostgreSQL",
  () => {
    disposableDatabase("observations");
    const provenance = (at: number, extra = {}) => ({
      mode: "live",
      sourceQuality: "good",
      sourceConnection: "online",
      gatewayReceivedAt: new Date(at).toISOString(),
      ...extra,
    });
    it.each([
      ["bad quality", { sourceQuality: "bad" }, -9000],
      ["retained", { retained: true }, -8000],
      ["unverified transport flags", {}, -7500],
      ["late history", {}, -300000],
      ["out of order", {}, -12000],
      [
        "simulation",
        { mode: "simulated", scenarioRunId: "isolated-run" },
        -7000,
      ],
      ["replay", { mode: "replay", replayRunId: "isolated-replay" }, -6000],
      ["unclassified", null, -5000],
      ["future clock skew", {}, 50000],
    ] as const)(
      "stores %s without reviving current state or raising an incident",
      async (_name, extra, offset) => {
        const db = (await getDb())!,
          id = "quality-" + crypto.randomUUID(),
          d = await registerDevice({
            deviceId: id,
            name: "Synthetic quality source",
            type: "sensor",
            route: "direct",
            freshnessSeconds: 30,
          });
        await db.insert(alertThresholds).values({
          deviceId: d.id,
          metric: "temperature",
          unit: "°C",
          maxValue: 50,
        });
        const now = Date.now();
        await ingestTelemetryByDeviceId({
          deviceId: id,
          timestamp: now - 10000,
          temperature: 20,
          units: { temperature: "°C" },
          integration: provenance(now),
        });
        const first = await getDeviceByDeviceId(id);
        await ingestTelemetryByDeviceId({
          deviceId: id,
          timestamp: now + offset,
          temperature: 100,
          units: { temperature: "°C" },
          integration: extra === null ? undefined : provenance(now, extra),
          transportRetainVerified:
            _name === "unverified transport flags" ? false : undefined,
        });
        expect((await getDeviceByDeviceId(id))!.lastSeen).toEqual(
          first!.lastSeen,
        );
        expect(
          await db.select().from(alerts).where(eq(alerts.deviceId, d.id)),
        ).toHaveLength(0);
        const rows = await db
          .select()
          .from(sensorReadings)
          .where(eq(sensorReadings.deviceId, d.id));
        expect(rows).toHaveLength(2);
        if (extra && "sourceQuality" in extra) {
          expect(rows[1].temperature).toBeNull();
          expect(rows[1].measurements?.temperature?.sourceValue).toBe(100);
        }
      },
    );
    it("deduplicates before state mutation and quarantines route mismatches", async () => {
      const db = (await getDb())!,
        d = await registerDevice({
          deviceId: "sensor.temp:01",
          name: "Synthetic direct",
          type: "sensor",
          route: "direct",
          freshnessSeconds: 30,
        }),
        now = Date.now(),
        ingestionId = "a".repeat(64);
      await db.insert(alertThresholds).values({
        deviceId: d.id,
        metric: "temperature",
        unit: "°C",
        maxValue: 50,
      });
      const sample = {
        deviceId: d.deviceId,
        timestamp: now - 1000,
        temperature: 100,
        units: { temperature: "°C" },
        integration: provenance(now),
        ingestionId,
      };
      await ingestTelemetryByDeviceId(sample);
      const state = await getDeviceByDeviceId(d.deviceId);
      expect(
        await ingestTelemetryByDeviceId({ ...sample, gatewayId: "unapproved" }),
      ).toMatchObject({ duplicate: true });
      await expect(
        ingestTelemetryByDeviceId({
          ...sample,
          ingestionId: undefined,
          gatewayId: "unapproved",
        }),
      ).rejects.toMatchObject({ code: "route_mismatch" });
      expect((await getDeviceByDeviceId(d.deviceId))!.metadata).toEqual(
        state!.metadata,
      );
      expect(
        await db.select().from(alerts).where(eq(alerts.deviceId, d.id)),
      ).toHaveLength(1);
      const [row] = await db.execute(
        sql`select count(*)::int as count from telemetry_rejections where device_id=${d.deviceId}`,
      );
      expect(row.count).toBe(1);
    });
    it("quarantines unknown inventory and applies revision checks to commissioning", async () => {
      const now = Date.now();
      await expect(
        ingestTelemetryByDeviceId({
          deviceId: "unregistered-source",
          timestamp: now,
          temperature: 20,
        }),
      ).rejects.toMatchObject({ code: "unknown_device" });
      expect(await getDeviceByDeviceId("unregistered-source")).toBeUndefined();
      const d = await registerDevice({
        deviceId: "legacy_01",
        name: "Legacy reviewed sensor",
        type: "sensor",
        route: "direct",
      });
      const policy = {
        route: "direct" as const,
        maxLatenessSeconds: 60,
        clockSkewSeconds: 20,
        legacyCurrent: true,
        legacyUnits: { temperature: "°C" },
      };
      await updateCommissioning(
        {
          id: d.id,
          expectedRevision: 1,
          policy,
          name: d.name,
          location: null,
          zone: null,
        },
        0,
      );
      await expect(
        updateCommissioning(
          {
            id: d.id,
            expectedRevision: 1,
            policy,
            name: d.name,
            location: null,
            zone: null,
          },
          0,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await ingestTelemetryByDeviceId({
        deviceId: d.deviceId,
        timestamp: now,
        temperature: 25,
      });
      expect((await getLatestReading(d.id))?.integration?.mode).toBe("unknown");
      expect((await getDeviceByDeviceId(d.deviceId))!.lastSeen).not.toBeNull();
      const before = (await getDeviceByDeviceId(d.deviceId))!.lastSeen;
      await ingestTelemetryByDeviceId({
        deviceId: d.deviceId,
        timestamp: now + 1,
        temperature: 100,
        transportRetained: true,
      });
      expect((await getDeviceByDeviceId(d.deviceId))!.lastSeen).toEqual(before);
    });
    it("converts units and selects evidence before latest and bounded full-history aggregation", async () => {
      const db = (await getDb())!,
        d = await registerDevice({
          deviceId: "power:01",
          name: "Synthetic power",
          type: "sensor",
          route: "direct",
        }),
        now = Date.now();
      const [asset] = await db
        .insert(assets)
        .values({
          assetId: "urn:isolated:power",
          name: "Synthetic motor",
          assetType: "motor",
          aasShell: {},
        })
        .returning();
      await db
        .insert(assetDevices)
        .values({ assetId: asset.id, deviceId: d.id, protocol: "mqtt_direct" });
      await ingestTelemetryByDeviceId({
        deviceId: d.deviceId,
        assetId: asset.assetId,
        timestamp: now - 1000,
        power: 1.5,
        units: { power: "kW" },
        integration: provenance(now),
      });
      expect((await getLatestReading(d.id))!.power).toBe(1500);
      expect((await getLatestReading(d.id))!.measurements?.power).toMatchObject(
        {
          sourceValue: 1.5,
          sourceUnit: "kW",
          canonicalUnit: "W",
          conversionVersion: "sf-units-v1",
        },
      );
      await ingestTelemetryByDeviceId({
        deviceId: d.deviceId,
        assetId: asset.assetId,
        timestamp: now - 500,
        power: 999,
        units: { power: "W" },
        integration: provenance(now, {
          mode: "simulated",
          scenarioRunId: "isolated-run",
        }),
      });
      expect(
        (
          await listInventory(
            inventoryFilter.parse({ search: d.deviceId, mode: "live" }),
          )
        ).items[0].sampleAt,
      ).toBe(now - 1000);
      expect(
        (
          await listInventory(
            inventoryFilter.parse({ search: d.deviceId, mode: "simulated" }),
          )
        ).items[0].sampleAt,
      ).toBe(now - 500);
      const base = now - 300000000;
      await db.execute(
        sql`insert into sensor_readings("deviceId","assetId",timestamp,power,integration,measurements) select ${d.id},${asset.assetId},${base}::bigint+n::bigint*1000,10,'{"mode":"live"}'::jsonb,'{"power":{"canonicalUnit":"W","conversionVersion":"sf-units-v1","quality":"good"}}'::jsonb from generate_series(0,200500) n`,
      );
      const result = await getAssetTelemetry(
        [asset.assetId],
        base,
        now - 2000,
        60000,
        "live",
      );
      expect(result.overall.sampleCount).toBe(200501);
      expect(result.overall.avgPower).toBe(10);
      expect(result.timeline.length).toBeLessThanOrEqual(601);
      expect(result.metadata.truncated).toBe(false);
      expect(result.assets[0].sampleCount).toBe(200501);
      expect(
        (
          await getAssetTelemetry(
            [asset.assetId],
            base,
            now,
            60000,
            "simulated",
          )
        ).overall.avgPower,
      ).toBe(999);
    }, 20000);
    it("provides complete report statistics and finds incidents beyond the first 500 rows", async () => {
      const db = (await getDb())!,
        device = await registerDevice({
          deviceId: "report:01",
          name: "Synthetic report source",
          type: "sensor",
          route: "direct",
        }),
        now = Date.now();
      await db.execute(
        sql`insert into sensor_readings("deviceId",timestamp,power,integration,measurements) select ${device.id},${now}::bigint-1000-n,10,'{"mode":"live"}'::jsonb,'{"power":{"canonicalUnit":"W","conversionVersion":"sf-units-v1","quality":"good"}}'::jsonb from generate_series(0,1200) n`,
      );
      const { deviceReadingSummary } = await import("./reporting"),
        { getAlertPage } = await import("./db"),
        { appRouter } = await import("./routers");
      await db.execute(
        sql`insert into alerts("deviceId",type,severity,status,message,"createdAt") select ${device.id},'system_error','warning','active',case when n=1200 then 'older incident needle' else 'Synthetic process event' end,to_timestamp(${now}::double precision/1000)-interval '1 second'-n*interval '1 minute' from generate_series(0,1200) n`,
      );
      const search = await getAlertPage(
        { deviceId: device.id, search: "older incident needle" },
        0,
        25,
      );
      expect(search.total).toBe(1);
      expect(search.items[0].message).toBe("older incident needle");
      const page = await getAlertPage({ deviceId: device.id }, 0, 25);
      expect(page.total).toBe(1201);
      expect(page.returned).toBe(25);
      expect(page.hasMore).toBe(true);
      expect(page.truncated).toBe(false);
      const summary = await deviceReadingSummary(
        device.id,
        now - 400000000,
        now,
        "live",
      );
      expect(summary.total).toBe(1201);
      expect(summary.statisticsComplete).toBe(true);
      expect(summary.metrics.power!.count).toBe(1201);
      const caller = appRouter.createCaller({
        user: {
          id: 99,
          openId: "individual-report-reader",
          email: "reader@example.test",
          role: "viewer",
        },
        req: {},
        res: {},
      } as any);
      const report = await caller.export.deviceReport({
        deviceId: device.id,
        startTime: now - 400000000,
        endTime: now,
        scope: "live",
      });
      expect(report.metadata).toMatchObject({
        totalReadings: 1201,
        totalIncidents: 1201,
        returnedIncidents: 100,
        truncated: true,
        statisticsComplete: true,
        scope: "live",
      });
      expect(report.html).toContain("1201 readings");
      expect(report.html).toContain("1201 total in period");
      const history = await caller.export.alertHistoryReport({
        startTime: now - 400000000,
        endTime: now,
        search: "older incident needle",
      });
      expect(history.metadata.total).toBe(1);
      expect(history.html).toContain("older incident needle");
    }, 20000);

    it("verifies reviewed scaling and retains conversion evidence for trends and thresholds", async () => {
      const db = (await getDb())!,
        d = await registerDevice({
          deviceId: "mapped:01",
          name: "Synthetic mapped power",
          type: "sensor",
          route: "direct",
          freshnessSeconds: 30,
        }),
        now = Date.now();
      const [asset] = await db
        .insert(assets)
        .values({
          assetId: "urn:isolated:mapped",
          name: "Synthetic scaled motor",
          assetType: "motor",
          aasShell: {},
        })
        .returning();
      await db.insert(assetDevices).values({
        assetId: asset.id,
        deviceId: d.id,
        protocol: "mqtt_direct",
        tagMappings: [
          {
            metric: "power",
            unit: "kW",
            scale: 0.1,
            offset: 0,
            tag: "power",
          },
        ] as any,
      });
      await db
        .insert(alertThresholds)
        .values({ deviceId: d.id, metric: "power", unit: "W", maxValue: 1000 });
      const sample = {
        deviceId: d.deviceId,
        assetId: asset.assetId,
        timestamp: now - 1000,
        power: 1.5,
        units: { power: "kW" },
        integration: provenance(now),
      };
      await expect(ingestTelemetryByDeviceId(sample)).rejects.toMatchObject({
        code: "mapping_evidence_missing",
      });
      await expect(
        ingestTelemetryByDeviceId({
          ...sample,
          mapping: {
            power: {
              rawValue: 15,
              rawUnit: "register",
              scale: 1,
              offset: 0,
              version: "sf-mapping-v1",
            },
          },
        }),
      ).rejects.toMatchObject({ code: "mapping_arithmetic_mismatch" });
      await ingestTelemetryByDeviceId({
        ...sample,
        mapping: {
          power: {
            rawValue: 15,
            rawUnit: "register",
            scale: 0.1,
            offset: 0,
            version: "sf-mapping-v1",
          },
        },
      });
      const latest = await getLatestReading(d.id);
      expect(latest!.measurements!.power).toMatchObject({
        sourceValue: 1.5,
        sourceUnit: "kW",
        canonicalValue: 1500,
        mapping: { rawValue: 15, scale: 0.1 },
        reviewedMapping: { aasVersion: asset.aasVersion },
      });
      expect(
        await db.select().from(alerts).where(eq(alerts.deviceId, d.id)),
      ).toHaveLength(1);
      const { observationTrend } = await import("./trends");
      const trend = await observationTrend({
        deviceId: d.id,
        metric: "power",
        startTime: now - 120000,
        endTime: now,
        scope: "live",
      });
      expect(trend.total).toBe(1);
      expect(trend.summary).toMatchObject({
        min: 1500,
        max: 1500,
        latest: 1500,
      });
      expect(trend.buckets.some((b) => b.value === null)).toBe(true);
      expect(trend.buckets.filter((b) => b.value !== null)).toHaveLength(1);
    });
    it("retains gateway delivery history without treating old, retained or future heartbeats as current", async () => {
      const { recordDeviceHeartbeat } = await import("./db"),
        db = (await getDb())!,
        d = await registerDevice({
          deviceId: "heartbeat:01",
          name: "Synthetic gateway",
          type: "gateway",
          route: "direct",
          freshnessSeconds: 30,
        }),
        now = Date.now();
      await recordDeviceHeartbeat({
        deviceId: d.deviceId,
        timestamp: now - 1000,
        status: "online",
      });
      const original = (await getDeviceByDeviceId(d.deviceId))!;
      for (const input of [
        { timestamp: now - 300000, status: "offline" as const },
        { timestamp: now, status: "offline" as const, transportRetained: true },
        { timestamp: now + 50000, status: "online" as const },
      ])
        expect(
          await recordDeviceHeartbeat({ deviceId: d.deviceId, ...input }),
        ).toBe(true);
      expect((await getDeviceByDeviceId(d.deviceId))!.lastSeen).toEqual(
        original.lastSeen,
      );
      expect((await getDeviceByDeviceId(d.deviceId))!.status).toBe("online");
      const [row] = await db.execute(
        sql`select count(*)::int as total,count(*) filter(where current_eligible)::int as eligible from gateway_observations where device_id=${d.id}`,
      );
      expect(row).toMatchObject({ total: 4, eligible: 1 });
    });
    it("persists append-only review decisions and owner-scoped paginated notifications", async () => {
      const { createUser, assignAlert, acknowledgeAlert } =
          await import("./db"),
        { incidentHistory, addIncidentNote } = await import("./incidents"),
        { notificationPage, readNotification } =
          await import("./notifications");
      const db = (await getDb())!,
        d = await registerDevice({
          deviceId: "review:01",
          name: "Synthetic investigation source",
          type: "sensor",
          route: "direct",
        }),
        a = (await createUser({
          openId: "investigator-01",
          name: "Synthetic reviewer",
          email: "investigator@example.test",
          role: "engineer",
        }))!,
        other = (await createUser({
          openId: "investigator-02",
          name: "Another reviewer",
          email: "another@example.test",
          role: "viewer",
        }))!;
      const [incident] = await db
        .insert(alerts)
        .values({
          deviceId: d.id,
          type: "system_error",
          severity: "warning",
          message: "Synthetic review event",
        })
        .returning();
      await assignAlert(incident.id, a.id, a.id);
      await acknowledgeAlert(incident.id, a.id);
      await addIncidentNote(
        incident.id,
        "Reviewed the recorded source evidence; awaiting inspection.",
        a.id,
      );
      const history = await incidentHistory(incident.id);
      expect(history.items.map((r) => r.kind)).toEqual([
        "note",
        "acknowledged",
        "assigned",
      ]);
      expect(history.items[0].detail.text).toContain("awaiting inspection");
      await db.execute(
        sql`insert into notification_inbox("userId","alertId",kind,title,body) select ${a.id},${incident.id},'incident',case when n=0 then 'older update needle' else 'Synthetic update' end,'Isolated review notification' from generate_series(0,100) n`,
      );
      const page = await notificationPage(a.id, { search: "Synthetic update" });
      expect(page.returned).toBe(25);
      expect(page.total).toBe(100);
      expect(page.hasMore).toBe(true);
      expect(
        (await notificationPage(a.id, { search: "older update needle" })).total,
      ).toBe(1);
      expect(
        (await notificationPage(other.id, { search: "older update needle" }))
          .total,
      ).toBe(0);
      expect(
        await readNotification(other.id, page.items[0].id),
      ).toBeUndefined();
    });
  },
);
