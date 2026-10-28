#!/usr/bin/env python3
"""Consolidate the three Smart Factory checkouts without resetting local work.

Dry run by default. Requires Python 3.9+ and Git. Never deletes a checkout,
stashes changes, rewrites tracked files, or force-updates a branch.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

COMPONENTS = ("frontend", "backend", "edge")
REMOTE = re.compile(
    r"^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)"
    r"DruHustle/smart-factory(?:-iot)?(?:-(frontend|backend|edge))?(\.git)?$",
    re.IGNORECASE,
)
DEFAULT_BASE = Path.home() / "Software Development" / "GitHub"


def git(path, *args, optional=False):
    result = subprocess.run(
        ["git", "-C", str(path), *args], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode and not optional:
        # Git errors can contain credential-bearing remote URLs. Do not print them.
        raise RuntimeError(f"Git {args[0]} failed in {path}. No reset or deletion was attempted.")
    return result.stdout.strip() if result.returncode == 0 else ""


def identity(url):
    match = REMOTE.fullmatch(url)
    if not match:
        return None
    return match.group(2) or "frontend"


def renamed_url(url, component):
    match = REMOTE.fullmatch(url)
    if not match or identity(url) != component:
        raise RuntimeError("An origin URL points to a different repository; resolve it before migration.")
    return f"{match.group(1)}DruHustle/smart-factory-{component}{match.group(3) or ''}"


def discover(base):
    found = {component: [] for component in COMPONENTS}
    # Inspect only named project locations, never unrelated repositories or dependencies.
    def inspect(path, depth=0):
        if path.is_symlink():
            raise RuntimeError(f"Project path is a symlink; resolve it before migration: {path}")
        if not path.is_dir():
            return
        marker = path / ".git"
        if marker.exists():
            origin = git(path, "remote", "get-url", "origin", optional=True)
            component = identity(origin)
            if component is None:
                raise RuntimeError(f"Unrecognized repository at {path}; nothing was moved.")
            top = Path(git(path, "rev-parse", "--show-toplevel")).resolve()
            if top != path.resolve():
                raise RuntimeError(f"Not an independent checkout: {path}")
            if git(path, "rev-parse", "--show-superproject-working-tree", optional=True):
                raise RuntimeError(f"Submodule migration requires its owning project: {path}")
            for url in git(path, "remote", "get-url", "--all", "origin").splitlines():
                renamed_url(url, component)
            for url in git(path, "config", "--get-all", "remote.origin.pushurl", optional=True).splitlines():
                renamed_url(url, component)
            found[component].append(path)
        if depth < 3:
            for child in sorted(path.iterdir()):
                if child.name.startswith("smart-factory") and child.is_dir():
                    inspect(child, depth + 1)
    roots = [path for path in sorted(base.iterdir()) if path.name.startswith("smart-factory")]
    for path in roots:
        inspect(path)
    for component, paths in found.items():
        if len(paths) > 1:
            raise RuntimeError(
                f"Multiple {component} checkouts found; choose which one to keep before migration:\n"
                + "\n".join(str(path) for path in paths)
            )
    return {component: paths[0] for component, paths in found.items() if paths}


def migrate(base, apply=False, sync=False, clone_missing=True):
    base = base.expanduser().resolve()
    if not base.is_dir():
        raise RuntimeError(f"GitHub folder does not exist: {base}")
    target = base / "smart-factory"
    found = discover(base)
    if not found:
        raise RuntimeError("No recognized Smart Factory checkout was found. Nothing was changed.")
    if (target / ".git").exists():
        raise RuntimeError("The smart-factory parent must be a plain workspace, not a Git checkout.")
    old_parent = base / "smart-factory-iot"
    wrapper = old_parent if old_parent.is_dir() and not (old_parent / ".git").exists() else None
    # Extra files in an existing plain parent are retained, with collision checks before moving.
    extras = []
    if wrapper:
        for child in wrapper.iterdir():
            if child not in found.values():
                destination = target / child.name
                if destination.exists() or destination.is_symlink():
                    raise RuntimeError(f"Workspace file conflict: {destination}. Nothing was moved.")
                extras.append((child, destination))
    for component in COMPONENTS:
        destination = target / f"smart-factory-{component}"
        source = found.get(component)
        if (destination.exists() or destination.is_symlink()) and source != destination:
            raise RuntimeError(f"Destination is occupied: {destination}. Nothing was moved.")
        print(f"{component}: {source or '(clone missing checkout)'} -> {destination}")
    workspace = target / "smart-factory.code-workspace"
    workspace_content = json.dumps({"folders": [
        {"path": f"smart-factory-{component}"} for component in COMPONENTS
    ]}, indent=2) + "\n"
    if workspace.exists() and workspace.read_text() != workspace_content:
        raise RuntimeError(f"Existing workspace has custom settings; preserve them before migration: {workspace}")
    if not apply:
        print("Dry run complete. Add --apply to move checkouts and update origin URLs.")
        return target
    stage = Path(tempfile.mkdtemp(prefix=".smart-factory-migration-", dir=base))
    os.chmod(stage, 0o700)
    moves, repos = [], {}
    journal = stage / "moves.json"

    def record():
        journal.write_text(json.dumps({"moves": [
            {"from": str(source), "to": str(destination), "repository": repository}
            for source, destination, repository in moves
        ]}, indent=2) + "\n")
        journal.chmod(0o600)

    def move(source, destination, repository=False):
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() or destination.is_symlink():
            raise RuntimeError(f"Destination became occupied: {destination}")
        if repository and (source / ".git").is_file():
            git(source, "worktree", "move", str(source), str(destination))
        else:
            source.rename(destination)
        moves.append((source, destination, repository))
        record()
        if repository:
            git(destination, "worktree", "repair")

    try:
        # Clone missing components before touching existing working copies.
        for component in COMPONENTS:
            if component not in found and clone_missing:
                clone = stage / f"clone-{component}"
                result = subprocess.run([
                    "git", "clone", f"https://github.com/DruHustle/smart-factory-{component}.git", str(clone)
                ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if result.returncode:
                    raise RuntimeError(f"Could not clone {component}; existing checkouts are untouched.")
                repos[component] = clone
        # Extract nested repositories first, retaining staged, untracked and ignored files.
        for component, source in sorted(found.items(), key=lambda pair: len(pair[1].parts), reverse=True):
            destination = target / f"smart-factory-{component}"
            if source == destination:
                repos[component] = source
            else:
                staged = stage / component
                move(source, staged, repository=True)
                repos[component] = staged
        target.mkdir(exist_ok=True)
        for source, destination in extras:
            move(source, destination)
        for component, source in list(repos.items()):
            destination = target / f"smart-factory-{component}"
            if source != destination:
                move(source, destination, repository=True)
            repos[component] = destination
    except BaseException:
        print(f"Migration stopped. Recovery journal: {journal}", file=sys.stderr)
        # Reverse directory moves only. Never reset files or remove a checkout.
        for source, destination, repository in reversed(moves):
            try:
                source.parent.mkdir(parents=True, exist_ok=True)
                if source.exists() or source.is_symlink():
                    raise RuntimeError(f"Rollback path is occupied: {source}")
                if repository and (destination / ".git").is_file():
                    git(destination, "worktree", "move", str(destination), str(source))
                else:
                    destination.rename(source)
                if repository:
                    git(source, "worktree", "repair")
            except Exception:
                print(f"Review preserved files at {source} and {destination} before retrying.", file=sys.stderr)
        raise
    for component, path in repos.items():
        urls = git(path, "remote", "get-url", "--all", "origin").splitlines()
        push_urls = git(path, "config", "--get-all", "remote.origin.pushurl", optional=True).splitlines()
        git(path, "config", "--unset-all", "remote.origin.url", optional=True)
        for url in urls:
            git(path, "config", "--add", "remote.origin.url", renamed_url(url, component))
        if push_urls:
            git(path, "config", "--unset-all", "remote.origin.pushurl")
            for url in push_urls:
                git(path, "config", "--add", "remote.origin.pushurl", renamed_url(url, component))
    workspace.write_text(workspace_content)
    if wrapper and wrapper.exists():
        try:
            wrapper.rmdir()  # Succeeds only when empty; never deletes any files.
        except OSError:
            print(f"Extra files remain in {wrapper}; review them manually.")
    if journal.exists():
        journal.rename(target / ("migration-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".json"))
    try:
        stage.rmdir()
    except OSError:
        print(f"Retained staging files for review: {stage}")
    if sync:
        for component, path in repos.items():
            branch = git(path, "symbolic-ref", "--short", "HEAD", optional=True)
            default = "master" if component == "edge" else "main"
            if branch != default or git(path, "status", "--porcelain"):
                print(f"{component}: local work preserved; skipped update of a changed or non-default checkout.")
                continue
            try:
                git(path, "fetch", "origin", default)
                git(path, "merge", "--ff-only", f"origin/{default}")
            except RuntimeError:
                print(f"{component}: folder migrated; update needs review. No branch was reset.")
    print(f"Smart Factory workspace: {target}")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-dir", type=Path, default=DEFAULT_BASE)
    parser.add_argument("--apply", action="store_true", help="Apply the printed migration plan")
    parser.add_argument("--sync", action="store_true", help="Fast-forward clean default branches after migration")
    parser.add_argument("--no-clone", action="store_true", help="Do not clone missing components")
    args = parser.parse_args()
    try:
        migrate(args.github_dir, args.apply, args.sync, not args.no_clone)
    except (RuntimeError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
