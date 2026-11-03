import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as dbModule from "./db";
import * as provisioning from "./aasProvisioningClient";
import { withVisibility } from "./demoData";
import { ingestWroverQosAck, requestWroverQos } from "./mqttQosStore";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)("QoS acknowledgement persistence", () => {
  disposableDatabase("mqtt_qos");
  afterEach(() => vi.restoreAllMocks());
  it("allocates a single monotonic sequence across concurrent devices on the same gateway", async () => {
    const db = (await getDb())!;
    const devices = await db.execute<{ id: number; deviceId: string }>(sql`insert into devices("deviceId",name,type,"isDemo",metadata) values
      ('qos-device-a','QoS A','sensor',false,'{"gatewayId":"shared-pi"}'::json),
      ('qos-device-b','QoS B','sensor',false,'{"gatewayId":"shared-pi"}'::json) returning id,"deviceId"`);
    vi.spyOn(dbModule, "getDeviceById").mockImplementation(async id => ({ ...devices.find(device => device.id === id),
      type: "sensor", isDemo: false, observedStatus: "live", metadata: { gatewayId: "shared-pi" } }) as any);
    vi.spyOn(dbModule, "getLatestReading").mockResolvedValue({ timestamp: Date.now(), integration: { sourceQuality: "good" } } as any);
    vi.spyOn(provisioning, "publishWroverQos").mockImplementation(async input => ({ published: true, commandId: input.commandId, applied: false }));
    const run = () => Promise.all(devices.map(device => requestWroverQos({ id: device.id, expectedRevision: 0, uplink: 2, downlink: 1 }, 42, "fixture-token")));
    const states = await withVisibility({ demoOnly: false, includeDemo: false }, run);
    expect(states.map(state => state.revision).sort()).toEqual([1, 2]);
    const [counter] = await db.execute<{ value: number }>(sql`select value from system_settings where key='mqtt-qos:gateway:shared-pi'`);
    expect(counter.value).toBe(2);
  });
  it("accepts only a current request from the device's commissioned gateway", async () => {
    const db = (await getDb())!;
    const [device] = await db.execute<{ id: number }>(sql`insert into devices("deviceId",name,type,"isDemo",metadata) values('qos-fixture-device','QoS fixture','sensor',false,'{"gatewayId":"qos-fixture-gateway"}'::json) returning id`);
    const now = Date.now();
    const state = { revision: 1, uplink: 2, downlink: 1, commandId: "4ce07676-9ed8-4c70-b679-7fea17a82a16", requestedAt: new Date(now - 500).toISOString(), status: "published" };
    const key = `mqtt-qos:wrover:${device.id}`;
    await db.execute(sql`insert into system_settings(key,value) values(${key},${JSON.stringify(state)}::jsonb)`);
    await db.execute(sql`insert into system_settings(key,value) values('mqtt-qos:gateway:qos-fixture-gateway','1'::jsonb)`);
    const ack = { action: "configure_mqtt_qos", deviceId: "qos-fixture-device", gatewayDeviceId: "qos-fixture-gateway", commandId: state.commandId, status: "applied", timestamp: now, revision: 1, requestedRevision: 1, uplinkQos: 2, downlinkQos: 1, transportRetained: false, transportRetainVerified: true };
    expect(await ingestWroverQosAck({ ...ack, gatewayDeviceId: "other-gateway" }, now)).toBe(false);
    expect(await ingestWroverQosAck({ ...ack, revision: 2 }, now)).toBe(false);
    expect(await ingestWroverQosAck(ack, now)).toBe(true);
    const [row] = await db.execute<{ value: { status: string } }>(sql`select value from system_settings where key=${key}`);
    expect(row.value.status).toBe("applied");
  });
});
