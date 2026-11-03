import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { ingestWroverQosAck } from "./mqttQosStore";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)("QoS acknowledgement persistence", () => {
  disposableDatabase("mqtt_qos");
  it("accepts only a current request from the device's commissioned gateway", async () => {
    const db = (await getDb())!;
    const [device] = await db.execute<{ id: number }>(sql`insert into devices("deviceId",name,type,"isDemo",metadata) values('qos-fixture-device','QoS fixture','sensor',false,'{"gatewayId":"qos-fixture-gateway"}'::json) returning id`);
    const now = Date.now();
    const state = { revision: 1, uplink: 2, downlink: 1, commandId: "4ce07676-9ed8-4c70-b679-7fea17a82a16", requestedAt: new Date(now - 500).toISOString(), status: "published" };
    const key = `mqtt-qos:wrover:${device.id}`;
    await db.execute(sql`insert into system_settings(key,value) values(${key},${JSON.stringify(state)}::jsonb)`);
    const ack = { action: "configure_mqtt_qos", deviceId: "qos-fixture-device", gatewayDeviceId: "qos-fixture-gateway", commandId: state.commandId, status: "applied", timestamp: now, revision: 1, uplinkQos: 2, downlinkQos: 1, transportRetained: false, transportRetainVerified: true };
    expect(await ingestWroverQosAck({ ...ack, gatewayDeviceId: "other-gateway" }, now)).toBe(false);
    expect(await ingestWroverQosAck({ ...ack, revision: 2 }, now)).toBe(false);
    expect(await ingestWroverQosAck(ack, now)).toBe(true);
    const [row] = await db.execute<{ value: { status: string } }>(sql`select value from system_settings where key=${key}`);
    expect(row.value.status).toBe("applied");
  });
});
