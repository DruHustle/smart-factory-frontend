#!/usr/bin/env python3
"""Download only revision-pinned, package-licensed NVIDIA sources. Never used by the API."""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import urllib.request

ORIGIN = "https://huggingface.co"
MAX_FILE_BYTES = 96 * 1024 * 1024
MAX_PACKAGE_BYTES = 768 * 1024 * 1024
MAX_FILES = 1000

def safe_relative(value: str) -> PurePosixPath:
    p = PurePosixPath(value)
    if not value or p.is_absolute() or ".." in p.parts or "\\" in value or ":" in value or any(ord(c) < 32 for c in value):
        raise ValueError("Unsafe package path")
    return p

def fetch(url: str, limit: int) -> bytes:
    if not url.startswith(ORIGIN + "/"):
        raise ValueError("Unapproved source origin")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Smart-Factory-OpenUSD/1.0"}), timeout=120) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source byte budget exceeded")
    return data

def verify_git_file(data: bytes, entry: dict) -> None:
    if len(data) != entry["size"]:
        raise ValueError("Source length mismatch: " + entry["path"])
    if entry.get("lfs"):
        actual = hashlib.sha256(data).hexdigest()
        expected = entry["lfs"]["oid"]
    else:
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        expected = entry["oid"]
    if actual != expected:
        raise ValueError("Source integrity mismatch: " + entry["path"])

def download(config: dict, output: Path) -> None:
    if config.get("dataset") != "nvidia/simready-assets" or not re.fullmatch(r"[a-f0-9]{40}", config.get("revision", "")):
        raise ValueError("An immutable official NVIDIA dataset revision is required")
    output.mkdir(parents=True, exist_ok=True)
    revision = config["revision"]
    resolve = f"{ORIGIN}/datasets/{config['dataset']}/resolve/{revision}/"
    for asset in config["assets"]:
        asset_id = asset["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", asset_id):
            raise ValueError("Invalid asset ID")
        metadata_path = asset_id + "/com.nvidia.simready.packaging.json"
        raw = fetch(resolve + metadata_path, 128 * 1024)
        if hashlib.sha256(raw).hexdigest() != asset["packagingSha256"]:
            raise ValueError("Pinned package metadata changed")
        metadata = json.loads(raw)
        if metadata.get("license") != "CC-BY-4.0":
            raise ValueError("Asset license is not approved for this library")
        license_bytes = fetch(resolve + asset_id + "/.metadata/LICENSE.txt", 128 * 1024)
        if b"Attribution 4.0 International" not in license_bytes:
            raise ValueError("CC BY 4.0 license text missing")
        tree = json.loads(fetch(f"{ORIGIN}/api/datasets/{config['dataset']}/tree/{revision}/{asset_id}?recursive=true&limit=1000", 8 * 1024 * 1024))
        if not isinstance(tree, list) or len(tree) >= MAX_FILES:
            raise ValueError("Package inventory exceeds the bounded complete-page policy")
        files = []
        for entry in tree:
            if entry["type"] != "file":
                continue
            p = safe_relative(entry["path"])
            if p.parts[0] != asset_id:
                raise ValueError("Package inventory escaped its asset")
            if ".thumbs" in p.parts:
                continue
            if entry["size"] < 0 or entry["size"] > MAX_FILE_BYTES:
                raise ValueError("Source file exceeds reviewed budget")
            files.append(entry)
        if sum(f["size"] for f in files) > MAX_PACKAGE_BYTES:
            raise ValueError("Source package exceeds reviewed budget")
        def one(entry: dict) -> dict:
            target = output / safe_relative(entry["path"])
            if target.is_symlink() or any(p.is_symlink() for p in target.parents):
                raise ValueError("Symlinks are not allowed in the source directory")
            data = fetch(resolve + entry["path"], MAX_FILE_BYTES)
            verify_git_file(data, entry)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            return {"path": entry["path"], "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            evidence = list(pool.map(one, files))
        (output / asset_id / "source-receipt.json").write_text(json.dumps({
            "dataset": config["dataset"], "revision": revision,
            "packagingSha256": asset["packagingSha256"], "license": metadata["license"],
            "files": sorted(evidence, key=lambda f: f["path"]),
        }, indent=2) + "\n")
        print(f"Verified {asset_id}: {len(files)} source files, {sum(f['size'] for f in files)} bytes", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("curated.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    download(json.loads(args.config.read_text()), args.output)
