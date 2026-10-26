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
  kind: ItemKind;
  id: string;
  name: string;
  identifier: string;
  itemType: string;
  location: string | null;
  zone: string | null;
  configured: boolean;
  route: string;
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
