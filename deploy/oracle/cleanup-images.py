#!/usr/bin/env python3
"""Release-finalization cleanup scoped to labelled Smart Factory images.

No global prune, no forced deletion and no volume/container/build-cache removal.
The running release and its exact verified rollback image are mandatory keepers.
"""
import argparse
import datetime
import json
import re
import subprocess
import urllib.request

IMAGE = re.compile(r"sha256:[a-f0-9]{64}\Z")
SOURCE = re.compile(r"[a-f0-9]{40}\Z")

def run(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()

def inspect_images(ids):
    rows = []
    for start in range(0, len(ids), 50):
        rows.extend(json.loads(run("image", "inspect", *ids[start:start + 50])))
    return rows

def managed(image):
    labels = (image.get("Config") or {}).get("Labels") or {}
    return all(SOURCE.fullmatch(labels.get(key, "") or "") for key in (
        "org.opencontainers.image.revision", "io.smartfactory.backend.revision", "io.smartfactory.edge.revision"))

def cleanup_plan(images, containers, current, rollback):
    if not IMAGE.fullmatch(current) or not IMAGE.fullmatch(rollback) or current == rollback:
        raise ValueError("Two distinct exact current/rollback image IDs are required")
    by_id = {row["Id"]: row for row in images}
    for identity in (current, rollback):
        image = by_id.get(identity)
        if not image or not managed(image) or image.get("Os") != "linux" or image.get("Architecture") != "arm64":
            raise ValueError("Both retained images must be verified labelled Linux ARM64 images")
    project = [row for row in containers if (row.get("Config", {}).get("Labels") or {}).get("com.docker.compose.project") == "smart-factory-backend" and row.get("State", {}).get("Running")]
    for service in ("api", "worker"):
        rows = [row for row in project if row["Config"]["Labels"].get("com.docker.compose.service") == service]
        if len(rows) != 1 or rows[0]["Image"] != current:
            raise ValueError("Exactly one current API and singleton worker must be running")
    protected = {current, rollback, *(row["Image"] for row in containers)}
    return [{"id": row["Id"], "source": row["Config"]["Labels"]["org.opencontainers.image.revision"], "tags": row.get("RepoTags") or []} for row in images if managed(row) and row["Id"] not in protected]

def fetch(origin, path):
    with urllib.request.urlopen(origin.rstrip("/") + path, timeout=15) as response:
        return json.load(response)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current-image", required=True)
    parser.add_argument("--rollback-image", required=True)
    parser.add_argument("--api-source", required=True)
    parser.add_argument("--frontend-source", required=True)
    parser.add_argument("--api-origin", default="http://127.0.0.1:10000")
    parser.add_argument("--frontend-origin", default="https://smart-factory-iot-app.vercel.app")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not SOURCE.fullmatch(args.api_source) or not SOURCE.fullmatch(args.frontend_source):
        parser.error("Exact qualified API and deployed frontend source identities are required")
    ids = list(dict.fromkeys(run("image", "ls", "--all", "--no-trunc", "--quiet").split()))
    images = inspect_images(ids)
    container_ids = run("ps", "--all", "--quiet").split()
    containers = json.loads(run("inspect", *container_ids)) if container_ids else []
    plan = cleanup_plan(images, containers, args.current_image, args.rollback_image)
    current = next(row for row in images if row["Id"] == args.current_image)
    if current["Config"]["Labels"]["org.opencontainers.image.revision"] != args.api_source:
        raise ValueError("Current image source does not match the qualified API")
    runtime = fetch(args.api_origin, "/api/runtime/contract")
    proxied = fetch(args.frontend_origin, "/api/runtime/contract")
    release = fetch(args.frontend_origin, "/release.json")
    for contract in (runtime, proxied):
        if contract.get("source") != args.api_source or not contract.get("schema", {}).get("ready") or contract.get("worker") != {"fresh": True, "compatible": True}:
            raise ValueError("The current API and proxied worker contract must pass before cleanup")
    required = release.get("requiredCapabilities")
    if not isinstance(required,list) or not required or any(not isinstance(c,str) for c in required):
        raise ValueError("Frontend capability requirements must be attested")
    for contract in (runtime,proxied):
        if release.get("contractVersion") != contract.get("contractVersion") or not set(required).issubset(contract.get("capabilities",[])):
            raise ValueError("Frontend/API compatibility must pass before cleanup")
    if release.get("source") != args.frontend_source:
        raise ValueError("The verified frontend must be live before cleanup")
    report = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "mode": "apply" if args.apply else "plan", "currentImage": args.current_image, "rollbackImage": args.rollback_image, "apiSource": args.api_source, "frontendSource": args.frontend_source, "candidates": plan, "removed": [], "retained": []}
    if args.apply:
        for item in plan:
            # Re-evaluate all containers immediately before each image deletion.
            active_ids = run("ps", "--all", "--quiet").split()
            active = json.loads(run("inspect", *active_ids)) if active_ids else []
            if item["id"] in {row["Image"] for row in active}:
                report["retained"].append({"id": item["id"], "reason": "Container reference appeared"})
                continue
            # Docker itself refuses deletion if a container starts during this check.
            failed = False
            fresh = inspect_images([item["id"]])[0]
            for reference in fresh.get("RepoTags") or [item["id"]]:
                result = subprocess.run(["docker", "image", "rm", reference], capture_output=True, text=True)
                if result.returncode:
                    report["retained"].append({"id": item["id"], "reason": "Docker refused unforced removal"})
                    failed = True
                    break
            if not failed:
                remaining = run("image", "ls", "--all", "--no-trunc", "--quiet").split()
                if item["id"] in remaining:
                    result = subprocess.run(["docker", "image", "rm", item["id"]], capture_output=True, text=True)
                    failed = result.returncode != 0
                (report["retained"] if failed else report["removed"]).append({"id": item["id"]})
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
