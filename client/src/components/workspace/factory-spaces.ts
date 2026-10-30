import type { FloorZone } from "@shared/factory-floor";

export type FactoryAreaKind = "inbound" | "storage" | "production" | "outbound";
export type FactoryEdge = "north" | "south" | "west" | "east";
export type FactoryArea = {
  kind: FactoryAreaKind;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  origin: "zone" | "reference";
  door?: {
    edge: FactoryEdge;
    x: number;
    z: number;
    width: number;
    rotation: number;
  };
};
type Floor = { width: number; depth: number; zones: FloorZone[] };
export const factoryZoneSuggestions = [
  "Inbound / loading",
  "Warehouse / inventory",
  "Production / assembly",
  "Outbound / dispatch",
  "Personnel entrance",
  "Exit",
];
export const factoryAreaTitles: Record<FactoryAreaKind, string> = {
  inbound: "Inbound / loading",
  storage: "Warehouse / inventory",
  production: "Production",
  outbound: "Outbound / exit",
};
export const factoryAreaColors: Record<FactoryAreaKind, string> = {
  inbound: "#177e83",
  storage: "#53749a",
  production: "#668379",
  outbound: "#c57934",
};
export function factoryZoneKind(name: string): FactoryAreaKind | undefined {
  if (/\b(outbound|dispatch|shipping|exit|outlet)\b/i.test(name))
    return "outbound";
  if (/\b(inbound|receiving|loading|entrance|entry|input)\b/i.test(name))
    return "inbound";
  if (/\b(warehouse|inventory|storage|stores|stockroom)\b/i.test(name))
    return "storage";
  if (/\b(production|assembly|manufacturing|process|packaging)\b/i.test(name))
    return "production";
}
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
export function factoryAreas(floor: Floor): FactoryArea[] {
  const { width: w, depth: d } = floor;
  const bayWidth = Math.min(5, Math.max(1.2, w * 0.18));
  const defaults: Record<
    FactoryAreaKind,
    Omit<FactoryArea, "kind" | "name" | "origin">
  > = {
    inbound: {
      x: -w * 0.32 - bayWidth / 2,
      z: d / 2 - 1.25,
      width: bayWidth,
      depth: 1.15,
    },
    storage: {
      x: -Math.min(10, w * 0.55) / 2,
      z: -d / 2 - 1.25,
      width: Math.min(10, w * 0.55),
      depth: 1.15,
    },
    production: {
      x: -w * 0.17,
      z: -d * 0.18,
      width: w * 0.34,
      depth: d * 0.36,
    },
    outbound: {
      x: w * 0.32 - bayWidth / 2,
      z: d / 2 - 1.25,
      width: bayWidth,
      depth: 1.15,
    },
  };
  const areas: FactoryArea[] = [];
  for (const kind of [
    "inbound",
    "storage",
    "production",
    "outbound",
  ] as const) {
    const zones = floor.zones.filter(
      (zone) => factoryZoneKind(zone.name) === kind,
    );
    if (zones.length)
      areas.push(
        ...zones.map((zone) => ({ ...zone, kind, origin: "zone" as const })),
      );
    else
      areas.push({
        ...defaults[kind],
        kind,
        name: factoryAreaTitles[kind],
        origin: "reference",
      });
  }
  for (const area of areas) {
    if (area.kind !== "inbound" && area.kind !== "outbound") continue;
    const cx = area.x + area.width / 2,
      cz = area.z + area.depth / 2;
    const candidates: [FactoryEdge, number][] = [
      ["north", Math.abs(area.z + d / 2)],
      ["south", Math.abs(d / 2 - area.z - area.depth)],
      ["west", Math.abs(area.x + w / 2)],
      ["east", Math.abs(w / 2 - area.x - area.width)],
    ];
    const edge =
      area.origin === "reference"
        ? "south"
        : candidates.sort((a, b) => a[1] - b[1])[0][0];
    const horizontal = edge === "north" || edge === "south";
    const doorWidth = Math.min(
      4.2,
      Math.max(1, (horizontal ? area.width : area.depth) * 0.8),
    );
    area.door = {
      edge,
      width: doorWidth,
      rotation: horizontal ? 0 : Math.PI / 2,
      x: horizontal
        ? clamp(
            cx,
            -(w + 3) / 2 + doorWidth / 2 + 0.3,
            (w + 3) / 2 - doorWidth / 2 - 0.3,
          )
        : ((edge === "west" ? -1 : 1) * (w + 3)) / 2,
      z: horizontal
        ? ((edge === "north" ? -1 : 1) * (d + 3)) / 2
        : clamp(
            cz,
            -(d + 3) / 2 + doorWidth / 2 + 0.3,
            (d + 3) / 2 - doorWidth / 2 - 0.3,
          ),
    };
  }
  const storage = areas.find(
    (area) => area.kind === "storage" && area.origin === "reference",
  );
  if (storage) {
    const free = factoryWallSpans(areas, "north", w + 3).sort(
      (a, b) => b[1] - b[0] - (a[1] - a[0]),
    )[0];
    if (free && free[1] - free[0] > 1.4) {
      storage.width = Math.min(storage.width, free[1] - free[0] - 0.5);
      storage.x = (free[0] + free[1] - storage.width) / 2;
    }
  }
  return areas;
}
/** Solid wall spans leave real openings for named receiving/exit zones. */
export function factoryWallSpans(
  areas: FactoryArea[],
  edge: FactoryEdge,
  length: number,
): [number, number][] {
  const openings = areas
    .filter((area) => area.door?.edge === edge)
    .map((area) => {
      const door = area.door!,
        axis = edge === "north" || edge === "south" ? door.x : door.z;
      return [
        Math.max(-length / 2, axis - door.width / 2 - 0.16),
        Math.min(length / 2, axis + door.width / 2 + 0.16),
      ];
    })
    .sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let cursor = -length / 2;
  for (const [start, end] of openings) {
    if (start > cursor) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length / 2) spans.push([cursor, length / 2]);
  return spans;
}
