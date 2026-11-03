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
  status: z.enum(["publishing", "published", "failed"]),
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
    await db.execute(sql`update system_settings set value=jsonb_set(value,'{status}', '"failed"'::jsonb),"updatedAt"=now() where key=${keyFor(input.id)} and value->>'commandId'=${state.commandId}`);
    throw error;
  }
  await db.execute(sql`update system_settings set value=jsonb_set(value,'{status}', '"published"'::jsonb),"updatedAt"=now() where key=${keyFor(input.id)} and value->>'commandId'=${state.commandId}`);
  return { ...state, status: "published" as const, applied: false as const };
}
