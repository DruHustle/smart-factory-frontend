/** Render exported vector sheets with the same browser print pipeline as the UI. */
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
const directory = resolve(
  process.argv[2] || "test-results/engineering-fixtures",
);
const browser = await chromium.launch();
const result = [];
try {
  for (const mode of ["process", "electrical"]) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
    });
    await page.goto(pathToFileURL(resolve(directory, `${mode}.html`)).href);
    await page.evaluate(() => document.fonts.ready);
    const expected = JSON.parse(
      await readFile(resolve(directory, `${mode}.json`), "utf8"),
    );
    const sheets = page.locator("[data-sheet]");
    if ((await sheets.count()) !== expected.sheets.length)
      throw Error("Sheet count differs");
    await page.pdf({
      path: resolve(directory, `${mode}.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    result.push({ mode, sheets: expected.sheets.length, pdf: true });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  resolve(directory, "pdf-render-results.json"),
  JSON.stringify(result, null, 2),
);
console.log(result);
