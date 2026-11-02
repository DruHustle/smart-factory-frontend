import type { FloorLayout } from "./floor-arrangement";

export type FloorPoint = { x: number; z: number };
const CLEARANCE = 0.35;

/** Approximate navigation bounds, not a safety or commissioning model. */
export function isExplorePositionClear(layout: FloorLayout, point: FloorPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  if (
    Math.abs(point.x) > layout.width / 2 - CLEARANCE ||
    Math.abs(point.z) > layout.depth / 2 - CLEARANCE
  )
    return false;
  return !layout.placements.some((placement) => {
    const width = placement.dimensions?.width ?? 1;
    const depth = placement.dimensions?.depth ?? 1;
    const angle = ((placement.rotation ?? 0) * Math.PI) / 180;
    const halfX =
      (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * depth) /
        2 +
      CLEARANCE;
    const halfZ =
      (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * depth) /
        2 +
      CLEARANCE;
    return (
      Math.abs(point.x - placement.x) < halfX &&
      Math.abs(point.z - placement.z) < halfZ
    );
  });
}

/** Find an open approximate point, preferring a useful view of the selected item. */
export function findExplorePosition(
  layout: FloorLayout,
  ref?: string | null,
): FloorPoint | null {
  const selected = layout.placements.find(
    (placement) => placement.item.ref === ref,
  );
  const desired = selected
    ? { x: selected.x, z: selected.z }
    : { x: 0, z: layout.depth / 2 };
  const candidates: FloorPoint[] = [];
  if (selected) {
    const radius =
      Math.max(
        selected.dimensions?.width ?? 1,
        selected.dimensions?.depth ?? 1,
      ) /
        2 +
      1.25;
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8;
      candidates.push({
        x: selected.x + Math.cos(angle) * radius,
        z: selected.z + Math.sin(angle) * radius,
      });
    }
  }
  // A fixed sampling budget avoids unbounded work on large user-supplied layouts.
  for (let x = 0; x <= 12; x++)
    for (let z = 0; z <= 12; z++)
      candidates.push({
        x: (x / 12 - 0.5) * (layout.width - 2 * CLEARANCE),
        z: (z / 12 - 0.5) * (layout.depth - 2 * CLEARANCE),
      });
  const open = candidates.filter((point) =>
    isExplorePositionClear(layout, point),
  );
  open.sort(
    (a, b) =>
      Math.hypot(a.x - desired.x, a.z - desired.z) -
      Math.hypot(b.x - desired.x, b.z - desired.z),
  );
  return open[0] ?? null;
}

/** Step with axis sliding and intermediate checks so movement cannot skip bounds. */
export function moveExplorePosition(
  layout: FloorLayout,
  point: FloorPoint,
  dx: number,
  dz: number,
): FloorPoint {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dz) ||
    !isExplorePositionClear(layout, point)
  )
    return point;
  const distance = Math.hypot(dx, dz);
  // Limit one input event as well as each collision probe.
  if (distance > 6.4) {
    dx *= 6.4 / distance;
    dz *= 6.4 / distance;
  }
  const steps = Math.max(
    1,
    Math.min(32, Math.ceil(Math.min(distance, 6.4) / 0.2)),
  );
  const sx = dx / steps,
    sz = dz / steps;
  let current = { ...point };
  for (let i = 0; i < steps; i++) {
    const next = { x: current.x + sx, z: current.z + sz };
    if (isExplorePositionClear(layout, next)) current = next;
    else {
      const alongX = { x: current.x + sx, z: current.z };
      const alongZ = { x: current.x, z: current.z + sz };
      if (isExplorePositionClear(layout, alongX)) current = alongX;
      else if (isExplorePositionClear(layout, alongZ)) current = alongZ;
      else break;
    }
  }
  return current;
}
