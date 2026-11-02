import {
  DxfWriter,
  Units,
  point3d,
  type EntitiesManager,
} from "@tarikjabiri/dxf";
import {
  drawingLayers,
  drawingTextScale,
  type DrawingPrimitive,
  type EngineeringDrawing,
} from "./engineering-drawing";

const value = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ");

/** Editable model-space A3 sheets, mm. No raster images, XREFs or live data. */
export function engineeringDxf(drawing: EngineeringDrawing): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable("$MEASUREMENT", { 70: 1 });
  dxf.setVariable("$LWDISPLAY", { 290: 1 });
  dxf.setVariable("$INSBASE", { 10: 0, 20: 0, 30: 0 });
  dxf.setVariable("$EXTMIN", { 10: 0, 20: 0, 30: 0 });
  dxf.setVariable("$EXTMAX", {
    10: drawing.sheets.length * 450,
    20: 297,
    30: 0,
  });
  for (const [name, style] of Object.entries(drawingLayers)) {
    const pattern = style.dash ? `SF_${name}` : "CONTINUOUS";
    if (style.dash)
      dxf.addLType(
        pattern,
        name,
        style.dash.map((length, i) => (i % 2 ? -length : length)),
      );
    dxf.addLayer(`SF_${name}`, 7, pattern);
  }
  const emit = (
    target: EntitiesManager,
    p: DrawingPrimitive,
    ox: number,
    oy: number,
  ) => {
    const point = (x: number, y: number) => point3d(ox + x, oy - y);
    const options = { layerName: `SF_${p.layer}` };
    if (p.type === "line")
      target.addLWPolyline(
        p.points.map(([x, y]) => ({ point: { x: ox + x, y: oy - y } })),
        options,
      );
    else if (p.type === "circle")
      target.addCircle(point(...p.at), p.radius, options);
    else if (p.type === "text")
      target.addText(point(...p.at), p.height, value(p.value), {
        ...options,
        relativeXScaleFactor: drawingTextScale(p),
      });
    else {
      const insert = target.addInsert(p.block, point(...p.at), options);
      // The writer emits a SEQEND for each addAttrib. A DXF INSERT requires one
      // contiguous attribute sequence, followed by exactly one SEQEND.
      let end: (typeof target.entities)[number] | undefined;
      for (const [name, content] of Object.entries(p.attributes)) {
        const attribute = target.addAttrib(
          point(...p.at),
          2.5,
          name,
          value(content),
          insert,
          { layerName: "SF_TAGS", visible: false },
        );
        attribute.ownerBlockRecord = insert.handle;
        end = target.entities.pop();
      }
      if (end) target.entities.push(end);
    }
  };
  for (const [name, primitives] of Object.entries(drawing.blocks)) {
    const block = dxf.addBlock(name);
    primitives.forEach((p) => emit(block, p, 0, 0));
    for (const name of ["TAG", "REF", "NAME", "TYPE"])
      block.addAttdef(point3d(), 2.5, name, "", {
        layerName: "SF_TAGS",
        visible: false,
      });
  }
  drawing.sheets.forEach((sheet, index) =>
    sheet.primitives.forEach((p) => emit(dxf.modelSpace, p, index * 450, 297)),
  );
  // Version2.9 fixes layer lineweight at0. Set the standard group370 value
  // to the declared plotting weight (hundredths of a millimetre).
  const lines = dxf.stringify().split(/\r?\n/);
  let kind = "",
    layer = "";
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    if (code === 0) {
      kind = lines[i + 1];
      layer = "";
    }
    if (kind === "LAYER" && code === 2)
      layer = lines[i + 1].replace(/^SF_/, "");
    if (kind === "LAYER" && code === 370 && drawingLayers[layer])
      lines[i + 1] = String(Math.round(drawingLayers[layer].weight * 100));
  }
  return lines.join("\n");
}
