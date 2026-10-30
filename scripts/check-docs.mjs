import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [root, path.join(root, '../smart-factory-backend'), path.join(root, '../smart-factory-edge')];
const files = [];
for (const repository of roots) {
  try {
    await stat(repository);
  } catch {
    if (process.env.REQUIRE_COMPANION_REPOS === '1') throw new Error(`Required documentation repository is missing: ${repository}`);
    console.warn(`Skipping unavailable companion documentation repository: ${repository}`);
    continue;
  }
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repository, encoding: 'utf8' }).split('\n');
  for (const name of new Set(paths.filter(name => name.endsWith('.md')))) {
    const filename = path.join(repository, name);
    try { files.push({ filename, content: await readFile(filename, 'utf8') }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
const failures = [];
let links = 0;
const diagrams = [];
for (const { filename, content } of files) {
  for (const match of content.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)) diagrams.push({ filename, source: match[1] });
  const prose = content.replace(/```[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/\[[^\]\n]*\]\(([^\n)]+)\)/g)) {
    const url = match[1].trim().replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']$/, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')) continue;
    links++;
    const target = path.resolve(path.dirname(filename), decodeURIComponent(url.split('#')[0]));
    try { await stat(target); } catch { failures.push(`${path.relative(root, filename)}: missing link ${url}`); }
  }
}
const expectedPdfs = ['api-flows.pdf', 'architecture.pdf', 'database-schema.pdf', 'fx-tsn.pdf'];
const hash = content => createHash('sha256').update(content).digest('hex');
try {
  const manifest = JSON.parse(await readFile(path.join(root, 'docs/pdf-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.generator !== 'scripts/render-pdfs.mjs') {
    failures.push('docs/pdf-manifest.json: unsupported schema or generator');
  }
  const actualNames = Object.keys(manifest.documents ?? {}).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedPdfs)) {
    failures.push(`docs/pdf-manifest.json: expected ${expectedPdfs.join(', ')}`);
  }
  const expectedDiagrams = ['architecture', 'fx-tsn'];
  if (JSON.stringify(Object.keys(manifest.diagrams ?? {}).sort()) !== JSON.stringify(expectedDiagrams)) {
    failures.push('docs/pdf-manifest.json: expected architecture and fx-tsn diagram exports');
  }
  for (const name of expectedDiagrams) {
    const entry = manifest.diagrams?.[name];
    if (!entry || entry.source !== `${name}.md`) {
      failures.push(`docs/diagrams/${name}: missing canonical source`);
      continue;
    }
    if (entry.sourceSha256 !== hash(await readFile(path.join(root, 'docs', entry.source)))) {
      failures.push(`docs/diagrams/${name}: stale; regenerate with pnpm docs:pdf`);
    }
    for (const format of ['svg', 'png']) {
      const filename = `diagrams/${name}.${format}`;
      if (entry[format] !== filename) {
        failures.push(`docs/diagrams/${name}: invalid ${format} path`);
        continue;
      }
      const content = await readFile(path.join(root, 'docs', filename));
      if (entry[`${format}Sha256`] !== hash(content)) failures.push(`docs/${filename}: differs from manifest`);
      if (format === 'svg' && !content.toString().includes('<svg')) failures.push(`docs/${filename}: invalid SVG`);
      if (format === 'png' && !content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) failures.push(`docs/${filename}: invalid PNG`);
    }
  }
  for (const pdfName of expectedPdfs) {
    const entry = manifest.documents?.[pdfName];
    const sourceName = pdfName.replace(/\.pdf$/, '.md');
    if (!entry || entry.source !== sourceName) {
      failures.push(`docs/pdf-manifest.json: invalid source for ${pdfName}`);
      continue;
    }
    const sourceContent = await readFile(path.join(root, 'docs', sourceName));
    const pdfContent = await readFile(path.join(root, 'docs', pdfName));
    if (!pdfContent.subarray(0, 5).equals(Buffer.from('%PDF-'))) failures.push(`docs/${pdfName}: invalid PDF signature`);
    if (entry.sourceSha256 !== hash(sourceContent)) failures.push(`docs/${pdfName}: stale; regenerate with pnpm docs:pdf`);
    if (entry.pdfSha256 !== hash(pdfContent)) failures.push(`docs/${pdfName}: differs from docs/pdf-manifest.json`);
  }
} catch (error) {
  failures.push(`PDF manifest validation failed: ${error.message}`);
}
const store = path.join(root, 'node_modules/.pnpm');
const mermaid = (await readdir(store)).find(name => name.startsWith('mermaid@'));
if (!mermaid) throw new Error('Mermaid bundle unavailable');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: path.join(store, mermaid, 'node_modules/mermaid/dist/mermaid.min.js') });
  await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' }));
  for (let index = 0; index < diagrams.length; index++) {
    const diagram = diagrams[index];
    try {
      await page.evaluate(async ({ source, index }) => {
        const result = await window.mermaid.render(`reviewDiagram${index}`, source);
        if (!result.svg.includes('<svg')) throw new Error('Diagram rendered no SVG');
        document.body.innerHTML = '';
      }, { source: diagram.source, index });
    } catch (error) { failures.push(`${path.relative(root, diagram.filename)} diagram ${index + 1}: ${error.message}`); }
  }
} finally { await browser.close(); }
console.log(`Reviewed ${files.length} Markdown files, ${links} local file links, ${diagrams.length} Mermaid diagrams.`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
