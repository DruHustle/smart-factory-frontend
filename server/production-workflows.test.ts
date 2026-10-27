import { registerDevice } from "./deviceRegistration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import * as db from "./db";
import { buildAasDocuments } from "./aasModel";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("telemetry attribution, incident ownership and retry integrity", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const assetIds = [
    `urn:review:compressor:${suffix}`,
    `urn:review:motor:${suffix}`,
  ];
  const timestamp = Date.now();
  let gateway: db.Device;
  let technician: db.User;
  let otherTechnician: db.User;
  const assetPks: number[] = [];

  const ingest = (input: Parameters<typeof db.ingestTelemetryByDeviceId>[0]) =>
    db.ingestTelemetryByDeviceId({
      ...input,
      units: {
        temperature: "°C",
        humidity: "%",
        power: "W",
        vibration: "mm/s",
        pressure: "Pa",
        rpm: "rpm",
      },
      integration: {
        mode: "live",
        sourceQuality: "good",
        sourceConnection: "online",
        gatewayReceivedAt: new Date(timestamp).toISOString(),
      },
    });
  beforeAll(async () => {
    gateway = await registerDevice({
      deviceId: `review-${suffix}`,
      name: "Review gateway",
      type: "gateway",
      route: "direct",
      freshnessSeconds: 120,
    });
    technician = (await db.createUser({
      openId: `review-tech-${suffix}`,
      email: `review-tech-${suffix}@test.local`,
      role: "engineer",
      name: "Review Technician",
    }))!;
    otherTechnician = (await db.createUser({
      openId: `review-other-${suffix}`,
      email: `review-other-${suffix}@test.local`,
      role: "engineer",
      name: "Other Technician",
    }))!;
    for (const assetId of assetIds) {
      const identity = {
        assetId,
        name: assetId,
        assetType: "motor",
        manufacturer: "Test",
        model: "T1",
        manufacturerStreet: "Test 1",
        manufacturerZipcode: "10000",
        manufacturerCityTown: "Test",
        manufacturerNationalCode: "DE",
        manufacturerArticleNumber: "T1",
        orderCodeOfManufacturer: "T1",
      };
      const documents = buildAasDocuments(identity);
      const asset = await db.createAsset(
        {
          ...identity,
          aasShell: documents.shell,
          aasSubmodels: documents.submodels,
        },
        {
          mode: "gateway",
          deviceId: gateway.id,
          protocol: "mqtt",
          tagMappings: [],
        },
        technician.id,
      );
      assetPks.push(asset.id);
    }
  });

  afterAll(async () => {
    const database = await db.getDb();
    if (!database || !gateway) return;
    await database
      .delete(schema.alerts)
      .where(eq(schema.alerts.deviceId, gateway.id));
    await database
      .delete(schema.alertThresholds)
      .where(eq(schema.alertThresholds.deviceId, gateway.id));
    await database
      .delete(schema.sensorReadings)
      .where(eq(schema.sensorReadings.deviceId, gateway.id));
    for (const table of [
      schema.assetDevices,
      schema.assetVersions,
      schema.assetLifecycleEvents,
    ]) {
      await database.delete(table).where(inArray(table.assetId, assetPks));
    }
    await database
      .delete(schema.assets)
      .where(inArray(schema.assets.id, assetPks));
    await database
      .delete(schema.devices)
      .where(eq(schema.devices.id, gateway.id));
    await database
      .delete(schema.users)
      .where(inArray(schema.users.id, [technician.id, otherTechnician.id]));
  });

  it("deduplicates concurrent delivery without mixing two machines on one gateway", async () => {
    const reading = {
      deviceId: gateway.deviceId,
      gatewayId: gateway.deviceId,
      assetId: assetIds[0],
      timestamp,
      temperature: 51,
      assetSignals: { bearingTemp: 74.5 },
    };
    await Promise.all(Array.from({ length: 20 }, () => ingest(reading)));
    await ingest({
      ...reading,
      assetId: assetIds[1],
      timestamp: timestamp + 1,
      temperature: 19,
    });
    const readings = await db.getSensorReadings(
      gateway.id,
      timestamp,
      timestamp + 2,
    );
    expect(readings).toHaveLength(2);
    expect(readings[0].assetSignals).toEqual({ bearingTemp: 74.5 });
    const analytics = await db.getAssetTelemetry(
      assetIds,
      timestamp - 1,
      timestamp + 2,
    );
    expect(
      analytics.assets.find((asset) => asset.assetId === assetIds[0])
        ?.avgTemperature,
    ).toBe(51);
    expect(
      analytics.assets.find((asset) => asset.assetId === assetIds[1])
        ?.avgTemperature,
    ).toBe(19);
  });

  it("persists incident notifications and rejects another account's inbox changes", async () => {
    const { listNotifications, readNotification } =
      await import("./notifications");
    const incident = await db.createAlert({
      deviceId: gateway.id,
      type: "system_error",
      severity: "critical",
      message: "Review incident",
    });
    await db.assignAlert(incident.id, technician.id);
    const rows = (await listNotifications(technician.id)).filter(
      (row) => row.alertId === incident.id,
    );
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "assignment",
      "incident",
    ]);
    expect(
      await readNotification(otherTechnician.id, rows[0].id),
    ).toBeUndefined();
    expect(await readNotification(technician.id, rows[0].id)).toEqual({
      id: rows[0].id,
    });
    expect(
      (await listNotifications(technician.id)).find(
        (row) => row.id === rows[0].id,
      )?.readAt,
    ).toBeInstanceOf(Date);
    await db.resolveAlert(incident.id, technician.id, false);
  });

  it("notifies a critical escalation once without duplicating routine incident updates", async () => {
    const { listNotifications } = await import("./notifications");
    const incident = await db.createAlert({
      deviceId: gateway.id,
      type: "system_error",
      severity: "warning",
      message: "Review warning",
    });
    await db.updateAlert(incident.id, { severity: "critical" });
    await db.updateAlert(incident.id, {
      severity: "critical",
      message: "Latest value",
    });
    const rows = (await listNotifications(technician.id)).filter(
      (row) => row.alertId === incident.id,
    );
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "escalation",
      "incident",
    ]);
    const database = await db.getDb();
    await database!
      .delete(schema.alerts)
      .where(eq(schema.alerts.id, incident.id));
  });

  it("preserves gateway identity and monotonic last-seen when old samples are replayed", async () => {
    await ingest({
      deviceId: gateway.deviceId,
      assetId: assetIds[0],
      timestamp: timestamp - 60_000,
      temperature: 20,
    });
    const current = await db.getDeviceById(gateway.id);
    expect(current?.type).toBe("gateway");
    expect(current?.lastSeen?.getTime()).toBe(timestamp + 1);
  });

  it("updates a registered gateway from heartbeats without creating a sensor sample", async () => {
    const before = (
      await db.getSensorReadings(
        gateway.id,
        timestamp - 200_000,
        Date.now() + 1000,
      )
    ).length;
    const heartbeatAt = Date.now();
    expect(
      await db.recordDeviceHeartbeat({
        deviceId: gateway.deviceId,
        timestamp: heartbeatAt,
        status: "online",
      }),
    ).toBe(true);
    expect((await db.getDeviceById(gateway.id))?.status).toBe("online");
    expect(
      await db.recordDeviceHeartbeat({
        deviceId: gateway.deviceId,
        timestamp: heartbeatAt - 1,
        status: "offline",
      }),
    ).toBe(true);
    expect((await db.getDeviceById(gateway.id))?.status).toBe("online");
    expect(
      (
        await db.getSensorReadings(
          gateway.id,
          timestamp - 200_000,
          Date.now() + 1000,
        )
      ).length,
    ).toBe(before);
    expect(
      await db.recordDeviceHeartbeat({
        deviceId: `unknown-${suffix}`,
        timestamp: heartbeatAt,
        status: "online",
      }),
    ).toBe(false);
  });

  it("aggregates sparse gateway metrics without treating missing readings as zero", async () => {
    await ingest({
      deviceId: gateway.deviceId,
      timestamp: timestamp - 120_000,
      temperature: 40,
    });
    await ingest({
      deviceId: gateway.deviceId,
      timestamp: timestamp - 120_001,
      humidity: 60,
    });
    const buckets = await db.getAggregatedReadings(
      [gateway.id],
      timestamp - 120_002,
      timestamp - 119_999,
      3_600_000,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      avgTemperature: 40,
      avgHumidity: 60,
      avgPower: null,
      count: 2,
    });
  });

  it("keeps an acknowledged critical fault visible until its owner resolves it", async () => {
    const alert = await db.createAlert({
      deviceId: gateway.id,
      assetId: assetIds[0],
      type: "threshold_exceeded",
      metric: "temperature",
      severity: "critical",
      message: "Review fault",
    });
    await db.assignAlert(alert.id, technician.id);
    await db.acknowledgeAlert(alert.id, technician.id);
    expect((await db.getAlertStats([gateway.id])).critical).toBe(1);
    const analytics = await db.getAssetTelemetry(
      assetIds,
      timestamp - 1000,
      Date.now() + 1000,
    );
    expect(analytics.overall.alerts.activeCritical).toBe(1);
    expect(
      analytics.assets.find((asset) => asset.assetId === assetIds[1])?.alerts
        .activeCritical,
    ).toBe(0);
    expect((await db.getAlertById(alert.id))?.assignedToName).toBe(
      "Review Technician",
    );
    await expect(
      db.startAlertDowntime(alert.id, otherTechnician.id, false),
    ).rejects.toThrow("assigned technician");
    await expect(
      db.resolveAlert(alert.id, otherTechnician.id, false),
    ).rejects.toThrow("assigned technician");
    await db.startAlertDowntime(alert.id, technician.id, false);
    expect((await db.getAlertStats([gateway.id])).activeDowntime).toBe(1);
    await db.resolveAlert(alert.id, technician.id, false);
    expect((await db.getAlertStats([gateway.id])).critical).toBe(0);
    expect((await db.getAlertStats([gateway.id])).resolvedDowntimeCount).toBe(
      1,
    );
  });

  it("does not infer a factory outage from a lost device connection", async () => {
    const alert = await db.createAlert({
      deviceId: gateway.id,
      type: "device_offline",
      severity: "warning",
      message: "No recent communication",
    });
    expect(alert.downtimeStartedAt).toBeNull();
    expect((await db.getAlertStats([gateway.id])).activeDowntime).toBe(0);
  });
});
