import { z } from "zod";
import type { FloorLink } from "@shared/factory-floor";
import type { InventoryItem } from "@shared/inventory";

export type DiagramMode = "process" | "electrical";
export type DiagramConnectionKind =
  | "process"
  | "instrument"
  | "power"
  | "control"
  | "earth"
  | "communication";
export type DiagramConnection = {
  id: string;
  from: string;
  to: string;
  kind: DiagramConnectionKind;
  label: string;
  direction: "forward" | "reverse" | "both" | "none";
  fromTerminal?: string;
  toTerminal?: string;
  designation?: string;
  specification?: string;
};
export type FactoryDiagram = {
  version: 1;
  mode: DiagramMode;
  title: string;
  connections: DiagramConnection[];
};

export const MAX_DIAGRAM_CONNECTIONS = 500;
export const DIAGRAM_KINDS: Record<
  DiagramMode,
  readonly DiagramConnectionKind[]
> = {
  process: ["process", "instrument"],
  electrical: ["power", "control", "earth", "communication"],
};
export const DIAGRAM_KIND_LABELS: Record<DiagramConnectionKind, string> = {
  process: "Process pipe",
  instrument: "Instrument connection",
  power: "Power circuit",
  control: "Control signal",
  earth: "Protective earth",
  communication: "Communication cable",
};

const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/, {
      message: "Use a single line of text without control characters.",
    });
// Sandbox asset/device identities use large positive decimal IDs; equipment
// identities use UUIDs. Neither a URL nor an arbitrary DOM identity is an item.
const itemRef = z
  .string()
  .regex(
    /^(?:(?:asset|device):[1-9]\d{0,19}|equipment:[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i,
    { message: "Use an existing asset, device or equipment reference." },
  );
const connectionSchema = z
  .object({
    id: z.string().regex(/^[a-z\d][a-z\d:._-]{0,127}$/i, {
      message: "Use a unique connection ID of up to 128 safe characters.",
    }),
    from: itemRef,
    to: itemRef,
    kind: z.enum([
      "process",
      "instrument",
      "power",
      "control",
      "earth",
      "communication",
    ]),
    label: singleLine(160).min(1, "Enter a connection label."),
    direction: z.enum(["forward", "reverse", "both", "none"]),
    fromTerminal: singleLine(80).optional(),
    toTerminal: singleLine(80).optional(),
    designation: singleLine(120).optional(),
    specification: singleLine(240).optional(),
  })
  .strict();
const diagramSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["process", "electrical"]),
    title: singleLine(160).min(1, "Enter a drawing title."),
    connections: z.array(connectionSchema).max(MAX_DIAGRAM_CONNECTIONS),
  })
  .strict()
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>(),
      endpoints = new Set<string>();
    diagram.connections.forEach((connection, index) => {
      const add = (message: string, field?: string) =>
        ctx.addIssue({
          code: "custom",
          message,
          path: ["connections", index, ...(field ? [field] : [])],
        });
      if (connection.from === connection.to)
        add("A connection must join two different items.");
      if (!DIAGRAM_KINDS[diagram.mode].includes(connection.kind))
        add("Choose a connection type belonging to this drawing.", "kind");
      if (ids.has(connection.id))
        add("Each connection needs its own ID.", "id");
      ids.add(connection.id);
      // A cable is still the same cable when its endpoint order is reversed.
      // Terminal names allow several distinct conductors between two items.
      const pair = [
        [connection.from, connection.fromTerminal ?? ""],
        [connection.to, connection.toTerminal ?? ""],
      ].sort((a, b) => a[0].localeCompare(b[0]));
      const key = JSON.stringify([connection.kind, pair]);
      if (endpoints.has(key))
        add("This connection between these item terminals already exists.");
      endpoints.add(key);
    });
  });

/** Imported JSON and browser storage are data, never SVG/HTML or executable code. */
export function validateFactoryDiagram(
  value: unknown,
  expectedMode?: DiagramMode,
): FactoryDiagram {
  const result = diagramSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw Error(issue?.message || "This drawing could not be read.");
  }
  if (expectedMode && result.data.mode !== expectedMode)
    throw Error(`Choose a ${expectedMode} drawing for this view.`);
  return result.data;
}

export function emptyFactoryDiagram(mode: DiagramMode): FactoryDiagram {
  return {
    version: 1,
    mode,
    title:
      mode === "process"
        ? "Process / P&ID drawing"
        : "Electrical wiring drawing",
    connections: [],
  };
}

/** Only authored process edges are pipes; acquisition/network edges are not. */
export function registeredProcessDiagram(
  items: InventoryItem[],
  links: FloorLink[],
): FactoryDiagram {
  const refs = new Set(items.map((item) => item.ref));
  const seen = new Set<string>();
  const connections = links.flatMap((link): DiagramConnection[] => {
    if (
      link.kind !== "process" ||
      link.from === link.to ||
      !refs.has(link.from) ||
      !refs.has(link.to)
    )
      return [];
    const endpoints = [link.from, link.to].sort();
    const key = JSON.stringify(endpoints);
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        id: `registered-process-${endpoints.join("_")}`,
        from: link.from,
        to: link.to,
        kind: "process",
        label:
          link.label.trim().slice(0, 160) || "Registered process connection",
        // FloorLink does not carry commissioned process direction or terminals.
        direction: "none",
      },
    ];
  });
  if (connections.length > MAX_DIAGRAM_CONNECTIONS)
    throw Error(
      "Select a smaller zone to display up to 500 process connections.",
    );
  return {
    ...emptyFactoryDiagram("process"),
    title: "Registered process connections",
    connections,
  };
}

/**
 * An authored example for the explicit showcase identities, not inferred plant
 * topology. User/demo scope is checked by the caller; every endpoint also needs
 * demo evidence, so a live item cannot be pulled into an illustrative drawing.
 */
export function demoFactoryDiagram(
  mode: DiagramMode,
  items: InventoryItem[],
): FactoryDiagram {
  const eligible = items.filter(
    (item) =>
      item.isDemo === true ||
      item.sandbox === true ||
      (item.isDemo !== false && item.mode === "simulated"),
  );
  const byIdentifier = new Map<string, InventoryItem | null>();
  for (const item of eligible) {
    // An ambiguous identity must not be guessed.
    if (byIdentifier.has(item.identifier))
      byIdentifier.set(item.identifier, null);
    else byIdentifier.set(item.identifier, item);
  }
  const equipment = (key: string) => `urn:smart-factory:showcase:floor:${key}`;
  const connections: DiagramConnection[] = [];
  const add = (
    id: string,
    fromId: string,
    toId: string,
    kind: DiagramConnectionKind,
    label: string,
    direction: DiagramConnection["direction"] = "none",
  ) => {
    const from = byIdentifier.get(fromId),
      to = byIdentifier.get(toId);
    if (!from || !to || from.ref === to.ref) return;
    connections.push({
      id,
      from: from.ref,
      to: to.ref,
      kind,
      label,
      direction,
    });
  };
  if (mode === "process") {
    const flow = [
      "tank-01",
      "valve-01",
      "pump-02",
      "mixer-01",
      "tank-02",
      "tank-03",
    ];
    const labels = [
      "Feed",
      "Pump suction",
      "Transfer",
      "Mixed product",
      "Buffer transfer",
    ];
    flow
      .slice(1)
      .forEach((to, index) =>
        add(
          `example-process-${index + 1}`,
          equipment(flow[index]),
          equipment(to),
          "process",
          `Example ${labels[index].toLowerCase()}`,
          "forward",
        ),
      );
    add(
      "example-temperature",
      "showcase.floor:feed-temperature",
      equipment("tank-01"),
      "instrument",
      "Example temperature measurement",
    );
    add(
      "example-pressure",
      "showcase.floor:feed-pressure",
      equipment("pump-02"),
      "instrument",
      "Example pressure measurement",
    );
    add(
      "example-vibration",
      "showcase.floor:pump-vibration",
      equipment("pump-02"),
      "instrument",
      "Example vibration measurement",
    );
  } else {
    add(
      "example-power-1",
      equipment("cabinet-01"),
      equipment("conveyor-01"),
      "power",
      "Example conveyor supply",
    );
    add(
      "example-power-2",
      equipment("cabinet-01"),
      equipment("robot-01"),
      "power",
      "Example robot supply",
    );
    add(
      "example-power-3",
      equipment("cabinet-02"),
      equipment("conveyor-03"),
      "power",
      "Example packaging supply",
    );
    add(
      "example-control-1",
      "showcase.fx.plc:process",
      equipment("pump-02"),
      "control",
      "Example pump control",
      "forward",
    );
    add(
      "example-control-2",
      "showcase.fx.plc:process",
      equipment("valve-01"),
      "control",
      "Example valve control",
      "forward",
    );
    add(
      "example-control-3",
      "showcase.floor:feed-temperature",
      "showcase.fx.plc:process",
      "control",
      "Example temperature input",
      "forward",
    );
    add(
      "example-control-4",
      "showcase.floor:feed-pressure",
      "showcase.fx.plc:process",
      "control",
      "Example pressure input",
      "forward",
    );
  }
  return {
    version: 1,
    mode,
    title:
      mode === "process"
        ? "Illustrative demo process / P&ID"
        : "Illustrative demo electrical wiring",
    connections,
  };
}

/** Filter presentation against the current authorized inventory; retain originals for export. */
export function filterDiagramConnections(
  document: FactoryDiagram,
  items: InventoryItem[],
): { document: FactoryDiagram; omitted: number } {
  const refs = new Set(items.map((item) => item.ref));
  const connections = document.connections.filter(
    (connection) => refs.has(connection.from) && refs.has(connection.to),
  );
  return {
    document: { ...document, connections },
    omitted: document.connections.length - connections.length,
  };
}
