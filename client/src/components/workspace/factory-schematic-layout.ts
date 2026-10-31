import type { InventoryItem } from "@shared/inventory";
import type { DiagramConnection, FactoryDiagram } from "./factory-diagrams";

export const SCHEMATIC_NODE_WIDTH = 188;
export const SCHEMATIC_NODE_HEIGHT = 108;
export type SchematicNode = {
  item: InventoryItem;
  x: number;
  y: number;
  band: number;
};
export type SchematicEdge = {
  connection: DiagramConnection;
  from: SchematicNode;
  to: SchematicNode;
  path: string;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle";
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  vertical: boolean;
};

/** A drawing layout, independent of the surveyed or illustrative floor coordinates. */
export function layoutSchematic(
  document: FactoryDiagram,
  items: InventoryItem[],
  portrait = false,
) {
  const byRef = new Map(items.map((item) => [item.ref, item]));
  const connections = [...document.connections]
    .filter(
      (edge) =>
        edge.from !== edge.to && byRef.has(edge.from) && byRef.has(edge.to),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const refs = [
    ...new Set(connections.flatMap((edge) => [edge.from, edge.to])),
  ].sort();
  const compareItems = (a: InventoryItem, b: InventoryItem) =>
    a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref);
  const connected = new Set(refs);
  const unconnected = [...byRef.values()]
    .filter((item) => !connected.has(item.ref))
    .sort(compareItems);
  const next = new Map(refs.map((ref) => [ref, new Set<string>()]));
  for (const edge of connections) {
    // Direction affects only the reading order. The renderer retains both declared endpoints.
    const from = edge.direction === "reverse" ? edge.to : edge.from;
    const to = edge.direction === "reverse" ? edge.from : edge.to;
    next.get(from)!.add(to);
    if (edge.direction === "both") next.get(to)!.add(from);
  }

  // Collapse directed cycles before assigning levels. A recycle loop must not
  // recurse forever or leave its downstream equipment without a position.
  let sequence = 0;
  const indexes = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    onStack = new Set<string>(),
    components: string[][] = [];
  function visit(ref: string) {
    indexes.set(ref, sequence);
    low.set(ref, sequence++);
    stack.push(ref);
    onStack.add(ref);
    for (const target of [...next.get(ref)!].sort()) {
      if (!indexes.has(target)) {
        visit(target);
        low.set(ref, Math.min(low.get(ref)!, low.get(target)!));
      } else if (onStack.has(target))
        low.set(ref, Math.min(low.get(ref)!, indexes.get(target)!));
    }
    if (low.get(ref) !== indexes.get(ref)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== ref);
    components.push(component.sort());
  }
  refs.forEach((ref) => {
    if (!indexes.has(ref)) visit(ref);
  });
  const membership = new Map(
    components.flatMap((members, i) => members.map((ref) => [ref, i] as const)),
  );
  const outgoing = components.map(() => new Set<number>());
  const incoming = components.map(() => 0),
    ranks = components.map(() => 0);
  for (const [from, targets] of next)
    for (const to of targets) {
      const a = membership.get(from)!,
        b = membership.get(to)!;
      if (a !== b && !outgoing[a].has(b)) {
        outgoing[a].add(b);
        incoming[b]++;
      }
    }
  const queue = components.map((_, i) => i).filter((i) => !incoming[i]);
  const sortQueue = () =>
    queue.sort((a, b) => components[a][0].localeCompare(components[b][0]));
  sortQueue();
  while (queue.length) {
    const current = queue.shift()!;
    for (const target of outgoing[current]) {
      ranks[target] = Math.max(ranks[target], ranks[current] + 1);
      if (--incoming[target] === 0) {
        queue.push(target);
        sortQueue();
      }
    }
  }
  const levels = new Map<number, InventoryItem[]>();
  for (const ref of refs) {
    const rank = ranks[membership.get(ref)!];
    levels.set(rank, [...(levels.get(rank) ?? []), byRef.get(ref)!]);
  }
  // A narrow screen reads downwards. Wider screens wrap every three levels,
  // so a long process does not shrink all its labels into one horizontal strip.
  const sortedLevels = [...levels.entries()].sort(([a], [b]) => a - b);
  const nodes: SchematicNode[] = [];
  let bandY = 48;
  if (portrait) {
    for (const [rank, level] of sortedLevels) {
      level.sort(compareItems).forEach((item, row) =>
        nodes.push({
          item,
          x: 48,
          y: bandY + row * 208,
          band: rank,
        }),
      );
      bandY += level.length * 208;
    }
  } else {
    for (let start = 0; start < sortedLevels.length; start += 3) {
      const band = sortedLevels.slice(start, start + 3);
      const rows = Math.max(...band.map(([, level]) => level.length));
      band.forEach(([, level], column) =>
        level.sort(compareItems).forEach((item, row) =>
          nodes.push({
            item,
            x: 48 + column * 300,
            y: bandY + row * 164 + (rows - level.length) * 82,
            band: Math.floor(start / 3),
          }),
        ),
      );
      bandY += rows * 164 + 80;
    }
  }
  const nodeMap = new Map(nodes.map((node) => [node.item.ref, node]));
  const outgoingTotals = new Map<string, number>(),
    incomingTotals = new Map<string, number>();
  for (const connection of connections) {
    outgoingTotals.set(
      connection.from,
      (outgoingTotals.get(connection.from) ?? 0) + 1,
    );
    incomingTotals.set(
      connection.to,
      (incomingTotals.get(connection.to) ?? 0) + 1,
    );
  }
  const outgoingUsed = new Map<string, number>(),
    incomingUsed = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const edges: SchematicEdge[] = connections.map((connection, index) => {
    const from = nodeMap.get(connection.from)!,
      to = nodeMap.get(connection.to)!;
    const pair = JSON.stringify([connection.from, connection.to].sort());
    const slot = pairCounts.get(pair) ?? 0;
    pairCounts.set(pair, slot + 1);
    const fromSlot = outgoingUsed.get(connection.from) ?? 0,
      toSlot = incomingUsed.get(connection.to) ?? 0;
    outgoingUsed.set(connection.from, fromSlot + 1);
    incomingUsed.set(connection.to, toSlot + 1);
    const portOffset = (ordinal: number, total: number) =>
      ((ordinal + 1) / (total + 1) - 0.5) * 72;
    const fromOffset = portOffset(
      fromSlot,
      outgoingTotals.get(connection.from)!,
    );
    const toOffset = portOffset(toSlot, incomingTotals.get(connection.to)!);
    let fromY = from.y + SCHEMATIC_NODE_HEIGHT / 2 + fromOffset;
    let toY = to.y + SCHEMATIC_NODE_HEIGHT / 2 + toOffset;
    let fromX = from.x + SCHEMATIC_NODE_WIDTH,
      toX = to.x;
    let path: string, labelX: number, labelY: number;
    let vertical = false;
    let labelAnchor: "start" | "middle" = "middle";
    if ((portrait && to.y > from.y) || (!portrait && to.band > from.band)) {
      vertical = true;
      fromX = from.x + SCHEMATIC_NODE_WIDTH / 2 + fromOffset;
      toX = to.x + SCHEMATIC_NODE_WIDTH / 2 + toOffset;
      fromY = from.y + SCHEMATIC_NODE_HEIGHT;
      toY = to.y;
      if (to.y - from.y > 209) {
        const channel =
          Math.max(from.x, to.x) + SCHEMATIC_NODE_WIDTH + 26 + index * 12;
        path = `M${fromX},${fromY}V${fromY + 18}H${channel}V${toY - 18}H${toX}V${toY}`;
        labelX = channel + 7;
        labelY = (fromY + toY) / 2;
      } else {
        const channel = (fromY + toY) / 2 + slot * 14;
        path = `M${fromX},${fromY}V${channel}H${toX}V${toY}`;
        labelX = Math.max(fromX, toX) + 10;
        labelY = channel - 5;
      }
      labelAnchor = "start";
    } else if (from.x === to.x) {
      // Recycle/bidirectional connections use a distinct outside return channel.
      toX = to.x + SCHEMATIC_NODE_WIDTH;
      const channel = fromX + 32 + index * 12;
      path = `M${fromX},${fromY}H${channel}V${toY}H${toX}`;
      labelX = channel + 6;
      labelY = (fromY + toY) / 2 - 5 + slot * 14;
      labelAnchor = "start";
    } else if (Math.abs(to.x - from.x) > 301 || to.x < from.x) {
      if (to.x < from.x) {
        fromX = from.x;
        toX = to.x + SCHEMATIC_NODE_WIDTH;
      }
      const sign = to.x > from.x ? 1 : -1;
      const channel = Math.max(18, Math.min(from.y, to.y) - 22 - slot * 14);
      path = `M${fromX},${fromY}H${fromX + sign * 18}V${channel}H${toX - sign * 18}V${toY}H${toX}`;
      labelX = (fromX + toX) / 2;
      labelY = channel - 6;
    } else {
      // Distinct channels and ports prevent separate cabinet feeds or sensor
      // inputs from appearing to share a fabricated junction or one label.
      const channel =
        fromX +
        (toX - fromX) * (0.25 + (0.5 * (index + 1)) / (connections.length + 1));
      path = `M${fromX},${fromY}H${channel}V${toY}H${toX}`;
      labelX = (fromX + toX) / 2;
      labelY = toY - 10 - slot * 4;
    }
    return {
      connection,
      from,
      to,
      path,
      labelX,
      labelY,
      labelAnchor,
      fromX,
      fromY,
      toX,
      toY,
      vertical,
    };
  });
  return {
    width: Math.max(
      284,
      ...nodes.map((node) => node.x + SCHEMATIC_NODE_WIDTH + 48),
      ...edges
        .filter((edge) => edge.labelAnchor === "start")
        .map((edge) => edge.labelX + 140),
    ),
    height: Math.max(
      160,
      ...nodes.map((node) => node.y + SCHEMATIC_NODE_HEIGHT + 48),
      ...edges.map((edge) => edge.labelY + 24),
    ),
    nodes,
    edges,
    unconnected,
  };
}
