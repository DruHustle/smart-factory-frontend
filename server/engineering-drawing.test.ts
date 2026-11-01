import { describe, it, expect } from "vitest";
import {
  engineeringFixture,
  engineeringComplexFixture,
  engineeringItems,
} from "../scripts/engineering/fixtures";
import {
  buildEngineeringDrawing,
  drawingIssues,
  drawingPrintHtml,
  drawingTextScale,
} from "../client/src/components/workspace/engineering-drawing";
import { engineeringDxf } from "../client/src/components/workspace/engineering-dxf";
import { validateFactoryDiagram } from "../client/src/components/workspace/factory-diagrams";

describe("editable engineering deliverables", () => {
  for (const mode of ["process", "electrical"] as const)
    it(`${mode} retains full source metadata, terminals, topology, editable blocks and mm units`, () => {
      const document = engineeringFixture(mode),
        drawing = buildEngineeringDrawing(document, engineeringItems),
        dxf = engineeringDxf(drawing),
        html = drawingPrintHtml(drawing);
      expect(drawing.issues).toEqual([]);
      expect(drawing.sheets.length).toBe(3);
      expect(drawing.status).toContain("ILLUSTRATIVE DEMO");
      expect(dxf).toContain("$INSUNITS\n70\n4");
      expect(dxf).toContain("AC1021");
      expect(dxf).toContain("\nINSERT\n");
      expect(dxf).toContain("\nATTRIB\n");
      expect(dxf).not.toContain("\nIMAGE\n");
      for (const c of document.connections) {
        expect(html).toContain(c.designation);
        expect(html).toContain(c.fromTerminal);
        expect(html).toContain(c.toTerminal);
      }
      expect(html).toContain("size:A3 landscape");
      expect(html).toContain("SCHEMATIC - NTS");
      expect(html).toContain("NOT FOR CONSTRUCTION");
    });
  it("roundtrips optional engineering fields without rewriting legacy documents", () => {
    const legacy = {
      version: 1,
      mode: "electrical",
      title: "Existing drawing",
      connections: [],
    };
    expect(validateFactoryDiagram(legacy)).toEqual(legacy);
    const document = engineeringFixture("electrical");
    expect(
      validateFactoryDiagram(JSON.parse(JSON.stringify(document))),
    ).toEqual(document);
    expect(() =>
      validateFactoryDiagram({
        ...document,
        drawing: { ...document.drawing, date: "2026-02-30" },
      }),
    ).toThrow("valid drawing date");
    expect(() =>
      validateFactoryDiagram({
        ...document,
        connections: [
          {
            ...document.connections[0],
            engineering: { voltage: "24 V", execute: "bad" },
          },
        ],
      }),
    ).toThrow();
  });
  it("reports incomplete engineering and refuses unavailable endpoints or ambiguous units", () => {
    const document = engineeringFixture("process");
    delete document.drawing;
    delete document.connections[0].engineering;
    const drawing = buildEngineeringDrawing(
      document,
      engineeringItems.map((i) => ({ ...i, isDemo: false, mode: "live" })),
    );
    expect(drawing.status).toContain("INCOMPLETE");
    expect(drawing.issues.some((i) => i.field === "designPressure")).toBe(true);
    expect(drawingPrintHtml(drawing)).toContain("NOT SUPPLIED");
    expect(() =>
      buildEngineeringDrawing(
        document,
        engineeringItems.filter((i) => i.ref !== "asset:1"),
      ),
    ).toThrow("Endpoint is unavailable");
    document.connections[0].engineering = { designPressure: "10" };
    expect(() => buildEngineeringDrawing(document, engineeringItems)).toThrow(
      "explicit engineering units",
    );
  });
  it("preserves multiple conductors sharing a cable designation and never infers wiring from inventory alone", () => {
    const document = engineeringFixture("electrical");
    document.connections[1].designation = document.connections[0].designation;
    expect(
      drawingIssues(document, engineeringItems).filter(
        (i) => i.severity === "error",
      ),
    ).toEqual([]);
    expect(() =>
      buildEngineeringDrawing(
        { ...document, connections: [] },
        engineeringItems,
      ),
    ).toThrow("Add documented connections");
  });
  it("escapes untrusted labels in print HTML and strips DXF control-record injection", () => {
    const document = engineeringFixture("process");
    document.title = "<script>alert(1)</script>";
    const items = engineeringItems.map((i) => ({
      ...i,
      name: "<img src=x onerror=alert(1)>\n0\nENDSEC",
    }));
    const drawing = buildEngineeringDrawing(document, items),
      html = drawingPrintHtml(drawing),
      dxf = engineeringDxf(drawing);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=");
    expect(html).toContain("&lt;script&gt;");
    expect(dxf).toContain("onerror=alert(1)> 0 ENDSEC");
  });
  it("paginates full engineering records and annotates cross-sheet topology without dropping edges", () => {
    const document = engineeringFixture("electrical");
    const items = Array.from({ length: 13 }, (_, i) => ({
      ...engineeringItems[0],
      ref: `asset:${i + 1}`,
      identifier: `EQ-${i + 1}`,
    }));
    document.connections = items.slice(1).map((item, i) => ({
      ...document.connections[0],
      id: `wire-${i}`,
      from: items[i].ref,
      to: item.ref,
      designation: `W-${i}`,
      specification: "Long supplied specification ".repeat(8),
    }));
    const drawing = buildEngineeringDrawing(document, items),
      html = drawingPrintHtml(drawing);
    expect(
      drawing.sheets.filter((s) => s.title.includes("topology")),
    ).toHaveLength(5);
    expect(
      drawing.sheets.filter((s) => s.title.includes("interconnection")),
    ).toHaveLength(3);
    expect(html).toContain("C006 / page 3");
    for (const c of document.connections) expect(html).toContain(c.designation);
    expect(drawing.document.connections).toHaveLength(12);
  });
  it("accepts explicit compact quantities and rejects bare numbers or incidental unit letters", () => {
    for (const [field, valid, invalid] of [
      [
        "voltage",
        ["24V", "400VAC", "0.4kV", "24 V DC", "0-10 V"],
        ["24", "unknown", "AC"],
      ],
      [
        "designPressure",
        ["10bar", "10 bar(g)", "1 MPa", "0-10 kPa"],
        ["10", "pressure"],
      ],
      [
        "designTemperature",
        ["80°C", "-20 to 80 C", "293 K"],
        ["not numeric", "unknown", "80"],
      ],
    ] as const) {
      const document = engineeringFixture(
        field === "voltage" ? "electrical" : "process",
      );
      for (const value of valid) {
        document.connections[0].engineering = {
          ...document.connections[0].engineering,
          [field]: value,
        };
        expect(
          drawingIssues(document, engineeringItems).filter(
            (i) => i.field === field,
          ),
          value,
        ).toEqual([]);
      }
      for (const value of invalid) {
        document.connections[0].engineering = {
          ...document.connections[0].engineering,
          [field]: value,
        };
        expect(
          drawingIssues(document, engineeringItems).some(
            (i) => i.field === field && i.severity === "error",
          ),
          value,
        ).toBe(true);
      }
    }
  });
  it("bounds dense overview pages and keeps maximum labels legible with complete schedules", () => {
    const { document, items } = engineeringComplexFixture("electrical");
    const drawing = buildEngineeringDrawing(document, items);
    const overview = drawing.sheets.filter((s) => s.title.includes("topology"));
    const labels = overview.flatMap((s) =>
      s.primitives.filter((p) => p.type === "text").map((p) => p.value),
    );
    for (let i = 0; i < document.connections.length; i++) {
      expect(
        labels.some((v) => v.startsWith(`C${String(i + 1).padStart(3, "0")}`)),
      ).toBe(true);
    }
    const overviewRefs = (sheet: (typeof overview)[number]) =>
      new Set(
        sheet.primitives
          .filter((p) => p.type === "insert")
          .map((p) => p.attributes.REF),
      );
    for (const [index, c] of document.connections.entries()) {
      const key = `C${String(index + 1).padStart(3, "0")}`;
      const occurrences = overview.flatMap((sheet) =>
        sheet.primitives.flatMap((p) =>
          p.type === "text" &&
          (p.value === key || p.value.startsWith(`${key} / page `))
            ? [{ sheet, value: p.value }]
            : [],
        ),
      );
      expect([1, 2]).toContain(occurrences.length);
      for (const occurrence of occurrences) {
        const source = overviewRefs(occurrence.sheet);
        const targetPage = /\/ page (\d+)$/.exec(occurrence.value);
        if (!targetPage) {
          expect(occurrences).toHaveLength(1);
          expect(source.has(c.from) && source.has(c.to)).toBe(true);
          continue;
        }
        expect(occurrences).toHaveLength(2);
        const destination = drawing.sheets[Number(targetPage[1]) - 1];
        const sourcePage = drawing.sheets.indexOf(occurrence.sheet) + 1;
        expect(
          destination.primitives.some(
            (p) =>
              p.type === "text" && p.value === `${key} / page ${sourcePage}`,
          ),
        ).toBe(true);
        const opposite = source.has(c.from) ? c.to : c.from;
        expect(source.has(c.from) !== source.has(c.to)).toBe(true);
        expect(overviewRefs(destination).has(opposite)).toBe(true);
      }
    }
    for (const sheet of overview) {
      const refs = sheet.primitives.filter(
        (p) => p.type === "text" && /^C\d{3}(?: |$)/.test(p.value),
      );
      expect(refs.length).toBeLessThanOrEqual(4);
    }
    const schedule = drawing.sheets
      .filter((s) => s.title.includes("chedule"))
      .flatMap((s) =>
        s.primitives.filter((p) => p.type === "text").map((p) => p.value),
      )
      .join("\n");
    for (const c of document.connections) {
      expect(schedule.split(`Connection ID: ${c.id}`).length - 1).toBe(1);
    }
    for (const value of [
      document.drawing!.project,
      document.drawing!.preparedBy,
      document.connections[0].designation,
      document.connections[0].fromTerminal,
    ])
      expect(schedule.replace(/\s/g, "")).toContain(value.replace(/\s/g, ""));
    for (const sheet of drawing.sheets) {
      const labels = sheet.primitives
        .filter((p) => p.type === "text")
        .map((p) => p.value);
      expect(
        labels.some((v) => v.startsWith("Drawing:") && v.includes(" | Rev:")),
      ).toBe(true);
      expect(
        labels.some(
          (v) => v.startsWith("Prepared:") && v.includes(" | Checked:"),
        ),
      ).toBe(true);
      expect(labels).toContain("SCHEMATIC - NTS");
    }
    for (const sheet of drawing.sheets)
      for (const p of sheet.primitives)
        if (p.type === "text") {
          expect(p.height).toBeGreaterThanOrEqual(2.5);
          expect(drawingTextScale(p)).toBe(1);
          expect(p.value.length * p.height).toBeLessThanOrEqual(p.width);
        }
  });
});
