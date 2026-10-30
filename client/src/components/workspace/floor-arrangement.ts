import type { PhysicalDimensions } from "@shared/named-factory";
import type { layoutFactory } from "@shared/factory-floor";

export type FloorLayout = Omit<
  ReturnType<typeof layoutFactory>,
  "placements"
> & {
  measured?: boolean;
  placements: Array<
    ReturnType<typeof layoutFactory>["placements"][number] & {
      dimensions?: PhysicalDimensions;
    }
  >;
};
export type FloorSelect = (ref: string, revealDetails?: boolean) => void;
export type FloorMove = (ref: string, x: number, z: number) => void;
export type FloorDrag = {
  ref: string;
  clientX: number;
  clientY: number;
} | null;
export type FloorDragHandlers = {
  onItemDrag?: (drag: FloorDrag) => void;
  onItemDrop?: (ref: string, clientX: number, clientY: number) => boolean;
  onDelete?: (ref: string) => void;
};
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
  ref?: string,
) {
  const p = layout.placements.find((p) => p.item.ref === ref),
    dims = p?.dimensions;
  const angle = ((p?.rotation ?? 0) * Math.PI) / 180;
  const halfX = dims
    ? (Math.abs(Math.cos(angle)) * dims.width +
        Math.abs(Math.sin(angle)) * dims.depth) /
      2
    : 1;
  const halfZ = dims
    ? (Math.abs(Math.sin(angle)) * dims.width +
        Math.abs(Math.cos(angle)) * dims.depth) /
      2
    : 1;
  const limitX = Math.max(0, layout.width / 2 - halfX),
    limitZ = Math.max(0, layout.depth / 2 - halfZ);
  return {
    x: Math.max(-limitX, Math.min(limitX, x)),
    z: Math.max(-limitZ, Math.min(limitZ, z)),
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
