/** Format zone and location without repeating an existing display segment. */
export function inventoryLocation(
  zone: string | null | undefined,
  location: string | null | undefined,
): string {
  const area = zone?.trim() ?? "";
  const place = location?.trim() ?? "";
  if (!area) return place;
  if (!place) return area;
  if (place === area || place.startsWith(`${area} · `)) return place;
  if (area.startsWith(`${place} · `)) return area;
  return `${area} · ${place}`;
}
