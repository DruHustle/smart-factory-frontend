import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { alerts, alertThresholds, sensorReadings } from "../drizzle/schema";
import {
  projectAlarmCondition,
  type AlarmConditionEvidence,
  type ThresholdConfiguration,
} from "../shared/alarm-condition";
import { currentSample, sampleValidity } from "../shared/measurements";
import { commissioningInput, currentObservation } from "./observationPolicy";
import { registerDevice } from "./deviceRegistration";
import {
  acknowledgeAlert,
  createUser,
  getAlertById,
  getAlertPage,
  getAlertStats,
  getAlerts,
  getDb,
  getDeviceByDeviceId,
  getLatestReading,
  ingestTelemetryByDeviceId,
  recordDeviceHeartbeat,
  resolveAlert,
} from "./db";
import { disposableDatabase } from "./test/disposableDatabase";
import { inventoryItemsByRefs } from "./inventory";

const rule: ThresholdConfiguration = {
  id: 1,
  deviceId: 1,
  metric: "temperature",
  unit: "°C",
  minValue: null,
  maxValue: 50,
  warningMin: null,
  warningMax: 40,
  enabled: true,
};
const now = Date.UTC(2026, 10, 2, 15);
const evidence: AlarmConditionEvidence = {
  readingId: 1,
  occurredAt: now - 1000,
  receivedAt: new Date(now).toISOString(),
  sourceDeviceId: "sensor",
  gatewayId: null,
  mode: "live",
  metric: "temperature",
  value: 60,
  unit: "°C",
  commissioningRevision: 1,
  acquisitionMode: "cyclic",
  thresholdConfiguration: rule,
  measurement: {
    sourceValue: 60,
    sourceUnit: "°C",
    canonicalValue: 60,
    canonicalUnit: "°C",
    conversionVersion: "sf-units-v1",
    quality: "good",
  },
};

describe("independent alarm condition semantics", () => {
  it("keeps acknowledgement independent of verified active/cleared and review resolution", () => {
    for (const sourceCondition of ["active", "cleared"] as const)
      for (const acknowledged of [false, true]) {
        const result = projectAlarmCondition(
          {
            sourceCondition,
            conditionEvidence: evidence,
            conditionObservedAt: new Date(now - 1000),
            conditionValidUntil: new Date(now + 10000),
            status: "resolved",
            acknowledgedAt: acknowledged ? new Date(now) : null,
          },
          rule,
          1,
          now,
        );
        expect(result.currentCondition).toBe(sourceCondition);
        expect(result.alarmState).toBe(
          `${sourceCondition}_${acknowledged ? "acknowledged" : "unacknowledged"}`,
        );
      }
    expect(
      projectAlarmCondition({ status: "resolved" }, rule, 1, now),
    ).toMatchObject({
      sourceCondition: "unknown",
      currentCondition: "unknown",
      conditionReason: "not_verified",
    });
  });

  it("retains historical evidence while exposing expiry, changed rules and invalid source data", () => {
    const alarm = {
      sourceCondition: "active" as const,
      conditionEvidence: evidence,
      conditionObservedAt: new Date(now - 1000),
      conditionValidUntil: new Date(now + 10000),
    };
    expect(projectAlarmCondition(alarm, rule, 1, now + 20000)).toMatchObject({
      sourceCondition: "active",
      currentCondition: "unknown",
      conditionReason: "sample_expired",
    });
    expect(
      projectAlarmCondition(alarm, { ...rule, maxValue: 100 }, 1, now)
        .conditionReason,
    ).toBe("configuration_changed");
    expect(projectAlarmCondition(alarm, rule, 2, now).conditionReason).toBe(
      "commissioning_changed",
    );
    expect(
      projectAlarmCondition(
        {
          ...alarm,
          lastObservedAt: new Date(now),
        },
        rule,
        1,
        now,
      ),
    ).toMatchObject({
      sourceCondition: "active",
      currentCondition: "unknown",
      conditionReason: "newer_evidence_unverified",
    });
    expect(
      projectAlarmCondition(
        { ...alarm, conditionInvalidReason: "source_quality" },
        rule,
        1,
        now,
      ),
    ).toMatchObject({
      sourceCondition: "active",
      currentCondition: "unknown",
      conditionReason: "source_quality",
    });
  });

  it("requires an explicit bounded on-change policy and preserves the real sample age", () => {
    expect(
      commissioningInput.safeParse({
        route: "direct",
        acquisitionMode: "on_change",
      }).success,
    ).toBe(false);
    expect(
      commissioningInput.safeParse({
        route: "direct",
        acquisitionMode: "on_change",
        valueValiditySeconds: 86401,
      }).success,
    ).toBe(false);
    const policy = {
      ...commissioningInput.parse({
        route: "direct",
        freshnessSeconds: 5,
        acquisitionMode: "on_change",
        valueValiditySeconds: 600,
      }),
      revision: 1,
      reviewedAt: new Date(now).toISOString(),
      reviewedBy: 1,
    };
    const sample = {
      timestamp: now,
      integration: {
        mode: "live",
        sourceQuality: "good",
        sourceConnection: "online",
        gatewayReceivedAt: new Date(now).toISOString(),
      },
    };
    const eligibility = currentObservation(sample, policy, null, now);
    const reading = {
      ...sample,
      integration: { ...sample.integration, evidence: eligibility },
    };
    expect(sampleValidity(reading, now + 300000)).toMatchObject({
      state: "held",
      sampleAt: now,
      ageMs: 300000,
      validForMs: 600000,
    });
    expect(currentSample(reading, now + 300000)).toBe(true);
    expect(currentSample(reading, now + 600001)).toBe(false);
    // A recent communication timestamp cannot extend the source sample's age.
    expect(
      currentSample(
        {
          ...reading,
          integration: {
            ...reading.integration,
            gatewayReceivedAt: new Date(now + 600001).toISOString(),
          },
        },
        now + 600001,
      ),
    ).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "verified alarm transitions in PostgreSQL",
  () => {
    disposableDatabase("alarm_condition");

    async function source(
      name: string,
      options: { gateway?: boolean; onChange?: boolean } = {},
    ) {
      const device = await registerDevice({
        deviceId: `condition-${name}`,
        name: `Condition ${name}`,
        type: options.gateway ? "gateway" : "sensor",
        route: "direct",
        freshnessSeconds: 30,
        ...(options.onChange
          ? { acquisitionMode: "on_change" as const, valueValiditySeconds: 600 }
          : {}),
      });
      const db = (await getDb())!;
      const [threshold] = await db
        .insert(alertThresholds)
        .values({
          deviceId: device.id,
          metric: "temperature",
          unit: "°C",
          maxValue: 50,
        })
        .returning();
      return { device, threshold };
    }
    function observe(
      deviceId: string,
      timestamp: number,
      temperature: number | null,
      extra = {},
    ) {
      return ingestTelemetryByDeviceId({
        deviceId,
        timestamp,
        temperature,
        units: { temperature: "°C" },
        transportRetainVerified: true,
        integration: {
          mode: "live",
          sourceQuality: "good",
          sourceConnection: "online",
          gatewayReceivedAt: new Date(Date.now()).toISOString(),
        },
        ...extra,
      });
    }

    it("records all four states and starts a separate event when a cleared source breaches again", async () => {
      const { device } = await source("lifecycle"),
        at = Date.now() - 10000;
      const actor = (await createUser({
        openId: "condition-engineer",
        name: "Condition engineer",
        email: "condition-engineer@example.test",
        role: "engineer",
      }))!;
      await observe(device.deviceId, at, 60);
      const [first] = await getAlerts({ deviceId: device.id });
      expect(first).toMatchObject({
        sourceCondition: "active",
        currentCondition: "active",
        alarmState: "active_unacknowledged",
      });
      await acknowledgeAlert(first.id, actor.id);
      expect(await getAlertById(first.id)).toMatchObject({
        sourceCondition: "active",
        alarmState: "active_acknowledged",
      });
      await observe(device.deviceId, at + 1000, 20);
      expect(await getAlertById(first.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "cleared",
        status: "acknowledged",
        alarmState: "cleared_acknowledged",
      });
      await observe(device.deviceId, at + 2000, 65);
      const [second] = await getAlerts({ deviceId: device.id });
      expect(second.id).not.toBe(first.id);
      await observe(device.deviceId, at + 3000, 20);
      expect(await getAlertById(second.id)).toMatchObject({
        sourceCondition: "cleared",
        status: "active",
        alarmState: "cleared_unacknowledged",
      });
      expect(
        (
          await getAlerts({
            deviceId: device.id,
            sourceCondition: "cleared",
            acknowledged: false,
          })
        ).map((row) => row.id),
      ).toEqual([second.id]);
      const page = await getAlertPage(
        {
          deviceId: device.id,
          sourceCondition: "cleared",
          acknowledged: false,
          openOnly: true,
        },
        0,
        1,
      );
      expect(page).toMatchObject({
        total: 1,
        returned: 1,
        hasMore: false,
        summary: { total: 1, critical: 1 },
        items: [{ id: second.id }],
      });
      expect(
        (
          await getAlertPage({
            deviceId: device.id,
            sourceCondition: "cleared",
            acknowledged: true,
          })
        ).items.map((row) => row.id),
      ).toEqual([first.id]);
      const [history] = await (await getDb())!.execute(
        sql`select count(*)::int as n from incident_activity where alert_id=${second.id} and kind='source_cleared'`,
      );
      expect(history.n).toBe(1);
    });

    it("does not clear from stale, bad-quality, retained, missing or out-of-order observations", async () => {
      const { device } = await source("quality"),
        at = Date.now() - 10000;
      await observe(device.deviceId, at, 60);
      const [alarm] = await getAlerts({ deviceId: device.id });
      await observe(device.deviceId, at - 1000, 20);
      await observe(device.deviceId, at + 1000, 20, {
        transportRetained: true,
      });
      await observe(device.deviceId, Date.now() - 300000, 20);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "active",
        currentCondition: "active",
      });
      await observe(device.deviceId, at + 2000, 20, {
        integration: {
          mode: "live",
          sourceQuality: "bad",
          sourceConnection: "online",
          gatewayReceivedAt: new Date().toISOString(),
        },
      });
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "active",
        currentCondition: "unknown",
        conditionReason: "source_quality",
      });
      // An older good sample cannot overwrite the newer quality failure.
      await observe(device.deviceId, at + 1500, 20);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "active",
        currentCondition: "unknown",
      });
      await observe(device.deviceId, at + 3000, 20);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "cleared",
      });
      await observe(device.deviceId, at + 4000, 20, {
        integration: {
          mode: "live",
          sourceQuality: "bad",
          sourceConnection: "online",
          gatewayReceivedAt: new Date().toISOString(),
        },
      });
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "unknown",
        conditionReason: "source_quality",
      });
      await observe(device.deviceId, at + 5000, 20);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "cleared",
        conditionEvidence: { occurredAt: at + 5000 },
      });
      const [clearances] = await (await getDb())!.execute(
        sql`select count(*)::int as n from incident_activity where alert_id=${alarm.id} and kind='source_cleared'`,
      );
      expect(clearances.n).toBe(1);
    });

    it("does not manufacture clearance by changing limits or resolving an investigation", async () => {
      const { device, threshold } = await source("configuration"),
        at = Date.now() - 10000;
      const actor = (await createUser({
        openId: "condition-owner",
        name: "Condition owner",
        email: "condition-owner@example.test",
        role: "admin",
      }))!;
      await observe(device.deviceId, at, 60);
      const [alarm] = await getAlerts({ deviceId: device.id });
      await resolveAlert(alarm.id, actor.id, true);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "active",
        status: "resolved",
      });
      expect(
        (await getAlerts({ deviceId: device.id, openOnly: true })).map(
          (row) => row.id,
        ),
      ).toContain(alarm.id);
      expect(await getAlertStats([device.id])).toMatchObject({
        open: 1,
        critical: 1,
        resolved: 1,
      });
      expect(
        await getAlertPage({ deviceId: device.id, openOnly: true }),
      ).toMatchObject({
        total: 1,
        summary: { total: 1, resolved: 1 },
      });
      await (await getDb())!
        .update(alertThresholds)
        .set({ maxValue: 100 })
        .where(eq(alertThresholds.id, threshold.id));
      await observe(device.deviceId, at + 1000, 60);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "active",
        currentCondition: "unknown",
        conditionReason: "configuration_changed",
      });
    });

    it("separates gateway communication time, source-sample order and bounded on-change validity", async () => {
      const { device } = await source("on-change", {
          gateway: true,
          onChange: true,
        }),
        at = Date.now() - 10000;
      await observe(device.deviceId, at, 60);
      const [alarm] = await getAlerts({ deviceId: device.id });
      const reading = (await getLatestReading(device.id))!;
      expect(sampleValidity(reading, at + 300000)).toMatchObject({
        state: "held",
        sampleAt: at,
      });
      await recordDeviceHeartbeat({
        deviceId: device.deviceId,
        timestamp: at + 3000,
        status: "online",
        transportRetainVerified: true,
      });
      expect((await getLatestReading(device.id))!.id).toBe(reading.id);
      expect(
        currentSample((await getLatestReading(device.id))!, at + 600001),
      ).toBe(false);
      // A later source sample arriving after a newer heartbeat still has correct measurement order.
      await observe(device.deviceId, at + 2000, 20);
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
      });
      expect(
        (await getDeviceByDeviceId(device.deviceId))!.lastSeen?.getTime(),
      ).toBe(at + 3000);
      await recordDeviceHeartbeat({
        deviceId: device.deviceId,
        timestamp: at + 4000,
        status: "offline",
        transportRetainVerified: true,
      });
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "unknown",
        conditionReason: "source_connection_offline",
      });
      expect(
        sampleValidity((await getLatestReading(device.id))!),
      ).toMatchObject({
        state: "unverified",
        reason: "source_connection_offline",
      });
      await recordDeviceHeartbeat({
        deviceId: device.deviceId,
        timestamp: at + 5000,
        status: "online",
        transportRetainVerified: true,
      });
      expect(await getAlertById(alarm.id)).toMatchObject({
        sourceCondition: "cleared",
        currentCondition: "unknown",
        conditionReason: "source_connection_interrupted",
      });
      expect(
        sampleValidity((await getLatestReading(device.id))!),
      ).toMatchObject({
        state: "unverified",
        reason: "source_connection_interrupted",
      });
      const [item] = await inventoryItemsByRefs([`device:${device.id}`]);
      expect(sampleValidity(item)).toMatchObject({
        state: "unverified",
        reason: "source_connection_interrupted",
      });
      await observe(device.deviceId, at + 6000, 65);
      expect(
        sampleValidity((await getLatestReading(device.id))!),
      ).toMatchObject({
        state: "held",
        sampleAt: at + 6000,
      });
      expect((await getAlerts({ deviceId: device.id }))[0]).toMatchObject({
        currentCondition: "active",
      });
      await expect(
        ingestTelemetryByDeviceId({
          deviceId: device.deviceId,
          timestamp: at + 4000,
          integration: {
            mode: "live",
            sourceQuality: "good",
            sourceConnection: "online",
            gatewayReceivedAt: new Date().toISOString(),
          },
        }),
      ).rejects.toMatchObject({ code: "no_measurement" });
      expect(
        await (await getDb())!
          .select()
          .from(sensorReadings)
          .where(eq(sensorReadings.deviceId, device.id)),
      ).toHaveLength(3);
    });
  },
);
