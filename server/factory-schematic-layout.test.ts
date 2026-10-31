import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../shared/inventory";
import type {
  DiagramConnection,
  FactoryDiagram,
} from "../client/src/components/workspace/factory-diagrams";
import { layoutSchematic } from "../client/src/components/workspace/factory-schematic-layout";

const item = (id: number): InventoryItem => ({
  ref: `asset:${id}`,
  id: String(id),
  name: `Equipment ${id}`,
  identifier: `EQ-${id}`,
  kind: "asset",
  itemType: "pump",
  location: null,
  zone: null,
  configured: false,
  route: "Not configured",
  status: "unknown",
  lastObserved: null,
  sampleAt: null,
  mode: "live",
  quality: "unknown",
  freshnessMs: null,
  lifecycle: null,
  aas: false,
  equipmentId: null,
  firmware: null,
});
const edge = (
  id: string,
  from: number,
  to: number,
  direction: DiagramConnection["direction"] = "forward",
): DiagramConnection => ({
  id,
  from: `asset:${from}`,
  to: `asset:${to}`,
  kind: "process",
  label: id,
  direction,
});
const document = (connections: DiagramConnection[]): FactoryDiagram => ({
  version: 1,
  mode: "process",
  title: "Example process",
  connections,
});

describe("factory schematic placement", () => {
  it("lays out recycle loops and their downstream equipment without losing endpoints", () => {
    const result = layoutSchematic(
      document([
        edge("feed", 1, 2),
        edge("return", 2, 1),
        edge("product", 2, 3),
        edge("discharge", 3, 4),
      ]),
      [1, 2, 3, 4].map(item),
    );
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(4);
    const byRef = new Map(result.nodes.map((node) => [node.item.ref, node]));
    expect(byRef.get("asset:1")!.x).toBe(byRef.get("asset:2")!.x);
    expect(byRef.get("asset:3")!.x).toBeGreaterThan(byRef.get("asset:2")!.x);
    expect(byRef.get("asset:4")!.x).toBeGreaterThan(byRef.get("asset:3")!.x);
    expect(
      new Set(result.nodes.map((node) => `${node.x},${node.y}`)).size,
    ).toBe(4);
    for (const connection of result.edges)
      expect(connection.path).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("is stable across inventory and connection response ordering", () => {
    const connections = [
      edge("feed", 1, 2),
      edge("product", 2, 3),
      edge("branch", 1, 4),
    ];
    const items = [1, 2, 3, 4, 5].map(item);
    expect(layoutSchematic(document(connections), items)).toEqual(
      layoutSchematic(
        document([...connections].reverse()),
        [...items].reverse(),
      ),
    );
  });

  it("omits unavailable endpoints and keeps isolated equipment accessible without fabricating edges", () => {
    const result = layoutSchematic(document([edge("missing", 1, 99)]), [
      item(1),
      item(2),
    ]);
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.unconnected.map((entry) => entry.ref)).toEqual([
      "asset:1",
      "asset:2",
    ]);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("preserves distinct terminal connections between the same equipment", () => {
    const a = {
      ...edge("wire-a", 1, 2),
      kind: "power" as const,
      fromTerminal: "X1:1",
      toTerminal: "U1",
    };
    const b = {
      ...edge("wire-b", 1, 2),
      kind: "power" as const,
      fromTerminal: "X1:2",
      toTerminal: "V1",
    };
    const result = layoutSchematic(
      { ...document([a, b]), mode: "electrical" },
      [item(1), item(2)],
    );
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].path).not.toEqual(result.edges[1].path);
    expect(result.edges.map((entry) => entry.connection.fromTerminal)).toEqual([
      "X1:1",
      "X1:2",
    ]);
  });

  it("uses reverse flow to order the drawing without swapping the declared terminal identities", () => {
    const connection = edge("reverse", 1, 2, "reverse");
    const result = layoutSchematic(document([connection]), [item(1), item(2)]);
    expect(result.edges[0].from.item.ref).toBe("asset:1");
    expect(result.edges[0].to.item.ref).toBe("asset:2");
    expect(result.edges[0].from.x).toBeGreaterThan(result.edges[0].to.x);
    expect(result.edges[0].connection.direction).toBe("reverse");
  });

  it("keeps long processes within a bounded horizontal drawing and reads down a phone screen", () => {
    const items = Array.from({ length: 12 }, (_, index) => item(index + 1));
    const connections = items
      .slice(1)
      .map((_, index) => edge(`line-${index}`, index + 1, index + 2));
    const wide = layoutSchematic(document(connections), items);
    expect(wide.width).toBeLessThan(1200);
    expect(wide.nodes).toHaveLength(12);
    const phone = layoutSchematic(document(connections), items, true);
    expect(phone.width).toBeLessThan(400);
    expect(phone.nodes).toHaveLength(12);
    for (const connection of phone.edges)
      expect(connection.to.y).toBeGreaterThan(connection.from.y);
  });

  it("does not place reciprocal or multiple terminal circuits on one identical route", () => {
    const connections = Array.from({ length: 7 }, (_, index) => ({
      ...edge(`wire-${index}`, index % 2 ? 2 : 1, index % 2 ? 1 : 2, "none"),
      kind: "power" as const,
      fromTerminal: `X1:${index}`,
      toTerminal: `X2:${index}`,
    }));
    const result = layoutSchematic(
      { ...document(connections), mode: "electrical" },
      [item(1), item(2)],
    );
    expect(
      new Set(result.edges.map((connection) => connection.path)).size,
    ).toBe(7);
    expect(
      new Set(
        result.edges.map(
          (connection) => `${connection.labelX},${connection.labelY}`,
        ),
      ).size,
    ).toBe(7);
    expect(
      result.edges.every(
        (connection) => connection.connection.direction === "none",
      ),
    ).toBe(true);
  });
});
