import type { InventoryItem } from "../../shared/inventory";
import type { FactoryDiagram } from "../../client/src/components/workspace/factory-diagrams";
export const engineeringItems: InventoryItem[] = [
  "pump",
  "tank",
  "control_cabinet",
  "motor",
].map((itemType, i) => ({
  ref: `asset:${i + 1}`,
  id: String(i + 1),
  kind: "asset",
  name: [
    "Transfer pump",
    "Feed vessel",
    "Drive control panel",
    "Agitator motor",
  ][i],
  identifier: ["P-101", "V-101", "CP-101", "M-101"][i],
  itemType,
  location: "Engineering fixture",
  zone: "Review",
  configured: false,
  isDemo: true,
  route: "",
  status: "unknown",
  lastObserved: null,
  sampleAt: null,
  mode: "simulated",
  quality: "unknown",
  freshnessMs: null,
  lifecycle: null,
  aas: false,
  equipmentId: null,
  firmware: null,
}));
export function engineeringFixture(
  mode: "process" | "electrical",
): FactoryDiagram {
  const base = {
    id: "line-101",
    from: "asset:2",
    to: "asset:1",
    kind: "process" as const,
    label: "Vessel outlet to transfer pump",
    direction: "forward" as const,
    fromTerminal: "N1",
    toTerminal: "SUCTION",
    designation: "L-101",
    specification: "DN50 stainless process line; source drawing revisionA",
    engineering: {
      service: "Water",
      nominalSize: "DN50",
      material: "316L stainless",
      designPressure: "10 bar",
      designTemperature: "80 °C",
    },
  };
  return {
    version: 1,
    mode,
    title:
      mode === "process"
        ? "Water transfer P&ID"
        : "Agitator motor interconnection",
    drawing: {
      project: "Engineering export verification",
      number: mode === "process" ? "PID-001" : "ELE-001",
      revision: "A",
      preparedBy: "Review engineer",
      checkedBy: "Drawing checker",
      date: "2026-11-01",
      sheetPrefix: mode === "process" ? "P" : "E",
      purpose: "review",
    },
    connections:
      mode === "process"
        ? [base]
        : [
            {
              id: "wire-101",
              from: "asset:3",
              to: "asset:4",
              kind: "power",
              label: "Agitator motor supply",
              direction: "none",
              fromTerminal: "X1:U,V,W",
              toTerminal: "U1,V1,W1",
              designation: "W-101",
              specification: "Three-phase motor supply from source drawing",
              engineering: {
                voltage: "400 V AC",
                conductor: "4G2.5 mm² Cu",
                protection: "QF1 / 16 A",
              },
            },
            {
              id: "earth-101",
              from: "asset:3",
              to: "asset:4",
              kind: "earth",
              label: "Protective earth",
              direction: "none",
              fromTerminal: "PE-BAR:1",
              toTerminal: "PE",
              designation: "PE-101",
              specification: "Protective-earth conductor from source drawing",
              engineering: { conductor: "2.5 mm² Cu" },
            },
          ],
  };
}

export function engineeringComplexFixture(mode: "process" | "electrical") {
  const items = Array.from({ length: 8 }, (_, i) => ({
    ...engineeringItems[i % engineeringItems.length],
    id: String(i + 1),
    ref: `asset:${i + 1}`,
    identifier: `${mode === "process" ? "P" : "E"}Q-${String(i + 1).padStart(3, "0")}`,
    name: `${["Feed vessel", "Transfer pump", "Control enclosure", "Distribution manifold"][i % 4]} ${i + 1} - documented long equipment description with service identification for review`,
  }));
  const document = engineeringFixture(mode);
  document.title =
    "Engineering branch and cross-sheet verification with retained long names and supplied values";
  document.drawing = {
    ...document.drawing!,
    project: "W".repeat(100),
    number: "DRAWING-".repeat(7) + "X".repeat(4),
    revision: "REVISION-".repeat(2) + "A".repeat(6),
    preparedBy: "W".repeat(80),
    checkedBy: "M".repeat(80),
  };
  const pairs = [
    [1, 2],
    [1, 3],
    [2, 4],
    [3, 4],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 2],
  ];
  document.connections = pairs.map(([a, b], i) => ({
    ...engineeringFixture(mode).connections[0],
    id: `branch-${i}`,
    from: `asset:${a}`,
    to: `asset:${b}`,
    designation: `${mode === "process" ? "LINE" : "CABLE"}-${String(i + 1).padStart(3, "0")}`,
    fromTerminal: `SOURCE-${i + 1}`,
    toTerminal: `DESTINATION-${i + 1}`,
    label: `Recorded branch ${i + 1}`,
    specification:
      "Documented connection specification with a long description retained completely in the schedule. ".repeat(
        2,
      ),
  }));
  document.connections[0].designation = "W".repeat(120);
  document.connections[0].fromTerminal = "M".repeat(80);
  document.connections[0].toTerminal = "W".repeat(80);
  if (mode === "electrical")
    for (let i = 0; i < 7; i++)
      document.connections.push({
        ...document.connections[1],
        id: `parallel-${i}`,
        designation: "W-COMMON",
        fromTerminal: `X1:${i + 10}`,
        toTerminal: `X2:${i + 10}`,
        label: `Separate conductor ${i + 10}`,
      });
  return { document, items };
}
