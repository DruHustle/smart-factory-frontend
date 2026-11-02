import type { InventoryItem } from "@shared/inventory";
import {
  DIAGRAM_KIND_LABELS,
  validateFactoryDiagram,
  type DiagramConnection,
  type DrawingMetadata,
  type FactoryDiagram,
} from "./factory-diagrams";

export const engineeringFields = [
  ["service", "Process service / medium"],
  ["nominalSize", "Nominal pipe size"],
  ["material", "Pipe material / class"],
  ["designPressure", "Design pressure (with units)"],
  ["designTemperature", "Design temperature (with units)"],
  ["voltage", "Voltage (with units)"],
  ["conductor", "Conductor / cable size"],
  ["protection", "Protective device / rating"],
  ["signal", "Signal / protocol"],
] as const;
export const emptyDrawingMetadata = (): DrawingMetadata => ({
  project: "",
  number: "",
  revision: "",
  preparedBy: "",
  checkedBy: "",
  date: "",
  sheetPrefix: "",
  purpose: "draft",
});
export type DrawingIssue = {
  severity: "error" | "missing";
  target: string;
  field: string;
  message: string;
};
const tag = (item: InventoryItem) =>
  item.factoryTag?.trim() || item.identifier.trim();
const requiredFields: Record<
  DiagramConnection["kind"],
  Array<keyof NonNullable<DiagramConnection["engineering"]>>
> = {
  process: [
    "service",
    "nominalSize",
    "material",
    "designPressure",
    "designTemperature",
  ],
  instrument: ["signal"],
  power: ["voltage", "conductor", "protection"],
  control: ["signal", "conductor"],
  earth: ["conductor"],
  communication: ["signal", "conductor"],
};
export function drawingIssues(
  document: FactoryDiagram,
  items: InventoryItem[],
): DrawingIssue[] {
  validateFactoryDiagram(document);
  const issues: DrawingIssue[] = [],
    refs = new Map(items.map((i) => [i.ref, i])),
    tags = new Map<string, string>();
  const add = (
    severity: DrawingIssue["severity"],
    target: string,
    field: string,
    message: string,
  ) => issues.push({ severity, target, field, message });
  const metadata = document.drawing ?? emptyDrawingMetadata();
  for (const field of [
    "project",
    "number",
    "revision",
    "preparedBy",
    "date",
    "sheetPrefix",
  ] as const)
    if (!metadata[field]) add("missing", "Drawing", field, "Not supplied");
  if (metadata.purpose === "review" && !metadata.checkedBy)
    add("missing", "Drawing", "checkedBy", "Checker not supplied");
  if (!document.connections.length)
    add(
      "error",
      "Drawing",
      "connections",
      "Add documented connections before exporting an engineering drawing.",
    );
  for (const ref of new Set(
    document.connections.flatMap((c) => [c.from, c.to]),
  )) {
    const item = refs.get(ref);
    if (!item) {
      add(
        "error",
        ref,
        "equipment",
        "Endpoint is unavailable in this factory. Restore its record or correct the connection; it cannot be omitted from CAD.",
      );
      continue;
    }
    const value = tag(item);
    if (!value)
      add(
        "missing",
        item.name,
        "equipment tag",
        "Not supplied; inventory reference will identify this item.",
      );
    else if (
      tags.has(value.toLowerCase()) &&
      tags.get(value.toLowerCase()) !== ref
    )
      add(
        "error",
        value,
        "equipment tag",
        "Equipment tags must be unique within the drawing.",
      );
    else tags.set(value.toLowerCase(), ref);
  }
  for (const c of document.connections) {
    const target = c.designation || c.label;
    for (const field of [
      "designation",
      "fromTerminal",
      "toTerminal",
      "specification",
    ] as const)
      if (!c[field]?.trim()) add("missing", target, field, "Not supplied");
    // A multi-core cable or segmented process line can legitimately share a
    // designation. Connection IDs and terminal pairs distinguish its members.
    if (c.kind === "process" && c.direction === "none")
      add("missing", target, "direction", "Flow direction not supplied");
    for (const field of requiredFields[c.kind])
      if (!c.engineering?.[field]?.trim())
        add("missing", target, field, "Not supplied");
    const quantity =
      "[+-]?\\d+(?:[.,]\\d+)?(?:\\s*(?:-|to|\\.\\.)\\s*[+-]?\\d+(?:[.,]\\d+)?)?\\s*";
    for (const [field, suffix] of [
      ["voltage", "(?:k?V)\\s*(?:AC|DC)?"],
      ["designPressure", "(?:m?bar(?:[ag]|\\([ag]\\))?|[kM]?Pa|psi[ag]?)"],
      ["designTemperature", "(?:°?\\s*[CF]|K)"],
    ] as const)
      if (
        c.engineering?.[field] &&
        !new RegExp(`^${quantity}${suffix}$`, "i").test(
          c.engineering[field]!.trim(),
        )
      )
        add(
          "error",
          target,
          field,
          "Include explicit engineering units; a bare number or unspecified unit is ambiguous.",
        );
  }
  return issues;
}

type Point = [number, number];
export type DrawingPrimitive =
  | { type: "line"; layer: string; points: Point[] }
  | { type: "circle"; layer: string; at: Point; radius: number }
  | {
      type: "text";
      layer: string;
      at: Point;
      height: number;
      value: string;
      width: number;
    }
  | {
      type: "insert";
      layer: string;
      at: Point;
      block: string;
      attributes: Record<string, string>;
    };
export type DrawingSheet = {
  id: string;
  title: string;
  primitives: DrawingPrimitive[];
};
export type EngineeringDrawing = {
  sheets: DrawingSheet[];
  blocks: Record<string, DrawingPrimitive[]>;
  issues: DrawingIssue[];
  status: string;
  metadata: DrawingMetadata;
  document: FactoryDiagram;
};
export const drawingLayers: Record<
  string,
  { weight: number; dash?: number[] }
> = {
  FRAME: { weight: 0.5 },
  EQUIPMENT: { weight: 0.35 },
  TAGS: { weight: 0.25 },
  TERMINALS: { weight: 0.18 },
  PROCESS: { weight: 0.5 },
  INSTRUMENT: { weight: 0.25, dash: [2, 1] },
  POWER: { weight: 0.5 },
  CONTROL: { weight: 0.25, dash: [3, 1] },
  EARTH: { weight: 0.35, dash: [4, 1, 0.5, 1] },
  COMMUNICATION: { weight: 0.25, dash: [0.5, 1] },
  TEXT: { weight: 0.18 },
  NOTES: { weight: 0.18 },
};
const line = (out: DrawingPrimitive[], layer: string, ...points: Point[]) =>
  out.push({ type: "line", layer, points });
const shortValue = (value: string, maximum: number) =>
  value.length > maximum ? `${value.slice(0, maximum - 3)}...` : value;

const text = (
  out: DrawingPrimitive[],
  x: number,
  y: number,
  value: string,
  height = 2.5,
  layer = "TEXT",
  width = 406 - x,
) => {
  height = Math.max(2.5, height);
  // Bound display labels without making them illegibly narrow. The complete
  // supplied value is retained in the schedule and equipment attributes.
  const max = Math.max(4, Math.floor(width / (height * 1.5)));
  const display = value.length > max ? `${value.slice(0, max - 3)}...` : value;
  out.push({ type: "text", layer, at: [x, y], height, value: display, width });
};
const rect = (
  out: DrawingPrimitive[],
  x: number,
  y: number,
  w: number,
  h: number,
  layer = "FRAME",
) => line(out, layer, [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]);
export function drawingTextLines(value: string, max = 70) {
  const result: string[] = [];
  let current = "";
  for (const token of value.split(/\s+/)) {
    for (let i = 0; i < token.length; i += max) {
      const part = token.slice(i, i + max);
      if (current && current.length + part.length + 1 > max) {
        result.push(current);
        current = "";
      }
      current += (current ? " " : "") + part;
    }
  }
  if (current) result.push(current);
  return result;
}
function symbol(
  item: InventoryItem,
  mode: FactoryDiagram["mode"],
): DrawingPrimitive[] {
  const out: DrawingPrimitive[] = [],
    type = item.itemType.toLowerCase();
  const circle = (r: number) =>
    out.push({ type: "circle", layer: "EQUIPMENT", at: [0, 0], radius: r });
  if (/motor/.test(type)) {
    circle(7);
    text(out, -2, 2, "M", 5, "EQUIPMENT");
  } else if (mode === "process" && /pump|compressor/.test(type)) {
    circle(7);
    text(out, -2, 2, "P", 5, "EQUIPMENT", 6);
  } else if (mode === "process" && /valve/.test(type))
    line(out, "EQUIPMENT", [-7, -5], [7, 5], [7, -5], [-7, 5], [-7, -5]);
  else if (mode === "process" && /tank|vessel|mixer/.test(type)) {
    rect(out, -8, -10, 16, 20, "EQUIPMENT");
    line(out, "EQUIPMENT", [-8, -7], [8, -7]);
  } else if (/sensor|instrument|transmitter|meter/.test(type)) {
    circle(7);
    line(out, "EQUIPMENT", [-7, 0], [7, 0]);
  } else {
    rect(out, -10, -8, 20, 16, "EQUIPMENT");
    line(out, "EQUIPMENT", [-6, -3], [6, -3]);
  }
  line(out, "TERMINALS", [-12, 0], [-7, 0]);
  line(out, "TERMINALS", [7, 0], [12, 0]);
  return out;
}

/** Full-scope deterministic sheets. Every connection is drawn once in detail;
 * repeated equipment blocks carry the same inventory identity across sheets. */
export function buildEngineeringDrawing(
  input: FactoryDiagram,
  items: InventoryItem[],
): EngineeringDrawing {
  const document = validateFactoryDiagram(input),
    issues = drawingIssues(document, items);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length)
    throw Error(errors.map((i) => `${i.target}: ${i.message}`).join("\n"));
  const metadata = document.drawing ?? emptyDrawingMetadata(),
    refs = new Map(items.map((i) => [i.ref, i]));
  const used = [
    ...new Set(document.connections.flatMap((c) => [c.from, c.to])),
  ].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const demo = used.some((ref) => {
    const i = refs.get(ref)!;
    return i.isDemo || i.sandbox || i.mode === "simulated";
  });
  const status = demo
    ? "ILLUSTRATIVE DEMO - NOT FOR CONSTRUCTION"
    : issues.length
      ? "DRAFT - INCOMPLETE ENGINEERING DATA"
      : metadata.purpose === "review"
        ? "FOR ENGINEERING REVIEW - NOT FOR CONSTRUCTION"
        : "DRAFT - NOT FOR CONSTRUCTION";
  const sheets: DrawingSheet[] = [],
    blocks: EngineeringDrawing["blocks"] = {};
  const names = new Map(
    used.map((ref, i) => [ref, `SF_EQ_${String(i + 1).padStart(4, "0")}`]),
  );
  used.forEach((ref) => {
    blocks[names.get(ref)!] = symbol(refs.get(ref)!, document.mode);
  });
  const newSheet = (title: string) => {
    const sheet = {
      id: `${metadata.sheetPrefix || (document.mode === "process" ? "P" : "E")}-${String(sheets.length + 1).padStart(3, "0")}`,
      title,
      primitives: [] as DrawingPrimitive[],
    };
    sheets.push(sheet);
    return sheet;
  };
  // Limit each overview to four connections. Dense multi-core runs get
  // continuation sheets instead of overlapping labels or invented junctions.
  const groups = Array.from(
    { length: Math.ceil(used.length / 6) },
    (_, page) => {
      const groupRefs = new Set(used.slice(page * 6, page * 6 + 6));
      return document.connections.flatMap((c, index) =>
        groupRefs.has(c.from) || groupRefs.has(c.to) ? [index] : [],
      );
    },
  );
  const topology = groups.map((connections, group) =>
    Array.from({ length: Math.ceil(connections.length / 4) }, (_, part) => ({
      sheet: newSheet(
        `${document.mode === "process" ? "Process / P&ID" : "Electrical"} topology - group ${group + 1}, sheet ${part + 1}`,
      ),
      connections: connections.slice(part * 4, part * 4 + 4),
    })),
  );
  const connectionSheet = (group: number, index: number) =>
    topology[group].find((part) => part.connections.includes(index))!.sheet;
  const positions = new Map(
    used.map((ref, i) => [
      ref,
      {
        page: Math.floor(i / 6),
        x: 60 + (i % 3) * 140,
        y: 75 + Math.floor((i % 6) / 3) * 100,
      },
    ]),
  );
  used.forEach((ref) => {
    const p = positions.get(ref)!,
      item = refs.get(ref)!,
      parts = topology[p.page];
    for (const { sheet } of parts) {
      const out = sheet.primitives;
      out.push({
        type: "insert",
        layer: "EQUIPMENT",
        at: [p.x, p.y],
        block: names.get(ref)!,
        attributes: {
          TAG: tag(item) || "NOT SUPPLIED",
          REF: ref,
          NAME: item.name,
          TYPE: item.itemType,
        },
      });
      text(out, p.x - 35, p.y + 16, tag(item) || ref, 3, "TAGS", 70);
      drawingTextLines(item.name, 38)
        .slice(0, 2)
        .forEach((s, i) =>
          text(out, p.x - 35, p.y + 21 + i * 3.2, s, 2.5, "TEXT", 70),
        );
    }
  });
  document.connections.forEach((c, i) => {
    const a = positions.get(c.from)!,
      b = positions.get(c.to)!,
      layer = c.kind.toUpperCase(),
      key = `C${String(i + 1).padStart(3, "0")}`;
    if (a.page === b.page) {
      const sheet = connectionSheet(a.page, i),
        out = sheet.primitives,
        sign = b.x >= a.x ? 1 : -1;
      const ax = a.x + sign * 12,
        bx = b.x - sign * 12,
        lane = Math.min(a.y, b.y) - 20 - (groups[a.page].indexOf(i) % 4) * 6;
      line(
        out,
        layer,
        [ax, a.y],
        [ax + sign * 12, a.y],
        [ax + sign * 12, lane],
        [bx - sign * 12, lane],
        [bx - sign * 12, b.y],
        [bx, b.y],
      );
      text(out, (ax + bx) / 2 - 7, lane - 2, key, 2.5, "TAGS");
      if (c.direction === "forward" || c.direction === "both")
        line(
          out,
          layer,
          [bx - sign * 4, b.y - 2],
          [bx, b.y],
          [bx - sign * 4, b.y + 2],
        );
      if (c.direction === "reverse" || c.direction === "both")
        line(
          out,
          layer,
          [ax + sign * 4, a.y - 2],
          [ax, a.y],
          [ax + sign * 4, a.y + 2],
        );
    } else {
      for (const [p, other] of [
        [a, b],
        [b, a],
      ]) {
        // Join an actual symbol port. Route outside the name column and below
        // the equipment, clear of the overview wires and callout text.
        const out = connectionSheet(p.page, i).primitives,
          dy = 30 + (groups[p.page].indexOf(i) % 4) * 4;
        line(
          out,
          layer,
          [p.x + 12, p.y],
          [p.x + 40, p.y],
          [p.x + 40, p.y + dy],
          [p.x + 55, p.y + dy],
        );
        text(
          out,
          p.x + 2,
          p.y + dy + 4,
          `${key} / page ${sheets.indexOf(connectionSheet(other.page, i)) + 1}`,
          2.2,
          "TAGS",
        );
      }
    }
  });
  topology.flat().forEach(({ sheet }) => {
    text(
      sheet.primitives,
      14,
      228,
      "C### = connection detail. Crossing lines are not junctions; repeated tags identify one equipment item.",
      2.5,
      "NOTES",
    );
    text(
      sheet.primitives,
      14,
      234,
      "Four connections per overview. Off-sheet references give page numbers. Full labels are in the schedule.",
      2.3,
      "NOTES",
    );
  });
  // Four bounded interconnection details per A3 sheet keep all terminal and
  // engineering labels legible; no graph edge is guessed, dropped or shrunk.
  for (let start = 0; start < document.connections.length; start += 4) {
    const page = newSheet(
        document.mode === "process"
          ? "Process / P&ID connection details"
          : "Electrical interconnection diagram",
      ),
      out = page.primitives;
    document.connections.slice(start, start + 4).forEach((c, row) => {
      const y = 45 + row * 47,
        from = refs.get(c.from)!,
        to = refs.get(c.to)!,
        layer = c.kind.toUpperCase();
      text(
        out,
        14,
        y - 15,
        `${String(start + row + 1).padStart(3, "0")}  ${c.designation || "TAG NOT SUPPLIED"}  |  ${DIAGRAM_KIND_LABELS[c.kind]}`,
        3,
        "TAGS",
      );
      for (const [item, x, end] of [
        [from, 55, "from"],
        [to, 365, "to"],
      ] as const) {
        out.push({
          type: "insert",
          layer: "EQUIPMENT",
          at: [x, y],
          block: names.get(item.ref)!,
          attributes: {
            TAG: tag(item) || "NOT SUPPLIED",
            REF: item.ref,
            NAME: item.name,
            TYPE: item.itemType,
          },
        });
        text(out, x - 35, y + 15, tag(item) || item.ref, 2.8, "TAGS", 70);
        drawingTextLines(item.name, 35)
          .slice(0, 2)
          .forEach((s, i) =>
            text(out, x - 35, y + 19 + i * 3.2, s, 2.5, "TEXT", 70),
          );
        out.push({
          type: "circle",
          layer: "TERMINALS",
          at: [x + (end === "from" ? 12 : -12), y],
          radius: 1,
        });
        text(
          out,
          end === "from" ? 70 : 280,
          y - 3,
          c[end === "from" ? "fromTerminal" : "toTerminal"] ||
            "TERMINAL NOT SUPPLIED",
          2.4,
          "TERMINALS",
          65,
        );
      }
      line(out, layer, [67, y], [353, y]);
      if (c.direction === "forward" || c.direction === "both")
        line(out, layer, [228, y - 2], [232, y], [228, y + 2]);
      if (c.direction === "reverse" || c.direction === "both")
        line(out, layer, [192, y - 2], [188, y], [192, y + 2]);
      text(out, 120, y - 6, c.label, 2.6);
      const eng = engineeringFields
        .filter(([key]) => c.engineering?.[key])
        .map(
          ([key, label]) =>
            `${label.replace(" (with units)", "")}: ${c.engineering![key]}`,
        );
      const details = `${c.specification || "Specification: NOT SUPPLIED"}${eng.length ? " | " + eng.join(" | ") : ""}`;
      // Full text is preserved on continuation sheets below when lengthy.
      drawingTextLines(details, 100)
        .slice(0, 2)
        .forEach((s, i) => text(out, 105, y + 7 + i * 3.5, s, 2.4));
      text(
        out,
        105,
        y + 17,
        `Direction: ${c.direction === "none" ? "NOT SUPPLIED" : c.direction} | Detail reference: ${String(start + row + 1).padStart(3, "0")}`,
        2.2,
        "NOTES",
      );
      line(out, "NOTES", [14, y + 28], [406, y + 28]);
    });
  }
  // The schedule is authoritative text, including long names/specifications
  // and all supplied engineering fields, even when a diagram label is shortened.
  let schedule = newSheet("Equipment and connection schedule"),
    sy = 32;
  const scheduleLine = (value: string, size = 2.5) => {
    const parts = drawingTextLines(value, Math.floor(392 / (size * 1.5)));
    // Keep every supplied field together, including long identifiers.
    if (sy + (parts.length - 1) * 4 > 230) {
      schedule = newSheet("Schedule continuation");
      sy = 32;
    }
    for (const part of parts) {
      text(schedule.primitives, 14, sy, part, size);
      sy += 4;
    }
  };
  scheduleLine(`Drawing title: ${document.title}`);
  for (const [key, value] of Object.entries(metadata))
    scheduleLine(`${key}: ${value || "NOT SUPPLIED"}`);
  sy += 4;
  used.forEach((ref) => {
    const item = refs.get(ref)!;
    scheduleLine(
      `EQUIPMENT ${tag(item) || "NOT SUPPLIED"} | ${item.name} | Type: ${item.itemType} | Inventory: ${ref}`,
    );
  });
  sy += 4;
  document.connections.forEach((c, i) => {
    scheduleLine(
      `${String(i + 1).padStart(3, "0")} ${c.designation || "TAG NOT SUPPLIED"} | ${c.label} | ${DIAGRAM_KIND_LABELS[c.kind]}`,
      2.8,
    );
    scheduleLine(`Connection ID: ${c.id}`);
    scheduleLine(
      `FROM ${tag(refs.get(c.from)!) || c.from} / ${c.fromTerminal || "TERMINAL NOT SUPPLIED"} TO ${tag(refs.get(c.to)!) || c.to} / ${c.toTerminal || "TERMINAL NOT SUPPLIED"} | direction: ${c.direction}`,
    );
    scheduleLine(`Specification: ${c.specification || "NOT SUPPLIED"}`);
    for (const key of requiredFields[c.kind])
      scheduleLine(
        `${engineeringFields.find((f) => f[0] === key)![1]}: ${c.engineering?.[key] || "NOT SUPPLIED"}`,
      );
    for (const [key, label] of engineeringFields)
      if (!requiredFields[c.kind].includes(key) && c.engineering?.[key])
        scheduleLine(`${label}: ${c.engineering[key]}`);
    sy += 2;
  });
  if (issues.length) {
    sy += 4;
    scheduleLine("MISSING ENGINEERING INFORMATION", 3);
    issues.forEach((i) =>
      scheduleLine(`${i.target} | ${i.field}: ${i.message}`),
    );
  }
  for (const [i, sheet] of sheets.entries()) {
    const out = sheet.primitives;
    rect(out, 10, 10, 400, 277);
    text(out, 14, 18, document.title, 4, "TAGS");
    text(out, 14, 24, `${sheet.id} | ${sheet.title}`, 2.7);
    rect(out, 10, 246, 400, 41);
    line(out, "FRAME", [10, 258], [410, 258]);
    line(out, "FRAME", [10, 271], [410, 271]);
    line(out, "FRAME", [265, 258], [265, 287]);
    line(out, "FRAME", [340, 258], [340, 287]);
    text(out, 14, 251, status, 3, "TAGS");
    text(
      out,
      14,
      256,
      "Generic symbols and supplied connections only. Labels ending ... continue in full in the schedule.",
      2.2,
      "NOTES",
    );
    text(
      out,
      14,
      263,
      `Project: ${metadata.project || "NOT SUPPLIED"}`,
      2.8,
      "TEXT",
      245,
    );
    text(
      out,
      14,
      268,
      `Drawing: ${shortValue(metadata.number || "NOT SUPPLIED", 26)} | Rev: ${shortValue(metadata.revision || "NOT SUPPLIED", 14)}`,
      2.8,
      "TEXT",
      245,
    );
    text(
      out,
      269,
      263,
      `Sheet: #${String(i + 1).padStart(3, "0")}`,
      2.8,
      "TEXT",
      67,
    );
    text(out, 269, 268, `${i + 1} / ${sheets.length} | A3`, 2.5, "TEXT", 67);
    text(out, 344, 263, "SCHEMATIC - NTS", 2.5);
    text(out, 344, 268, "Units: mm", 2.4);
    text(
      out,
      14,
      277,
      `Prepared: ${shortValue(metadata.preparedBy || "NOT SUPPLIED", 20)} | Checked: ${shortValue(metadata.checkedBy || "NOT SUPPLIED", 20)}`,
      2.6,
      "TEXT",
      245,
    );
    text(
      out,
      14,
      283,
      `Date: ${metadata.date || "NOT SUPPLIED"} | Missing fields: ${issues.length}`,
      2.6,
    );
    text(out, 269, 277, "Full drawing", 2.5, "TEXT", 67);
    text(out, 269, 283, "Unsurveyed", 2.5, "TEXT", 67);
    text(out, 344, 277, "Smart Factory", 2.7);
    text(
      out,
      344,
      283,
      document.mode === "process" ? "Process" : "Electrical",
      2.2,
    );
  }
  return { sheets, blocks, issues, status, metadata, document };
}

export const xmlEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const drawingTextScale = (
  _p: Extract<DrawingPrimitive, { type: "text" }>,
) => 1;
export function drawingSheetSvg(
  drawing: EngineeringDrawing,
  sheet: DrawingSheet,
) {
  const render = (p: DrawingPrimitive): string => {
    const style = drawingLayers[p.layer],
      common = `fill="none" stroke="#111827" stroke-width="${style.weight}"${style.dash ? ` stroke-dasharray="${style.dash.join(" ")}"` : ""}`;
    if (p.type === "line")
      return `<polyline points="${p.points.map((a) => a.join(",")).join(" ")}" ${common}/>`;
    if (p.type === "circle")
      return `<circle cx="${p.at[0]}" cy="${p.at[1]}" r="${p.radius}" ${common}/>`;
    if (p.type === "text")
      return `<text transform="translate(${p.at[0]} ${p.at[1]}) scale(${drawingTextScale(p)} 1)" font-size="${p.height / 0.72}" fill="#111827" font-family="Arial, sans-serif">${xmlEscape(p.value)}</text>`;
    return `<g transform="translate(${p.at.join(" ")})">${drawing.blocks[p.block].map(render).join("")}</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297" role="img" aria-label="${xmlEscape(sheet.title)}"><rect width="420" height="297" fill="white"/>${sheet.primitives.map(render).join("")}</svg>`;
}
export function drawingPrintHtml(drawing: EngineeringDrawing) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${xmlEscape(drawing.document.title)}</title><style>@page{size:A3 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#dce1e7}.sheet{width:420mm;height:297mm;background:white;margin:8mm auto;break-after:page}.sheet:last-child{break-after:auto}svg{display:block;width:420mm;height:297mm}@media print{body{background:white}.sheet{margin:0}.no-print{display:none!important}}</style></head><body>${drawing.sheets.map((sheet) => `<section class="sheet" data-sheet="${xmlEscape(sheet.id)}">${drawingSheetSvg(drawing, sheet)}</section>`).join("")}</body></html>`;
}
