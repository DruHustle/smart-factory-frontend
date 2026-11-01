import type { InventoryItem } from "./inventory";
import { referenceModels } from "./factory-models";

export type FloorLink = {
  from: string;
  to: string;
  kind: "acquisition" | "gateway" | "process" | "fx";
  label: string;
};
export type FloorPlacement = {
  item: InventoryItem;
  x: number;
  z: number;
  model: string | null;
  rotation?: number;
};
export type FloorZone = {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  count: number;
};

/** Draw only recorded parent identities that are also on this floor. */
export function gatewayLinksForFloor(items: InventoryItem[]): FloorLink[] {
  const parents = new Map(
    items
      .filter((item) => item.kind === "device" && item.itemType === "gateway")
      .map((item) => [item.identifier, item]),
  );
  return items.flatMap((item) => {
    if (item.kind !== "device" || !item.gatewayId) return [];
    const parent = parents.get(item.gatewayId);
    if (!parent || parent.ref === item.ref) return [];
    return [
      {
        from: parent.ref,
        to: item.ref,
        kind: "gateway" as const,
        label:
          parent.identifier === "pi-edge-01" &&
          item.identifier === "esp32-wrover-01"
            ? "Pi-local MQTT/TLS"
            : "Gateway uplink",
      },
    ];
  });
}

/** Layout is illustrative; discovery does not establish physical coordinates. */
export function floorModel(
  item: Pick<InventoryItem, "itemType" | "name"> & { identifier?: string },
): string | null {
  const type = `${item.itemType} ${item.name}`.toLowerCase();
  if (
    item.identifier === "esp32-wrover-01" ||
    /(?:esp32.*wrover.*dht11|wrover.*dht11)/.test(type)
  )
    return "esp32-wrover-dht11";
  if (item.identifier === "pi-edge-01" || /raspberry\s*pi\s*5/.test(type))
    return "raspberry-pi-5";
  if (/warehouse_rack/.test(type)) return "warehouse-rack";
  if (/loading_door/.test(type)) return "loading-door";
  if (/exit_door/.test(type)) return "exit-door";
  if (/sensor|transmitter|transducer/.test(type)) return "process-sensor";
  if (/conveyor|infeed|outfeed/.test(type)) return "conveyor";
  if (/robot|palletiz/.test(type)) return "robot-arm";
  if (/tank|vessel|mixer/.test(type)) return "storage-tank";
  if (/valve/.test(type)) return "valve";
  if (/cabinet|plc|controller|switch|transformer|workstation|server/.test(type))
    return "control-cabinet";
  if (/raspberry|gateway|edge/.test(type)) return "raspberry-pi-4b";
  if (/pump|motor|compressor|turbine/.test(type)) return "pump-motor";
  return null;
}

export function layoutFactory(items: InventoryItem[]) {
  const grouped = new Map<string, InventoryItem[]>();
  for (const item of [...items].sort(
    (a, b) => a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref),
  )) {
    const name = item.zone?.trim() || item.location?.trim() || "Unassigned";
    grouped.set(name, [...(grouped.get(name) ?? []), item]);
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(grouped.size)));
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  const widths = Array(columns).fill(0) as number[];
  const depths = Array(Math.ceil(groups.length / columns)).fill(0) as number[];
  const dimensions = groups.map(([, nodes], index) => {
    const machinery = nodes.filter((item) => item.kind !== "device");
    const instruments = nodes.filter((item) => item.kind === "device");
    const cols = Math.min(
      3,
      Math.max(2, Math.ceil(Math.sqrt(machinery.length))),
    );
    const instrumentCols = Math.min(
      6,
      Math.max(2, Math.floor((cols * 3.7) / 1.2)),
    );
    const instrumentRows = Math.ceil(instruments.length / instrumentCols);
    const width = Math.max(cols * 3.7 + 2.2, instrumentCols * 1.2 + 2.4);
    const depth = Math.max(
      7,
      Math.ceil(machinery.length / cols) * 3.6 + instrumentRows * 1.25 + 3.4,
    );
    widths[index % columns] = Math.max(widths[index % columns], width);
    depths[Math.floor(index / columns)] = Math.max(
      depths[Math.floor(index / columns)],
      depth,
    );
    return {
      cols,
      width,
      depth,
      machinery,
      instruments,
      instrumentCols,
      instrumentRows,
    };
  });
  const width =
      widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * 2,
    depth =
      depths.reduce((a, b) => a + b, 0) + Math.max(0, depths.length - 1) * 2;
  const placements: FloorPlacement[] = [],
    zones: FloorZone[] = [];
  groups.forEach(([name, nodes], index) => {
    const col = index % columns,
      row = Math.floor(index / columns),
      d = dimensions[index];
    const x = widths.slice(0, col).reduce((a, b) => a + b + 2, 0) - width / 2;
    const z = depths.slice(0, row).reduce((a, b) => a + b + 2, 0) - depth / 2;
    zones.push({
      name,
      x,
      z,
      width: d.width,
      depth: d.depth,
      count: nodes.length,
    });
    // Instrumentation occupies a compact service strip behind each work cell.
    // A sensor does not reserve the footprint of a production machine.
    d.instruments.forEach((item, n) =>
      placements.push({
        item,
        x: x + 1.8 + (n % d.instrumentCols) * 1.2,
        z: z + 1.8 + Math.floor(n / d.instrumentCols) * 1.25,
        model: floorModel(item),
      }),
    );
    d.machinery.forEach((item, n) =>
      placements.push({
        item,
        x: x + 2.8 + (n % d.cols) * 3.7,
        z: z + d.instrumentRows * 1.25 + 3.1 + Math.floor(n / d.cols) * 3.6,
        model: floorModel(item),
      }),
    );
  });
  return {
    placements,
    zones,
    width: Math.max(width, 12),
    depth: Math.max(depth, 12),
  };
}

export function floorModelUrl(slug: string) {
  const model = referenceModels.find((m) => m.slug === slug);
  return model
    ? `/api/equipment/reference/${slug}/model?revision=${encodeURIComponent(model.revision)}`
    : null;
}
