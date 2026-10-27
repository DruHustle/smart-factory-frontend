import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql, eq } from "drizzle-orm";
import { devices } from "../drizzle/schema";
import { createDevice, getDeviceByDeviceId, getDb } from "./db";
import { commissioningInput, wireIdentifier, type Commissioning } from "./observationPolicy";
export const registerDeviceInput = z.object({
  type: z.enum(["gateway", "edge_device", "sensor", "actuator", "controller"]).default("gateway"),
  deviceId: wireIdentifier, name: z.string().trim().min(3).max(255), location: z.string().trim().max(255).optional(), zone: z.string().trim().max(100).optional(),
  route: z.enum(["direct", "gateway", "unconfigured"]).default("unconfigured"), gatewayId: wireIdentifier.optional(), freshnessSeconds: z.number().int().min(5).max(86400).optional(),
  maxLatenessSeconds: z.number().int().min(5).max(3600).default(120), clockSkewSeconds: z.number().int().min(0).max(60).default(30), legacyCurrent: z.boolean().default(false), legacyUnits: commissioningInput.shape.legacyUnits,
  status: z.enum(["online", "offline", "maintenance", "error"]).optional(),
}).superRefine((v, c) => { if (v.route === "gateway" && (!v.gatewayId || v.type === "gateway")) c.addIssue({ code: "custom", path: ["gatewayId"], message: "Select a registered parent gateway for an ordinary device" }); });
function metadata(v: z.infer<typeof commissioningInput>, actor: number, revision: number, type: string) {
  const commissioning: Commissioning = { ...v, revision, reviewedAt: new Date().toISOString(), reviewedBy: actor };
  return { commissioning, connectionMode: v.route === "direct" ? type === "gateway" ? "gateway" : "direct_mqtt" : v.route === "gateway" ? "gateway" : "unconfigured", gatewayId: v.route === "gateway" ? v.gatewayId : null, freshnessMs: v.freshnessSeconds ? v.freshnessSeconds * 1000 : null };
}
async function validateParent(v: z.infer<typeof commissioningInput>, type: string) {
  if (v.route !== "gateway") return;
  const parent = await getDeviceByDeviceId(v.gatewayId!);
  if (type === "gateway" || !parent || parent.type !== "gateway" || parent.isDemo) throw new TRPCError({ code: "BAD_REQUEST", message: "Select a registered real parent gateway for an ordinary device" });
}
export async function registerDevice(raw: z.input<typeof registerDeviceInput>, actor = 0) {
  const v = registerDeviceInput.parse(raw);
  if (await getDeviceByDeviceId(v.deviceId)) throw new TRPCError({ code: "CONFLICT", message: "This device ID is already registered. Open the existing item." });
  const policy = commissioningInput.parse({ route: v.route, gatewayId: v.gatewayId, freshnessSeconds: v.freshnessSeconds, maxLatenessSeconds: v.maxLatenessSeconds, clockSkewSeconds: v.clockSkewSeconds, legacyCurrent: v.legacyCurrent, legacyUnits: v.legacyUnits });
  await validateParent(policy, v.type);
  return createDevice({ deviceId: v.deviceId, name: v.name, type: v.type, location: v.location, zone: v.zone, status: "offline", metadata: metadata(policy, actor, 1, v.type) });
}
export const editCommissioningInput = z.object({ id: z.number().int().positive(), expectedRevision: z.number().int().min(0), policy: commissioningInput, name: z.string().trim().min(3).max(255), location: z.string().trim().max(255).nullable(), zone: z.string().trim().max(100).nullable() }).strict();
export async function updateCommissioning(input: z.infer<typeof editCommissioningInput>, actor: number) {
  const db = await getDb(); if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [existing] = await db.select({ type: devices.type }).from(devices).where(eq(devices.id,input.id));
  if (!existing) throw new TRPCError({code:"NOT_FOUND",message:"Device not found"});
  await validateParent(input.policy, existing.type);
  return db.transaction(async tx => {
    const [device] = await tx.select().from(devices).where(eq(devices.id, input.id)).for("update");
    if (!device || device.isDemo) throw new TRPCError({ code: "NOT_FOUND", message: "Operational device not found" });
    const revision = (device.metadata?.commissioning as Commissioning | undefined)?.revision ?? 0;
    if (revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Commissioning changed. Refresh and review the latest route before saving." });

    const [updated] = await tx.update(devices).set({ name: input.name, location: input.location, zone: input.zone, metadata: { ...device.metadata, ...metadata(input.policy, actor, revision + 1, device.type) }, updatedAt: new Date() }).where(eq(devices.id, input.id)).returning();
    return updated;
  });
}
