import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildEngineeringDrawing,
  drawingPrintHtml,
} from "../../client/src/components/workspace/engineering-drawing";
import { engineeringDxf } from "../../client/src/components/workspace/engineering-dxf";
import { engineeringComplexFixture } from "./fixtures";
const root = resolve(process.argv[2] || "test-results/engineering-complex");
await mkdir(root, { recursive: true });
for (const mode of ["process", "electrical"] as const) {
  const { document, items } = engineeringComplexFixture(mode);
  const drawing = buildEngineeringDrawing(document, items);
  for (const [extension, content] of [
    ["dxf", engineeringDxf(drawing)],
    ["html", drawingPrintHtml(drawing)],
    [
      "json",
      JSON.stringify(
        {
          document,
          items,
          sheets: drawing.sheets.map((s) => s.id),
          issues: drawing.issues,
        },
        null,
        2,
      ),
    ],
  ])
    await writeFile(resolve(root, `${mode}.${extension}`), content);
  console.log(mode, drawing.sheets.length, "sheets");
}
