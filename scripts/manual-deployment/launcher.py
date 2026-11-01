#!/usr/bin/env python3
"""Workspace launcher for the selected repository's maintained manual tools."""
import argparse
import json
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parents[2]
options = argparse.ArgumentParser(add_help=False)
options.add_argument("--source-root")
args, _ = options.parse_known_args()
selected = args.source_root or json.loads(Path(__file__).with_name("config.json").read_text())["sourceRoot"]
source = Path(selected).expanduser()
source = (source if source.is_absolute() else root / source).resolve()
if not source.is_relative_to(root) or (root / "locals-tools/recovered") in source.parents:
    raise SystemExit("Source root must be an active checkout within the Smart Factory workspace.")
core = source / "smart-factory-frontend/scripts/manual-deployment/cli.py"
if not core.is_file():
    raise SystemExit("Missing maintained manual CLI: " + str(core) + "; select the reviewed --source-root from config.json.")
sys.dont_write_bytecode = True
runpy.run_path(str(core), run_name="__main__")
