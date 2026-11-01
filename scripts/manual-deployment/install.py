#!/usr/bin/env python3
"""Install workspace launchers. Default is a read-only plan; --execute writes them."""
import argparse
import json
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    root, sources = args.workspace.expanduser().resolve(), args.source_root.expanduser().resolve()
    if not all((root / name).is_dir() for name in ("locals-tools", "smart-factory-frontend", "smart-factory-backend", "smart-factory-edge")):
        raise SystemExit("Expected the canonical Smart Factory workspace and its existing locals-tools directory.")
    if not sources.is_relative_to(root) or sources.is_relative_to(root / "locals-tools/recovered"):
        raise SystemExit("Select active sources inside the canonical workspace.")
    source = Path(__file__).resolve().parent
    target = root / "locals-tools/manual deployment"
    alias = root / "local-tools"
    if (alias.exists() or alias.is_symlink()) and alias.resolve() != (root / "locals-tools").resolve():
        raise SystemExit("local-tools belongs to another directory; inspect it before installing anything.")
    files = {"deploy.py": source / "launcher.py", "README.md": source / "README.md"}
    files.update({path.name: path for path in source.glob("*.sh")})
    for name, path in files.items():
        destination = target / name
        if destination.exists() and destination.read_bytes() != path.read_bytes():
            raise SystemExit("Existing launcher/document differs; preserve and review it before replacing: " + str(destination))
    print(json.dumps({"target": str(target), "alias": str(alias), "sources": str(sources), "files": list(files),
                      "mode": "install" if args.execute else "plan"}, indent=2))
    if args.execute:
        target.mkdir(parents=True, exist_ok=True)
        if not alias.exists():
            alias.symlink_to("locals-tools", target_is_directory=True)
        for name, path in files.items():
            shutil.copyfile(path, target / name)
            (target / name).chmod(0o755 if name.endswith((".py", ".sh")) else 0o644)
        (target / "config.json").write_text(json.dumps({"sourceRoot": str(sources.relative_to(root))}, indent=2) + "\n")


if __name__ == "__main__":
    main()
