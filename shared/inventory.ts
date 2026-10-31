/** Typed references address authoritative records; IDs from different tables never alias. */
export type ItemKind = "asset" | "device" | "equipment";
export type InventoryStatus =
  | "live"
  | "stale"
  | "offline"
  | "unknown"
  | "maintenance"
  | "error";
export type InventoryItem = {
  ref: string;
  factoryId?: string | null;
  factoryTag?: string | null;
  kind: ItemKind;
  id: string;
  name: string;
  identifier: string;
  itemType: string;
  location: string | null;
  zone: string | null;
  configured: boolean;
  isDemo?: boolean;
  sandbox?: boolean;
  route: string;
  gatewayId?: string | null;
  status: InventoryStatus;
  lastObserved: string | null;
  sampleAt: number | null;
  mode: string;
  quality: string;
  freshnessMs: number | null;
  lifecycle: string | null;
  aas: boolean;
  equipmentId: string | null;
  firmware: string | null;
  measurements?: import("./measurements").Measurements;
  values?: Partial<Record<import("./measurements").Metric, number | null>>;
  evidence?: { eligible?: boolean; reason?: string; validForMs?: number };
};
export function observedStatus(
  input: {
    reported?: string | null;
    lastObserved?: string | null;
    freshnessMs?: number | null;
  },
  now = Date.now(),
): InventoryStatus {
  if (input.reported === "maintenance" || input.reported === "error")
    return input.reported;
  if (!input.lastObserved) return "unknown";
  const age = now - Date.parse(input.lastObserved);
  if (!Number.isFinite(age) || age < 0) return "unknown";
  if (input.reported === "offline") return "offline";
  if (!input.freshnessMs) return "unknown"; // No commissioned policy: do not invent a timeout.
  return age <= input.freshnessMs ? "live" : "stale";
}
export const itemHref = (
  ref: string,
  section = "overview",
  returnTo?: string,
) =>
  `/inventory/${encodeURIComponent(ref)}/${section}${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ""}`;

/** Every observation link follows the actual item capability; gateways have no Telemetry section. */
export function observationHref(
  item: { ref: string; kind: ItemKind; itemType: string },
  returnTo?: string,
) {
  return itemHref(
    item.ref,
    item.kind === "device" && item.itemType === "gateway"
      ? "connected"
      : item.kind === "equipment"
        ? "observations"
        : "telemetry",
    returnTo,
  );
}
