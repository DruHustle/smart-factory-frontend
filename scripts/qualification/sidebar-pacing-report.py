#!/usr/bin/env python3
"""Emit only allowlisted categories and numeric results from private CI data."""
import json
from pathlib import Path
import re
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: sidebar-pacing-report.py STATUS_TSV PRIVATE_DIR SUMMARY_JSON")
status_path, private, output = map(Path, sys.argv[1:])
allowed_actions = {"login", "theme", "desktop_layout", "collapsed_layout", "drawer_layout", "route_click", "mobile_resize", "drawer_toggle", "drawer_escape"}
allowed_states = {"start", "ok", "error"}
allowed_results = {"passed", "failed", "timedOut", "interrupted", "skipped"}

def number(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 3600000

def suites(root, parents=()):
    for suite in root:
        ancestors = parents + (suite.get("title", ""),)
        for spec in suite.get("specs", []):
            yield ancestors, spec
        yield from suites(suite.get("suites", []), ancestors)

def results_for(case, kind):
    report = private / f"{case}-report.json"
    if not report.is_file():
        return []
    try:
        source = json.loads(report.read_text())
    except (OSError, ValueError):
        return []
    found = []
    for ancestors, spec in suites(source.get("suites", [])):
        name = spec.get("title", "")
        if kind == "nav":
            expected = "shared demo Viewer: aligned desktop, collapsed and mobile navigation (dark)"
            if name != expected:
                continue
            width = None
        else:
            group = next((re.fullmatch(r"Overview graphics whole factory (390|1440)px light", x) for x in ancestors if re.fullmatch(r"Overview graphics whole factory (390|1440)px light", x)), None)
            if not group or name != "renders all floor items and native references with summary graphs and item drill-down":
                continue
            width = int(group.group(1))
        for test in spec.get("tests", []):
            results = test.get("results", [])
            if len(results) != 1:
                continue
            result = results[0]
            state, duration = result.get("status"), result.get("duration")
            if state not in allowed_results or not number(duration):
                continue
            test_timeout = test.get("timeout") if number(test.get("timeout")) else None
            found.append({"width": width, "status": state, "durationMs": duration,
                          "timeoutMs": test_timeout,
                          "within60s": state == "passed" and test_timeout == 60000 and duration <= 60000,
                          "retry": result.get("retry") if number(result.get("retry")) else None})
    return found

def events_for(case, kind):
    path = private / f"{case}-events.jsonl"
    if not path.is_file():
        return []
    events = []
    for line in path.read_text().splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        state, action, elapsed = event.get("state"), event.get("action"), event.get("elapsedMs")
        if state not in allowed_states or not number(elapsed):
            continue
        if kind == "nav" and action in allowed_actions and number(event.get("atMs")):
            events.append({"action": action, "state": state, "atMs": event["atMs"], "elapsedMs": elapsed})
        if kind == "floor" and action == "model_readiness" and event.get("width") in (390, 1440):
            events.append({"action": action, "width": event["width"], "state": state, "elapsedMs": elapsed})
    return events

rows = status_path.read_text().splitlines()[1:]
samples = []
for row in rows:
    case, kind, variant, code, cleanup = row.split("\t")
    if (not re.fullmatch(r"(?:nav|floor)-(?:control|paced)-[12]", case)
            or kind not in {"nav", "floor"} or variant not in {"control", "paced"}
            or not case.startswith(f"{kind}-{variant}-")):
        raise SystemExit("Invalid diagnostic sample category")
    tests = results_for(case, kind)
    events = events_for(case, kind)
    sample = {"case": case, "kind": kind, "variant": variant, "exitCode": int(code),
              "cleanupFailed": bool(int(cleanup)), "tests": tests, "events": events}
    expected_widths = [None] if kind == "nav" else [390, 1440]
    sample["originalChecksPassed"] = (sorted((x["width"] for x in tests), key=lambda x: x or 0) == expected_widths
        and all(x["within60s"] and x["retry"] == 0 for x in tests))
    if kind == "floor":
        terminal = [e for e in events if e["state"] in {"ok", "error"}]
        sample["modelReadinessWithin30s"] = (sorted(e["width"] for e in terminal) == [390, 1440]
            and all(e["state"] == "ok" and e["elapsedMs"] <= 30000 for e in terminal))
    else:
        sample["timingEventsPresent"] = bool(events)
    samples.append(sample)
summary = {"kind": "diagnostic-only", "control": "unmodified-e79-runtime",
           "variant": "ephemeral-e79-with-trailing-presentation-turn",
           "sameHostedRunner": True, "order": "ABBA per suite", "testTimeoutMs": 60000,
           "modelReadinessTimeoutMs": 30000, "retries": 0, "samples": samples}
output.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
expected_cases = {f"{kind}-{variant}-{n}" for kind in ("nav", "floor")
                  for variant in ("control", "paced") for n in (1, 2)}
if len(samples) != 8 or {s["case"] for s in samples} != expected_cases or any(s["exitCode"] or s["cleanupFailed"] or not s["originalChecksPassed"]
        or (s["kind"] == "floor" and not s["modelReadinessWithin30s"])
        or (s["kind"] == "nav" and not s["timingEventsPresent"]) for s in samples):
    raise SystemExit(1)
