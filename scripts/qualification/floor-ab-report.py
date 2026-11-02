#!/usr/bin/env python3
"""Publish only fixed categories and numeric data from private test reports."""
import json
from pathlib import Path
import re
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: floor-ab-report.py STATUS_TSV PRIVATE_DIR SUMMARY_JSON")
status_file, private_dir, output = map(Path, sys.argv[1:])
expected_cases = {(390, "light"), (390, "dark"), (1440, "light"), (1440, "dark")}
allowed_statuses = {"passed", "failed", "timedOut", "interrupted", "skipped"}


def number(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 3600000


def specs(suites, ancestors=()):
    for suite in suites:
        names = ancestors + (suite.get("title", ""),)
        for spec in suite.get("specs", []):
            yield names, spec
        yield from specs(suite.get("suites", []), names)


def results(variant):
    try:
        report = json.loads((private_dir / f"{variant}-report.json").read_text())
    except (OSError, ValueError):
        return []
    found = []
    for ancestors, spec in specs(report.get("suites", [])):
        if spec.get("title") != "renders all floor items and native references with summary graphs and item drill-down":
            continue
        groups = [re.fullmatch(r"Overview graphics whole factory (390|1440)px (light|dark)", name) for name in ancestors]
        groups = [group for group in groups if group]
        if len(groups) != 1:
            continue
        width, theme = int(groups[0].group(1)), groups[0].group(2)
        for test in spec.get("tests", []):
            entries = test.get("results", [])
            if len(entries) != 1:
                continue
            entry = entries[0]
            state, duration, timeout, retry = (entry.get("status"), entry.get("duration"), test.get("timeout"), entry.get("retry"))
            if state not in allowed_statuses or not all(number(value) for value in (duration, timeout, retry)):
                continue
            found.append({"width": width, "theme": theme, "status": state,
                          "durationMs": duration, "timeoutMs": timeout, "retry": retry})
    return found


lines = status_file.read_text().splitlines()
if not lines or lines[0] != "variant\texit\tcleanup":
    raise SystemExit("Invalid diagnostic status header")
samples = []
for line in lines[1:]:
    fields = line.split("\t")
    if len(fields) != 3 or fields[0] not in {"baseline", "candidate"}:
        raise SystemExit("Invalid diagnostic sample")
    variant, exit_text, cleanup_text = fields
    if not re.fullmatch(r"[0-9]{1,3}", exit_text) or cleanup_text not in {"0", "1"}:
        raise SystemExit("Invalid diagnostic exit category")
    tests = results(variant)
    observed = [(test["width"], test["theme"]) for test in tests]
    passed = (len(observed) == 4 and set(observed) == expected_cases
              and all(test["status"] == "passed" and test["timeoutMs"] == 60000
                      and test["durationMs"] <= 60000 and test["retry"] == 0 for test in tests))
    samples.append({"variant": variant, "exitCode": int(exit_text),
                    "cleanupFailed": cleanup_text == "1", "tests": tests,
                    "originalChecksPassed": passed})

summary = {"kind": "diagnostic-only", "sameHostedRunner": True, "order": "AB",
           "testTimeoutMs": 60000, "modelReadinessTimeoutMs": 30000,
           "retries": 0, "samples": samples}
output.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary))
if ([sample["variant"] for sample in samples] != ["baseline", "candidate"] or
        any(sample["exitCode"] or sample["cleanupFailed"] or not sample["originalChecksPassed"] for sample in samples)):
    raise SystemExit(1)
