#!/usr/bin/env python3
"""Summarize allowlisted timing data without exporting private raw results."""
import json
from pathlib import Path
import re
import sys

if len(sys.argv) != 5:
    raise SystemExit("usage: floor-profile-report.py EVENTS REPORT STATUS OUTPUT")
events_path, report_path, status_path, output = map(Path, sys.argv[1:])
cases = [(390, "light"), (390, "dark"), (1440, "light"), (1440, "dark")]
categories = {"delivery", "parse", "queue_wait", "build", "compile", "activation", "presentation_wait", "routes", "render", "render_shadow"}
stages = {"start", "readiness_start", "readiness_ok", "explore_start", "explore_ok", "explore_screenshot_start", "explore_screenshot_ok", "turn_start", "turn_ok", "floor_capture_start", "floor_capture_ok", "select_start", "select_ok", "return_start", "plan_capture_start", "plan_capture_ok", "teardown_start", "context_closed", "teardown_ok"}
states = {"passed", "failed", "timedOut", "interrupted", "skipped"}


def num(value, limit=3600000000000):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= limit


def walk(suites, parents=()):
    for suite in suites:
        ancestry = parents + (suite.get("title", ""),)
        for spec in suite.get("specs", []):
            yield ancestry, spec
        yield from walk(suite.get("suites", []), ancestry)


results = {case: {"width": case[0], "theme": case[1], "tests": [], "renderer": [], "milestones": [], "metrics": {}, "metricWindows": []} for case in cases}
try:
    report = json.loads(report_path.read_text())
except (OSError, ValueError):
    report = {}
for ancestry, spec in walk(report.get("suites", [])):
    if spec.get("title") != "renders all floor items and native references with summary graphs and item drill-down":
        continue
    matches = [re.fullmatch(r"Overview graphics whole factory (390|1440)px (light|dark)", name) for name in ancestry]
    matches = [match for match in matches if match]
    if len(matches) != 1:
        continue
    case = (int(matches[0].group(1)), matches[0].group(2))
    for test in spec.get("tests", []):
        entries = test.get("results", [])
        if len(entries) != 1:
            continue
        entry = entries[0]
        state, duration, timeout, retry = entry.get("status"), entry.get("duration"), test.get("timeout"), entry.get("retry")
        if state in states and all(num(value, 3600000) for value in (duration, timeout, retry)):
            results[case]["tests"].append({"status": state, "durationMs": duration, "timeoutMs": timeout, "retry": retry})

try:
    lines = events_path.read_text().splitlines()
except OSError:
    lines = []
for line in lines:
    try:
        event = json.loads(line)
        case = (event.get("width"), event.get("theme"))
        if case not in results or isinstance(case[0], bool):
            continue
        if event.get("type") == "renderer" and event.get("backend") in {"software", "other", "unknown"}:
            if event["backend"] not in results[case]["renderer"]:
                results[case]["renderer"].append(event["backend"])
        elif event.get("type") == "journey" and event.get("stage") in stages and num(event.get("atMs"), 3600000):
            results[case]["milestones"].append({"stage": event["stage"], "atMs": event["atMs"]})
        elif event.get("type") == "metrics" and isinstance(event.get("entries"), list) and num(event.get("atMs"), 3600000):
            window = {"atMs": event["atMs"], "metrics": {}}
            for entry in event["entries"]:
                if not isinstance(entry, dict) or entry.get("category") not in categories:
                    continue
                count, total, maximum = entry.get("count"), entry.get("sumUs"), entry.get("maxUs")
                if not all(num(value) for value in (count, total, maximum)) or count == 0 or maximum > total:
                    continue
                metric = results[case]["metrics"].setdefault(entry["category"], {"count": 0, "sumUs": 0, "maxUs": 0})
                metric["count"] += count
                metric["sumUs"] += total
                metric["maxUs"] = max(metric["maxUs"], maximum)
                window["metrics"][entry["category"]] = {"count": count, "sumUs": total, "maxUs": maximum}
            if window["metrics"] and len(results[case]["metricWindows"]) < 200:
                results[case]["metricWindows"].append(window)
    except (AttributeError, TypeError, ValueError):
        continue

try:
    status = status_path.read_text().strip().split("\t")
    if len(status) != 2 or not re.fullmatch(r"[0-9]{1,3}", status[0]) or status[1] not in {"0", "1"}:
        raise ValueError
    exit_code, cleanup_failed = int(status[0]), status[1] == "1"
except (OSError, ValueError):
    exit_code, cleanup_failed = 125, True
samples = list(results.values())
for sample in samples:
    tests = sample["tests"]
    sample["originalChecksPassed"] = (len(tests) == 1 and tests[0]["status"] == "passed"
        and tests[0]["timeoutMs"] == 60000 and tests[0]["durationMs"] <= 60000 and tests[0]["retry"] == 0)
    sample["instrumentationPresent"] = bool(sample["metrics"]) and any(mark["stage"] == "start" for mark in sample["milestones"])
summary = {"kind": "diagnostic-only-instrumented", "renderer": "software-configured",
           "testTimeoutMs": 60000, "modelReadinessTimeoutMs": 30000, "retries": 0,
           "exitCode": exit_code, "cleanupFailed": cleanup_failed, "samples": samples}
output.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
if exit_code or cleanup_failed or any(not sample["originalChecksPassed"] or not sample["instrumentationPresent"] for sample in samples):
    raise SystemExit(1)
