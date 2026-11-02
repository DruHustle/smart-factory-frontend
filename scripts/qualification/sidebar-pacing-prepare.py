#!/usr/bin/env python3
"""Prepare an ephemeral e79 checkout for a diagnostic pacing comparison.

Both checkouts receive identical numeric-only test timing and isolated Compose
namespace instrumentation. Only the ``paced`` checkout receives one additional
presentation turn after activation. No assertion, per-test limit, retry setting,
model readiness limit, or shader-cache behavior is changed.
"""
import hashlib
from pathlib import Path
import sys

EXPECTED = {
    "client/src/components/workspace/factory-scene-preparation.ts": "acd51317cc9dfaa4583813440603fdbf165a3ad01e75d06d204920ff25d1cd76",
    "e2e/overview.spec.ts": "0a38dba48893b8a83a1f45a548bea806a6b933d9d75fe59fea81ec016e97092c",
    "scripts/experience/e2e.sh": "df4e2580530b74be9e738ab2e3c2c2d769fb97c322fa89c999bbe6783f1639a6",
}
if len(sys.argv) != 3 or sys.argv[2] not in {"control", "paced"}:
    raise SystemExit("usage: sidebar-pacing-prepare.py CHECKOUT control|paced")
checkout = Path(sys.argv[1]).resolve()
mode = sys.argv[2]
for name, digest in EXPECTED.items():
    if hashlib.sha256((checkout / name).read_bytes()).hexdigest() != digest:
        raise SystemExit("Source fingerprint mismatch; refusing to prepare diagnostic checkout")

fixture = checkout / "scripts/experience/e2e.sh"
s = fixture.read_text()
old = 'compose=(docker compose --env-file /dev/null -p smart-factory-experience-e2e -f docker-compose.e2e.yml)'
new = 'compose=(docker compose --env-file /dev/null -p "${EXPERIENCE_DIAGNOSTIC_PROJECT:?}" -f docker-compose.e2e.yml)'
if s.count(old) != 1:
    raise SystemExit("Experience fixture namespace marker mismatch")
fixture.write_text(s.replace(old, new, 1))

spec = checkout / "e2e/overview.spec.ts"
s = spec.read_text()
old = 'import { mkdirSync, writeFileSync } from "node:fs";'
new = 'import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";'
if s.count(old) != 1:
    raise SystemExit("Overview test import marker mismatch")
s = s.replace(old, new, 1)
marker = 'const directory =\n'
helper = '''// Diagnostic-only timing in an ephemeral checkout. Fixed categories and
// numeric values are recorded; the existing readiness assertion is unchanged.
async function floorPacingDiagnostic(
  width: number,
  operation: () => Promise<unknown>,
) {
  const file = process.env.FLOOR_PACING_DIAGNOSTIC_FILE;
  if (!file) throw new Error("Diagnostic output path is missing");
  const start = performance.now();
  const record = (state: string) => appendFileSync(file, JSON.stringify({
    action: "model_readiness", width, state,
    elapsedMs: Math.round(performance.now() - start),
  }) + "\\n", { mode: 0o600 });
  record("start");
  try {
    const value = await operation();
    record("ok");
    return value;
  } catch (error) {
    record("error");
    throw error;
  }
}

'''
if s.count(marker) != 1:
    raise SystemExit("Overview test setup marker mismatch")
s = s.replace(marker, helper + marker, 1)
end_marker = '            .toBe(expectedDetailedModels);'
end = s.find(end_marker)
start = s.rfind('          await expect\n', 0, end)
if start < 0 or end < 0 or s.count(end_marker) != 1:
    raise SystemExit("Readiness assertion marker mismatch")
end += len(end_marker)
block = s[start:end]
if '{ timeout: 30000 }' not in block:
    raise SystemExit("Expected the unchanged 30-second readiness limit")
block = block.replace('await expect\n', 'await floorPacingDiagnostic(width, () => expect\n', 1)
block = block.replace('.toBe(expectedDetailedModels);', '.toBe(expectedDetailedModels));', 1)
s = s[:start] + block + s[end:]
spec.write_text(s)

if mode == "paced":
    source = checkout / "client/src/components/workspace/factory-scene-preparation.ts"
    s = source.read_text()
    old = '''      prepared.activate();
      // The next task begins with a presentation turn, allowing this object
      // to draw before more geometry is prepared without waiting twice.
      return !this.stopped;'''
    new = '''      prepared.activate();
      // Diagnostic variant: let one additional presentation turn complete.
      await this.presentationTurn();
      return !this.stopped;'''
    if s.count(old) != 1 or 'this.compiledReferences.has(referenceKey)' not in s:
        raise SystemExit("Expected keyed shader reuse and pacing marker")
    source.write_text(s.replace(old, new, 1))
