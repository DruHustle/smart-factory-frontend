import type { layoutFactory } from "@shared/factory-floor";

export type FloorLayout = ReturnType<typeof layoutFactory>;
export type FloorSelect = (ref: string, revealDetails?: boolean) => void;
export type FloorMove = (ref: string, x: number, z: number) => void;
export type FloorOffsets = Record<string, { x: number; z: number }>;

export function readFloorOffsets(value: string | null): FloorOffsets {
  try {
    if (!value || value.length > 150000) return {};
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data)
        .slice(0, 1024)
        .filter(
          ([ref, point]) =>
            /^(?:asset|device|equipment):[a-zA-Z0-9-]{1,128}$/.test(ref) &&
            point &&
            typeof point === "object" &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.z) &&
            Math.abs(point.x) <= 10000 &&
            Math.abs(point.z) <= 10000,
        ),
    );
  } catch {
    return {};
  }
}

export function constrainFloorPosition(
  layout: FloorLayout,
  x: number,
  z: number,
) {
  return {
    x: Math.max(-layout.width / 2 + 1, Math.min(layout.width / 2 - 1, x)),
    z: Math.max(-layout.depth / 2 + 1, Math.min(layout.depth / 2 - 1, z)),
  };
}

export function arrangeFloor(
  layout: FloorLayout,
  offsets: FloorOffsets,
): FloorLayout {
  return {
    ...layout,
    placements: layout.placements.map((p) => {
      const offset = offsets[p.item.ref];
      return offset
        ? {
            ...p,
            ...constrainFloorPosition(layout, p.x + offset.x, p.z + offset.z),
          }
        : p;
    }),
  };
}
