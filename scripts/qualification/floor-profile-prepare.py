#!/usr/bin/env python3
"""Instrument only a fingerprint-verified disposable 0ffb7ce checkout."""
import hashlib
from pathlib import Path
import subprocess
import sys

EXPECTED_REVISION = "0ffb7ce8ecfc0c17ac4070442f9ca489a3abaac5"
EXPECTED = {
    "client/src/components/workspace/FactoryFloorScene.tsx": "735ff3b1002d3eadde23e28626b725cf03f4f0dee3e433bd1dc294eebc3cd2ed",
    "client/src/components/workspace/factory-scene-preparation.ts": "9819da0e549b6f23316f7226d35e96d36b9bd8d20edd70af679228fab69c7b65",
    "e2e/overview.spec.ts": "0a38dba48893b8a83a1f45a548bea806a6b933d9d75fe59fea81ec016e97092c",
}
if len(sys.argv) != 3:
    raise SystemExit("usage: floor-profile-prepare.py CHECKOUT PROFILE_BROWSER_TS")
root = Path(sys.argv[1]).resolve()
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != EXPECTED_REVISION:
    raise SystemExit("Unexpected diagnostic source revision")
for name, digest in EXPECTED.items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
        raise SystemExit("Diagnostic source fingerprint mismatch")


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit("Diagnostic instrumentation marker mismatch")
    return text.replace(old, new, 1)


scene_path = root / "client/src/components/workspace/FactoryFloorScene.tsx"
s = scene_path.read_text()
s = replace_once(s, 'import { useEffect, useLayoutEffect, useRef, useState } from "react";',
                 'import { useEffect, useLayoutEffect, useRef, useState } from "react";\nimport { profileRecord } from "./factory-profile-diagnostic";')
s = replace_once(s, '        : false;\n      renderer.setPixelRatio(',
                 '        : false;\n      console.info("SF_PROFILE_RENDERER " + (debug ? (software ? "software" : "other") : "unknown"));\n      renderer.setPixelRatio(')
s = replace_once(s, '    const pending = floorReferenceBytes(slug)\n      .then((bytes) => new GLTFLoader().parseAsync(bytes, ""))',
'''    const downloadStarted = performance.now();
    const pending = floorReferenceBytes(slug)
      .finally(() => profileRecord("delivery", downloadStarted))
      .then((bytes) => {
        const parseStarted = performance.now();
        return new GLTFLoader().parseAsync(bytes, "")
          .finally(() => profileRecord("parse", parseStarted));
      })''')
s = replace_once(s, '      updateConnections = (updateShadow = true) => {\n        if (updateShadow)',
                 '      updateConnections = (updateShadow = true) => {\n        const profileStarted = performance.now();\n        try {\n        if (updateShadow)')
s = replace_once(s, '        if (updateShadow) renderer.shadowMap.needsUpdate = true;\n        dirty = true;\n      };\n      updateConnections();',
                 '        if (updateShadow) renderer.shadowMap.needsUpdate = true;\n        dirty = true;\n        } finally { profileRecord("routes", profileStarted); }\n      };\n      updateConnections();')
s = replace_once(s, '          renderer.render(scene, exploringRef.current ? exploreCamera : camera);',
'''          const profileStarted = performance.now();
          const shadowPending = renderer.shadowMap.needsUpdate;
          try { renderer.render(scene, exploringRef.current ? exploreCamera : camera); }
          finally { profileRecord(shadowPending ? "render_shadow" : "render", profileStarted); }''')
scene_path.write_text(s)

prep_path = root / "client/src/components/workspace/factory-scene-preparation.ts"
s = prep_path.read_text()
s = replace_once(s, 'import * as THREE from "three";', 'import * as THREE from "three";\nimport { profileRecord } from "./factory-profile-diagnostic";')
s = replace_once(s, '    const task = this.tail.then(async () => {\n      await this.presentationTurn();',
                 '    const queuedAt = performance.now();\n    const task = this.tail.then(async () => {\n      profileRecord("queue_wait", queuedAt);\n      let turnStarted = performance.now();\n      await this.presentationTurn();\n      profileRecord("presentation_wait", turnStarted);')
s = replace_once(s, '      const prepared = build();',
                 '      const buildStarted = performance.now();\n      let prepared: PreparedObject;\n      try { prepared = build(); } finally { profileRecord("build", buildStarted); }')
s = replace_once(s, '''        await this.renderer.compileAsync(
          prepared.object,
          this.camera,
          this.scene,
        );''', '''        const compileStarted = performance.now();
        try {
          await this.renderer.compileAsync(
            prepared.object,
            this.camera,
            this.scene,
          );
        } finally { profileRecord("compile", compileStarted); }''')
s = replace_once(s, '        await this.presentationTurn();\n        if (this.stopped) return false;',
                 '        turnStarted = performance.now();\n        await this.presentationTurn();\n        profileRecord("presentation_wait", turnStarted);\n        if (this.stopped) return false;')
s = replace_once(s, '      prepared.activate();\n      // Allow input',
                 '      const activateStarted = performance.now();\n      try { prepared.activate(); } finally { profileRecord("activation", activateStarted); }\n      // Allow input')
s = replace_once(s, '      await this.presentationTurn();\n      return !this.stopped;',
                 '      turnStarted = performance.now();\n      await this.presentationTurn();\n      profileRecord("presentation_wait", turnStarted);\n      return !this.stopped;')
prep_path.write_text(s)
(root / "client/src/components/workspace/factory-profile-diagnostic.ts").write_bytes(Path(sys.argv[2]).read_bytes())

spec_path = root / "e2e/overview.spec.ts"
s = spec_path.read_text()
s = replace_once(s, 'import { mkdirSync, writeFileSync } from "node:fs";', 'import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";')
s = replace_once(s, 'const directory =\n', '''function profileEvent(value: unknown) {
  const output = process.env.FLOOR_PROFILE_EVENTS;
  if (!output) throw Error("Profile output unavailable");
  appendFileSync(output, JSON.stringify(value) + "\\n", { mode: 0o600 });
}
const directory =
''')
s = replace_once(s, '''        const errors: string[] = [],
          commands: string[] = [];''', '''        const profileStart = performance.now();
        const mark = (stage: string) => profileEvent({ type: "journey", width, theme, stage, atMs: Math.round(performance.now() - profileStart) });
        page.on("console", (message) => {
          const text = message.text();
          if (text.startsWith("SF_PROFILE_RENDERER ")) {
            profileEvent({ type: "renderer", width, theme, backend: text.slice(20) });
            return;
          }
          if (!text.startsWith("SF_PROFILE_BATCH ")) return;
          try { profileEvent({ type: "metrics", width, theme, atMs: Math.round(performance.now() - profileStart), entries: JSON.parse(text.slice(17)) }); } catch { /* Ignore malformed diagnostic messages. */ }
        });
        mark("start");
        const errors: string[] = [],
          commands: string[] = [];''')
s = replace_once(s, '          await expect\n            .poll(\n              async () => {\n                const text = await floor.getByRole("status").textContent();',
                 '          mark("readiness_start");\n          await expect\n            .poll(\n              async () => {\n                const text = await floor.getByRole("status").textContent();')
s = replace_once(s, '            .toBe(expectedDetailedModels);', '            .toBe(expectedDetailedModels);\n          mark("readiness_ok");')
s = replace_once(s, '          await floor\n            .getByRole("button", {\n              name: "Explore factory at eye level",',
                 '          mark("explore_start");\n          await floor\n            .getByRole("button", {\n              name: "Explore factory at eye level",')
s = replace_once(s, '          await expect(canvas).toHaveAttribute("data-view-mode", "explore");', '          await expect(canvas).toHaveAttribute("data-view-mode", "explore");\n          mark("explore_ok");')
s = replace_once(s, '          await floor.screenshot({\n            path: `${directory}/factory-explore-${theme}-${width}.png`,\n            animations: "disabled",\n          });',
                 '          mark("explore_screenshot_start");\n          await floor.screenshot({\n            path: `${directory}/factory-explore-${theme}-${width}.png`,\n            animations: "disabled",\n          });\n          mark("explore_screenshot_ok");')
s = replace_once(s, '          await floor\n            .getByRole("button", { name: "Turn right", exact: true })',
                 '          mark("turn_start");\n          await floor\n            .getByRole("button", { name: "Turn right", exact: true })')
s = replace_once(s, '            .not.toBe(JSON.stringify(exploreView));', '            .not.toBe(JSON.stringify(exploreView));\n          mark("turn_ok");')
s = replace_once(s, '          await capture(page, `factory-floor-${theme}-${width}`, {', '          mark("floor_capture_start");\n          await capture(page, `factory-floor-${theme}-${width}`, {')
s = replace_once(s, '            source: s.anchor,\n          });', '            source: s.anchor,\n          });\n          mark("floor_capture_ok");')
s = replace_once(s, '          await list\n            .getByRole("button", { name: item.name, exact: true })', '          mark("select_start");\n          await list\n            .getByRole("button", { name: item.name, exact: true })')
s = replace_once(s, '          const returnContext = new URL(page.url()).hash.slice(1);', '          mark("select_ok");\n          const returnContext = new URL(page.url()).hash.slice(1);')
s = replace_once(s, '          await page.goto("/#" + returnContext);', '          mark("return_start");\n          await page.goto("/#" + returnContext);')
s = replace_once(s, '          await capture(page, `factory-plan-${theme}-${width}`, {', '          mark("plan_capture_start");\n          await capture(page, `factory-plan-${theme}-${width}`, {')
s = replace_once(s, '            selected: item.ref,\n          });', '            selected: item.ref,\n          });\n          mark("plan_capture_ok");')
s = replace_once(s, '''        } finally {
          await context.close();
          if (video)''', '''        } finally {
          mark("teardown_start");
          await context.close();
          mark("context_closed");
          if (video)''')
s = replace_once(s, '''              `${directory}/factory-overview-${theme}-${width}.webm`,
            );
        }''', '''              `${directory}/factory-overview-${theme}-${width}.webm`,
            );
          mark("teardown_ok");
        }''')
spec_path.write_text(s)
