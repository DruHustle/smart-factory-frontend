import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { mqttQosLevel } from "../shared/mqtt-qos";
import { getDb, getDeviceById, getLatestReading } from "./db";
import { demoOnlyRead } from "./demoData";
import { publishWroverQos } from "./aasProvisioningClient";

const stateSchema = z.object({
  revision: z.number().int().min(1).max(0xffffffff),
  uplink: mqttQosLevel,
  downlink: mqttQosLevel,
  commandId: z.uuid(),
  requestedAt: z.iso.datetime(),
  status: z.enum(["publishing", "published", "failed", "applied", "rejected"]),
  acknowledgedAt: z.iso.datetime().optional(),
}).strict();
type State = z.infer<typeof stateSchema>;
const keyFor = (id: number) => `mqtt-qos:wrover:${id}`;

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "QoS settings storage is unavailable." });
  return db;
}

export async function getWroverQos(id: number) {
  if (demoOnlyRead()) return null;
  const device = await getDeviceById(id);
  if (!device || device.isDemo) throw new TRPCError({ code: "NOT_FOUND", message: "Operational device not found." });
  const db = await database();
  const [row] = await db.execute<{ value: unknown }>(sql`select value from system_settings where key=${keyFor(id)}`);
  return row ? stateSchema.parse(row.value) : null;
}

/** Save desired state before publishing so a delayed receipt can be correlated. */
export async function requestWroverQos(input: {
  id: number; expectedRevision: number; uplink: 0 | 1 | 2; downlink: 0 | 1 | 2;
}, actorId: number, userToken: string) {
  if (demoOnlyRead()) throw new TRPCError({ code: "FORBIDDEN", message: "Select Live data to change MQTT settings." });
  const device = await getDeviceById(input.id);
  const gatewayId = typeof device?.metadata?.gatewayId === "string" ? device.metadata.gatewayId : undefined;
  const latest = device && await getLatestReading(input.id);
  const age = latest ? Date.now() - latest.timestamp : Number.NaN;
  const acquisition = latest?.integration?.acquisition as { sensorStatus?: string } | undefined;
  if (!device || device.isDemo || !["edge_device", "sensor"].includes(device.type) || !gatewayId ||
      device.observedStatus !== "live" || !Number.isFinite(age) || age < 0 || age > 120_000 ||
      latest?.integration?.sourceQuality === "bad" || acquisition?.sensorStatus === "read_error")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Select a commissioned WROVER with current, healthy telemetry." });
  const db = await database();
  const state = await db.transaction(async tx => {
    const key = keyFor(input.id);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [row] = await tx.execute<{ value: unknown }>(sql`select value from system_settings where key=${key}`);
    const previous = row ? stateSchema.parse(row.value) : null;
    if ((previous?.revision ?? 0) !== input.expectedRevision || input.expectedRevision >= 0xffffffff)
      throw new TRPCError({ code: "CONFLICT", message: "QoS settings changed. Refresh before retrying." });
    const next: State = { revision: input.expectedRevision + 1, uplink: input.uplink, downlink: input.downlink,
      commandId: randomUUID(), requestedAt: new Date().toISOString(), status: "publishing" };
    await tx.execute(sql`insert into system_settings(key,value,"updatedBy") values(${key},${JSON.stringify(next)}::jsonb,${actorId}) on conflict(key) do update set value=excluded.value,"updatedBy"=excluded."updatedBy","updatedAt"=now()`);
    return next;
  });
  try {
    await publishWroverQos({ gatewayDeviceId: gatewayId, targetDeviceId: device.deviceId, revision: state.revision,
      uplinkQos: state.uplink, downlinkQos: state.downlink, commandId: state.commandId, expiresAt: Date.now() + 10_000 }, userToken);
  } catch (error) {
    await db.execute(sql`update system_settings set value=jsonb_set(value,'{status}', '"failed"'::jsonb),"updatedAt"=now() where key=${keyFor(input.id)} and value->>'commandId'=${state.commandId} and value->>'status'='publishing'`);
    throw error;
  }
  await db.execute(sql`update system_settings set value=jsonb_set(value,'{status}', '"published"'::jsonb),"updatedAt"=now() where key=${keyFor(input.id)} and value->>'commandId'=${state.commandId} and value->>'status'='publishing'`);
  return { ...state, status: "published" as const, applied: false as const };
}

const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
export const wroverQosAckSchema = z.object({
  action: z.literal("configure_mqtt_qos"),
  deviceId: safeId,
  gatewayDeviceId: safeId,
  commandId: z.uuid(),
  status: z.enum(["applied", "rejected"]),
  timestamp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  revision: z.number().int().min(0).max(0xffffffff),
  uplinkQos: mqttQosLevel,
  downlinkQos: mqttQosLevel,
  reason: z.string().max(128).optional(),
  transportRetained: z.literal(false),
  transportRetainVerified: z.literal(true),
}).strict();

/** Accept only a fresh, commissioned route's matching response to a pending request. */
export async function ingestWroverQosAck(value: unknown, now = Date.now()) {
  const ack = wroverQosAckSchema.parse(value);
  if (ack.timestamp > now + 5000 || ack.timestamp < now - 120_000) return false;
  const db = await database();
  return db.transaction(async tx => {
    const [device] = await tx.execute<{ id: number }>(sql`select id from devices where "deviceId"=${ack.deviceId} and "isDemo"=false and metadata->>'gatewayId'=${ack.gatewayDeviceId}`);
    if (!device) return false;
    const key = keyFor(device.id);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [row] = await tx.execute<{ value: unknown }>(sql`select value from system_settings where key=${key}`);
    if (!row) return false;
    const current = stateSchema.parse(row.value);
    if (current.commandId !== ack.commandId || ack.timestamp < Date.parse(current.requestedAt) - 5000) return false;
    if (ack.status === "applied" && (current.revision !== ack.revision || current.uplink !== ack.uplinkQos || current.downlink !== ack.downlinkQos)) return false;
    if (["applied", "rejected"].includes(current.status)) return current.status === ack.status;
    const next: State = { ...current, status: ack.status, acknowledgedAt: new Date(ack.timestamp).toISOString() };
    await tx.execute(sql`update system_settings set value=${JSON.stringify(next)}::jsonb,"updatedAt"=now() where key=${key}`);
    return true;
  });
}
