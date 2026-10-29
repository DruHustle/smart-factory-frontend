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
};
export type FloorZone = {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  count: number;
};

/** Layout is illustrative; discovery does not establish physical coordinates. */
export function floorModel(
  item: Pick<InventoryItem, "itemType" | "name">,
): string | null {
  const type = `${item.itemType} ${item.name}`.toLowerCase();
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
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length))));
    const width = cols * 3.5 + 3,
      depth = Math.ceil(nodes.length / cols) * 3.8 + 4;
    widths[index % columns] = Math.max(widths[index % columns], width);
    depths[Math.floor(index / columns)] = Math.max(
      depths[Math.floor(index / columns)],
      depth,
    );
    return { cols, width, depth };
  });
  const width = widths.reduce((a, b) => a + b + 2, 0),
    depth = depths.reduce((a, b) => a + b + 2, 0);
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
    nodes.forEach((item, n) =>
      placements.push({
        item,
        x: x + 2.8 + (n % d.cols) * 3.5,
        z: z + 3 + Math.floor(n / d.cols) * 3.8,
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
