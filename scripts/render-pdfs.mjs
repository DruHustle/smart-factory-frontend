import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentNames = ["architecture", "api-flows", "database-schema"];
const docsDirectory = path.join(repositoryRoot, "docs");
const pdfManifest = {
  schemaVersion: 1,
  generator: "scripts/render-pdfs.mjs",
  documents: {},
};

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

async function locateMermaidBundle() {
  const packageStore = path.join(repositoryRoot, "node_modules", ".pnpm");
  const entries = await readdir(packageStore);
  const mermaidPackage = entries.find((entry) => entry.startsWith("mermaid@"));
  if (!mermaidPackage) throw new Error("Mermaid is not installed in the pnpm package store");
  return path.join(packageStore, mermaidPackage, "node_modules", "mermaid", "dist", "mermaid.min.js");
}

const mermaidBundle = await locateMermaidBundle();
const browser = await chromium.launch({ headless: true });

try {
  for (const documentName of documentNames) {
    const source = path.join(docsDirectory, `${documentName}.md`);
    const output = path.join(docsDirectory, `${documentName}.pdf`);
    const html = execFileSync("pandoc", [source, "--from=gfm", "--to=html5", "--standalone", "--wrap=none"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    page.on("console", (message) => console.log(`[${documentName} browser] ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => console.error(`[${documentName} browser error] ${error.stack ?? error.message}`));
    await page.setContent(html, { waitUntil: "load" });
    await page.addStyleTag({ content: `
      @page { size: A4; }
      :root { color-scheme: light; }
      html { background: #fff; }
      body {
        color: #17232f; font: 10pt/1.52 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        max-width: 174mm; margin: 0 auto; padding: 0; background: #fff;
      }
      body > :last-child { margin-bottom: 0; }
      h1, h2, h3, h4 { color: #102b3f; line-height: 1.2; page-break-after: avoid; }
      h1 { font-size: 26pt; margin: 0 0 12pt; padding: 8pt 0 10pt; border-bottom: 3pt solid #df6b32; }
      h2 { font-size: 16pt; margin: 23pt 0 8pt; border-bottom: 1px solid #cad6df; padding-bottom: 4pt; }
      h3 { font-size: 12pt; margin: 16pt 0 6pt; }
      p, li { orphans: 3; widows: 3; }
      a { color: #096d79; text-decoration: none; }
      table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 10pt 0 14pt; break-inside: avoid; }
      th { color: #fff; background: #15364c; text-align: left; }
      th, td { padding: 6pt 7pt; border: 1px solid #cfdae1; vertical-align: top; }
      tr:nth-child(even) td { background: #f2f6f8; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f2f5f7; border-left: 3px solid #df6b32; padding: 9pt; font-size: 8pt; }
      code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.91em; }
      blockquote { border-left: 3px solid #52aeb5; padding-left: 10pt; color: #405360; margin-left: 0; }
      .mermaid { display: flex; justify-content: center; margin: 10pt auto 12pt; padding: 7pt 5pt; max-height: 225mm; overflow: hidden; background: #f7fafb; border: 1px solid #dce6eb; border-radius: 5px; break-inside: avoid; }
      .mermaid svg { max-width: 100% !important; max-height: 215mm !important; width: auto !important; height: auto !important; }
      .mermaid .label, .mermaid text { font-family: Arial, sans-serif !important; }
      hr { border: 0; border-top: 1px solid #d2dde4; margin: 16pt 0; }
      @media print { h2 { break-after: avoid; } img, svg { max-width: 100%; } }
    ` });
    await page.addScriptTag({ path: mermaidBundle });
    const diagramCount = await page.evaluate(async () => {
      const mermaidApi = (window).mermaid;
      if (!mermaidApi) throw new Error("Mermaid browser bundle did not expose its API");
      for (const source of document.querySelectorAll("pre.mermaid")) {
        const diagram = document.createElement("div");
        diagram.className = "mermaid";
        diagram.textContent = source.textContent ?? "";
        source.replaceWith(diagram);
      }
      mermaidApi.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: {
        primaryColor: "#eaf4f5", primaryTextColor: "#102b3f", primaryBorderColor: "#197b83",
        lineColor: "#426171", secondaryColor: "#fff4e8", tertiaryColor: "#f1f6f8",
        fontFamily: "Arial, sans-serif", fontSize: "14px",
      } });
      const diagrams = document.querySelectorAll(".mermaid");
      try {
        await mermaidApi.run({ querySelector: ".mermaid" });
      } catch (error) {
        return { count: diagrams.length, error: String(error), message: error?.message, stack: error?.stack };
      }
      return { count: diagrams.length };
    });
    if (diagramCount.error) throw new Error(`${documentName}: ${diagramCount.error} ${diagramCount.message ?? ""} ${diagramCount.stack ?? ""}`);
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: output,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      margin: { top: "21mm", right: "18mm", bottom: "21mm", left: "18mm" },
      headerTemplate: `<div style="width:100%;margin:0 18mm;color:#607784;font:8px Arial,sans-serif;border-bottom:1px solid #d6e0e5;padding-bottom:4px">SMART FACTORY&nbsp;&nbsp; / &nbsp;&nbsp;SYSTEMS ENGINEERING</div>`,
      footerTemplate: `<div style="width:100%;margin:0 18mm;color:#607784;font:8px Arial,sans-serif;border-top:1px solid #d6e0e5;padding-top:4px;display:flex;justify-content:space-between"><span>Engineering documentation • ${documentName}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    const sourceContent = await readFile(source);
    const pdfContent = await readFile(output);
    pdfManifest.documents[`${documentName}.pdf`] = {
      source: `${documentName}.md`,
      sourceSha256: sha256(sourceContent),
      pdfSha256: sha256(pdfContent),
    };
    console.log(`Rendered ${path.relative(repositoryRoot, output)} (${diagramCount.count} diagrams)`);
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(docsDirectory, "pdf-manifest.json"), `${JSON.stringify(pdfManifest, null, 2)}\n`);
console.log("Updated docs/pdf-manifest.json");
