import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createDevice, getDeviceByDeviceId } from "./db";
export const registerDeviceInput = z
  .object({
    type: z
      .enum(["gateway", "edge_device", "sensor", "actuator", "controller"])
      .default("gateway"),
    deviceId: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,63}$/,
        "Use 3–64 letters, numbers, dots, colons, underscores or hyphens",
      ),
    name: z.string().trim().min(3).max(255),
    location: z.string().trim().max(255).optional(),
    zone: z.string().trim().max(100).optional(),
    route: z
      .enum(["direct", "gateway", "unconfigured"])
      .default("unconfigured"),
    gatewayId: z.string().max(64).optional(),
    freshnessSeconds: z.number().int().min(5).max(86400).optional(),
    // Kept for old clients; registration cannot fabricate observed availability.
    status: z.enum(["online", "offline", "maintenance", "error"]).optional(),
  })
  .superRefine((v, c) => {
    if (v.route === "gateway" && (!v.gatewayId || v.type === "gateway"))
      c.addIssue({
        code: "custom",
        path: ["gatewayId"],
        message: "Select a registered parent gateway for an ordinary device",
      });
  });
export async function registerDevice(v: z.infer<typeof registerDeviceInput>) {
  if (await getDeviceByDeviceId(v.deviceId))
    throw new TRPCError({
      code: "CONFLICT",
      message: "This device ID is already registered. Open the existing item.",
    });
  if (v.route === "gateway") {
    const parent = await getDeviceByDeviceId(v.gatewayId!);
    if (!parent || parent.type !== "gateway" || parent.isDemo)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select a registered real gateway",
      });
  }
  return createDevice({
    deviceId: v.deviceId,
    name: v.name,
    type: v.type,
    location: v.location,
    zone: v.zone,
    status: "offline",
    metadata: {
      connectionMode:
        v.route === "direct"
          ? "direct_mqtt"
          : v.route === "gateway"
            ? "gateway"
            : "unconfigured",
      ...(v.route === "gateway" ? { gatewayId: v.gatewayId } : {}),
      ...(v.freshnessSeconds ? { freshnessMs: v.freshnessSeconds * 1000 } : {}),
    },
  });
}
