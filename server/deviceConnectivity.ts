import type { Device } from "../drizzle/schema";
import { observedStatus, type InventoryStatus } from "../shared/inventory";
import { deviceFreshness } from "./deviceFreshness";
export const DEVICE_OFFLINE_AFTER_MS = 120_000;
export type ObservedDevice = Device & {
  observedStatus: InventoryStatus;
  freshnessMs: number | null;
};
/** Preserve the legacy stored-status API while exposing honest observed state. */
export function deviceWithCurrentStatus(
  device: Device,
  now = Date.now(),
): ObservedDevice {
  const freshnessMs = deviceFreshness(device.metadata);
  const result: ObservedDevice = {
    ...device,
    freshnessMs,
    observedStatus: observedStatus(
      {
        reported: device.status,
        lastObserved: device.lastSeen?.toISOString(),
        freshnessMs,
      },
      now,
    ),
  };
  if (device.isDemo || device.status !== "online") return result;
  const last = device.lastSeen?.getTime();
  // The old status field remains compatible; new surfaces use observedStatus.
  if (
    last != null &&
    last <= now &&
    now - last <= (freshnessMs ?? DEVICE_OFFLINE_AFTER_MS)
  )
    return result;
  return { ...result, status: "offline" };
}
