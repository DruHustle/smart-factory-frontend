import type { Device } from "../drizzle/schema";
import { observedStatus, type InventoryStatus } from "../shared/inventory";
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
  const policy = device.metadata?.commissioning as { freshnessSeconds?: number } | undefined;
  const configured = policy?.freshnessSeconds ? policy.freshnessSeconds * 1000 : Number(device.metadata?.freshnessMs ?? NaN);
  const freshnessMs =
    Number.isFinite(configured) && configured >= 5000 && configured <= 86400000
      ? configured
      : null;
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
