#!/usr/bin/env python3
"""Instrument an ephemeral checkout's unchanged Viewer/dark navigation test.

This diagnostic adds timing wrappers only. It does not alter selectors, assertions,
fixture setup, retries, or the existing 60-second Playwright test timeout.
"""
import hashlib
from pathlib import Path
import sys

EXPECTED = "aae4f4220e2932416a0087b7b95c130fd29f241e31759c6d0d98cbf2c76d83ae"
if len(sys.argv) != 2:
    raise SystemExit("usage: sidebar-ab-instrument.py CHECKOUT")
checkout = Path(sys.argv[1]).resolve()
test_file = checkout / "e2e/navigation.spec.ts"
original = test_file.read_bytes()
if hashlib.sha256(original).hexdigest() != EXPECTED:
    raise SystemExit("The navigation test differs from the reviewed baseline; refusing instrumentation")
source = original.decode("utf-8")
old_import = 'import { mkdirSync } from "node:fs";'
new_import = 'import { mkdirSync, appendFileSync } from "node:fs";'
if source.count(old_import) != 1:
    raise SystemExit("Expected exactly one fs import")
source = source.replace(old_import, new_import, 1)
marker = 'type Persona = { role: string; demo: boolean };'
helper = '''// Diagnostic-only wrappers in an ephemeral checkout. Output contains only
// fixed action categories, relative durations, and success/error categories.
const sidebarDiagnosticStart = performance.now();
async function sidebarDiagnostic(
  action: string,
  operation: () => Promise<unknown>,
) {
  const file = process.env.SIDEBAR_DIAGNOSTIC_FILE;
  if (!file) throw new Error("Diagnostic output path is missing");
  const start = performance.now();
  const record = (state: string) => appendFileSync(file, JSON.stringify({
    action, state, atMs: Math.round(performance.now() - sidebarDiagnosticStart),
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
if source.count(marker) != 1:
    raise SystemExit("Expected exactly one persona declaration")
source = source.replace(marker, helper + marker, 1)
replacements = [
    ("await login(page, persona);", 'await sidebarDiagnostic("login", () => login(page, persona));', 1),
    ("await setTheme(page, theme);", 'await sidebarDiagnostic("theme", () => setTheme(page, theme));', 1),
    ("await checkLayout(nav, false, infrastructure);", 'await sidebarDiagnostic("desktop_layout", () => checkLayout(nav, false, infrastructure));', 3),
    ("await checkLayout(nav, true, infrastructure);", 'await sidebarDiagnostic("collapsed_layout", () => checkLayout(nav, true, infrastructure));', 1),
    ("await checkLayout(drawer, false, infrastructure);", 'await sidebarDiagnostic("drawer_layout", () => checkLayout(drawer, false, infrastructure));', 1),
    ("await link.click();", 'await sidebarDiagnostic("route_click", () => link.click());', 1),
    ("await page.setViewportSize({ width, height: 844 });", 'await sidebarDiagnostic("mobile_resize", () => page.setViewportSize({ width, height: 844 }));', 1),
    ("await trigger.click();", 'await sidebarDiagnostic("drawer_toggle", () => trigger.click());', 2),
    ('await page.keyboard.press("Escape");', 'await sidebarDiagnostic("drawer_escape", () => page.keyboard.press("Escape"));', 1),
]
for old, new, expected in replacements:
    count = source.count(old)
    if count != expected:
        raise SystemExit(f"Unexpected occurrence count {count} for diagnostic marker; expected {expected}")
    source = source.replace(old, new)
test_file.write_text(source, encoding="utf-8")
