import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../shared/inventory";
import type { FloorLink } from "../shared/factory-floor";
import {
  demoFactoryDiagram,
  emptyFactoryDiagram,
  filterDiagramConnections,
  registeredProcessDiagram,
  validateFactoryDiagram,
  type DiagramConnection,
  type FactoryDiagram,
} from "../client/src/components/workspace/factory-diagrams";

const item = (
  id: number,
  identifier = `item-${id}`,
  overrides: Partial<InventoryItem> = {},
): InventoryItem => ({
  ref: `asset:${id}`,
  id: String(id),
  kind: "asset",
  name: `Item ${id}`,
  identifier,
  itemType: "pump",
  location: null,
  zone: null,
  configured: false,
  route: "Not configured",
  status: "unknown",
  lastObserved: null,
  sampleAt: null,
  mode: "unknown",
  quality: "unknown",
  freshnessMs: null,
  lifecycle: null,
  aas: false,
  equipmentId: null,
  firmware: null,
  ...overrides,
});
const connection = (
  overrides: Partial<DiagramConnection> = {},
): DiagramConnection => ({
  id: "wire-1",
  from: "asset:1",
  to: "device:2",
  kind: "power",
  label: "Motor supply",
  direction: "none",
  ...overrides,
});
const electrical = (connections = [connection()]): FactoryDiagram => ({
  version: 1,
  mode: "electrical",
  title: "Reviewed cabinet drawing",
  connections,
});

describe("factory diagram imports", () => {
  it("round-trips supplied terminals and metadata, with no invented values", () => {
    const source = electrical([
      connection({
        from: "asset:7999999999999999",
        to: "equipment:411e816a-7ae8-4d5c-954c-0665c59e421b",
        fromTerminal: "X1:2",
        toTerminal: "M1:U1",
        designation: "W-12",
        specification: "Supplied cable specification",
        direction: "both",
      }),
    ]);
    expect(
      validateFactoryDiagram(JSON.parse(JSON.stringify(source)), "electrical"),
    ).toEqual(source);
    const basic = validateFactoryDiagram(electrical()).connections[0];
    expect(basic).not.toHaveProperty("fromTerminal");
    expect(basic).not.toHaveProperty("specification");
  });

  it("rejects mismatched drawing types and network records used as wiring", () => {
    expect(() => validateFactoryDiagram(electrical(), "process")).toThrow(
      /process drawing/,
    );
    expect(() =>
      validateFactoryDiagram(electrical([connection({ kind: "instrument" })])),
    ).toThrow(/type belonging/);
    expect(() =>
      validateFactoryDiagram({
        ...emptyFactoryDiagram("process"),
        connections: [connection()],
      }),
    ).toThrow(/type belonging/);
    expect(() =>
      validateFactoryDiagram(
        electrical([connection({ kind: "gateway" as never })]),
      ),
    ).toThrow();
  });

  it("rejects unknown fields, external references, self connections and duplicate identities", () => {
    expect(() =>
      validateFactoryDiagram({ ...electrical(), svg: "<script/>" }),
    ).toThrow();
    expect(() =>
      validateFactoryDiagram(
        electrical([{ ...connection(), executable: "alert(1)" } as never]),
      ),
    ).toThrow();
    expect(() =>
      validateFactoryDiagram(
        electrical([connection({ from: "https://example.test/private" })]),
      ),
    ).toThrow(/reference/);
    expect(() =>
      validateFactoryDiagram(electrical([connection({ to: "asset:1" })])),
    ).toThrow(/different items/);
    expect(() =>
      validateFactoryDiagram(
        electrical([connection(), connection({ to: "asset:3" })]),
      ),
    ).toThrow(/own ID/);
  });

  it("rejects a reversed duplicate conductor but allows different terminals", () => {
    const first = connection({ fromTerminal: "L", toTerminal: "U" });
    const reversed = connection({
      id: "wire-2",
      from: first.to,
      to: first.from,
      fromTerminal: "U",
      toTerminal: "L",
    });
    expect(() => validateFactoryDiagram(electrical([first, reversed]))).toThrow(
      /already exists/,
    );
    const second = connection({
      id: "wire-3",
      fromTerminal: "N",
      toTerminal: "V",
    });
    expect(
      validateFactoryDiagram(electrical([first, second])).connections,
    ).toHaveLength(2);
  });

  it("bounds imports and rejects malformed and control-character values", () => {
    const many = Array.from({ length: 501 }, (_, index) =>
      connection({ id: `wire-${index}`, to: `device:${index + 2}` }),
    );
    expect(() => validateFactoryDiagram(electrical(many))).toThrow();
    expect(() =>
      validateFactoryDiagram(
        electrical([connection({ label: "x".repeat(161) })]),
      ),
    ).toThrow();
    expect(() =>
      validateFactoryDiagram(
        electrical([connection({ label: "hidden\u0000text" })]),
      ),
    ).toThrow(/control characters/);
    expect(() =>
      validateFactoryDiagram(
        electrical([connection({ direction: "inferred" as never })]),
      ),
    ).toThrow();
    expect(() => validateFactoryDiagram(null)).toThrow();
    expect(() =>
      validateFactoryDiagram({ ...electrical(), version: 2 }),
    ).toThrow();
  });
});

describe("diagram source boundaries", () => {
  it("uses only explicit process links with visible endpoints, without guessing flow direction", () => {
    const links: FloorLink[] = [
      { from: "asset:1", to: "asset:2", kind: "process", label: "Feed pipe" },
      {
        from: "asset:2",
        to: "asset:1",
        kind: "process",
        label: "Same pipe reversed",
      },
      { from: "asset:1", to: "asset:3", kind: "acquisition", label: "MQTT" },
      {
        from: "asset:1",
        to: "asset:3",
        kind: "gateway",
        label: "Gateway uplink",
      },
      { from: "asset:1", to: "asset:3", kind: "fx", label: "OPC UA FX" },
      {
        from: "asset:1",
        to: "asset:4",
        kind: "process",
        label: "Unavailable endpoint",
      },
      { from: "asset:1", to: "asset:1", kind: "process", label: "Self link" },
    ];
    const result = registeredProcessDiagram([item(1), item(2), item(3)], links);
    expect(result.connections).toEqual([
      {
        id: "registered-process-asset:1_asset:2",
        from: "asset:1",
        to: "asset:2",
        kind: "process",
        label: "Feed pipe",
        direction: "none",
      },
    ]);
    expect(validateFactoryDiagram(result)).toEqual(result);
  });

  it("keeps registered identities stable across polling order and zone filtering", () => {
    const links: FloorLink[] = [
      { from: "asset:1", to: "asset:2", kind: "process", label: "Feed" },
      { from: "asset:2", to: "asset:3", kind: "process", label: "Discharge" },
    ];
    const all = [item(1), item(2), item(3)];
    const ids = (entries: DiagramConnection[]) =>
      new Map(entries.map((c) => [c.label, c.id]));
    const original = ids(registeredProcessDiagram(all, links).connections);
    expect(
      ids(registeredProcessDiagram(all, [...links].reverse()).connections),
    ).toEqual(original);
    expect(
      registeredProcessDiagram([item(2), item(3)], links).connections[0].id,
    ).toBe(original.get("Discharge"));
  });

  it("authored demo connections require both exact showcase identities and demo evidence", () => {
    const equipment = (key: string) =>
      `urn:smart-factory:showcase:floor:${key}`;
    const demo = [
      item(1, equipment("tank-01"), { isDemo: true }),
      item(2, equipment("valve-01"), { isDemo: true }),
    ];
    const result = demoFactoryDiagram("process", demo);
    expect(result.title).toContain("Illustrative demo");
    expect(result.connections).toEqual([
      {
        id: "example-process-1",
        from: "asset:1",
        to: "asset:2",
        kind: "process",
        label: "Example feed",
        direction: "forward",
      },
    ]);
    expect(
      demoFactoryDiagram(
        "process",
        demo.map((i) => ({ ...i, isDemo: false })),
      ).connections,
    ).toEqual([]);
    expect(
      demoFactoryDiagram("process", [
        demo[0],
        { ...demo[1], isDemo: false, mode: "simulated" },
      ]).connections,
    ).toEqual([]);
    expect(demoFactoryDiagram("process", [demo[0]]).connections).toEqual([]);
    expect(
      demoFactoryDiagram("process", [
        demo[0],
        { ...demo[1], identifier: "custom-valve" },
      ]).connections,
    ).toEqual([]);
  });

  it("does not resolve ambiguous demo identities or mix arbitrary simulated assets", () => {
    const tank = item(1, "urn:smart-factory:showcase:floor:tank-01", {
      sandbox: true,
    });
    const valve = item(2, "urn:smart-factory:showcase:floor:valve-01", {
      sandbox: true,
    });
    expect(
      demoFactoryDiagram("process", [tank, valve, { ...valve, ref: "asset:3" }])
        .connections,
    ).toEqual([]);
    expect(
      demoFactoryDiagram("process", [
        item(4, "tank", { mode: "simulated" }),
        item(5, "valve", { mode: "simulated" }),
      ]).connections,
    ).toEqual([]);
  });

  it("generates electrical examples only for authored endpoints and keeps modes separate", () => {
    const items = [
      item(1, "urn:smart-factory:showcase:floor:cabinet-01", { isDemo: true }),
      item(2, "urn:smart-factory:showcase:floor:conveyor-01", { isDemo: true }),
      item(3, "showcase.fx.plc:process", { isDemo: true }),
      item(4, "urn:smart-factory:showcase:floor:pump-02", { isDemo: true }),
    ];
    const result = demoFactoryDiagram("electrical", items);
    expect(result.connections.map((c) => c.kind)).toEqual(["power", "control"]);
    expect(
      result.connections.every((c) => !c.fromTerminal && !c.toTerminal),
    ).toBe(true);
    expect(validateFactoryDiagram(result, "electrical")).toEqual(result);
    expect(demoFactoryDiagram("process", items).connections).toEqual([]);
  });

  it("filters unavailable endpoints without mutating the saved drawing", () => {
    const document = electrical([
      connection({ to: "asset:2" }),
      connection({ id: "wire-2", to: "asset:3" }),
    ]);
    const filtered = filterDiagramConnections(document, [item(1), item(2)]);
    expect(filtered.omitted).toBe(1);
    expect(filtered.document.connections).toEqual([document.connections[0]]);
    expect(document.connections).toHaveLength(2);
    expect(filterDiagramConnections(document, []).document.connections).toEqual(
      [],
    );
  });
});
