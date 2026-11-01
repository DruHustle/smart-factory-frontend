import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildEngineeringDrawing,
  drawingPrintHtml,
} from "../../client/src/components/workspace/engineering-drawing";
import { engineeringDxf } from "../../client/src/components/workspace/engineering-dxf";
import { engineeringItems, engineeringFixture } from "./fixtures";
const directory = resolve(
  process.argv[2] || "test-results/engineering-fixtures",
);
await mkdir(directory, { recursive: true });
for (const mode of ["process", "electrical"] as const) {
  const document = engineeringFixture(mode),
    drawing = buildEngineeringDrawing(document, engineeringItems);
  await writeFile(resolve(directory, `${mode}.dxf`), engineeringDxf(drawing));
  await writeFile(
    resolve(directory, `${mode}.html`),
    drawingPrintHtml(drawing),
  );
  await writeFile(
    resolve(directory, `${mode}.json`),
    JSON.stringify(
      {
        document,
        items: engineeringItems,
        sheets: drawing.sheets.map((s) => s.id),
        issues: drawing.issues,
      },
      null,
      2,
    ),
  );
  console.log(
    mode,
    drawing.sheets.length,
    "sheets",
    drawing.issues.length,
    "issues",
  );
}
