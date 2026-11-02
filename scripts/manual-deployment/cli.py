#!/usr/bin/env python3
"""Smart Factory manual releases. Mutations require --execute; default is an offline plan.

Deployment engines, application migrations and build configuration remain in the
selected component repositories. All local outputs remain inside the workspace.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = next((path for path in Path(__file__).resolve().parents
             if (path / "AGENTS.md").is_file() and (path / "local-tools").is_dir()
             and (path / "smart-factory-frontend").is_dir()), None)
if ROOT is None:
    # Permit unit-test imports in standalone CI. Actual commands validate the
    # canonical workspace before resolving sources or writing any evidence.
    ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT / "local-tools/manual deployment"
EVIDENCE = ROOT / "local-tools/deployment-evidence"
REPOSITORY = "DruHustle/smart-factory-frontend"
API = "https://api.152-70-22-84.sslip.io"
UI = "https://smart-factory-iot-app.vercel.app"
COMPONENTS = ("frontend", "backend", "edge")
SHA = re.compile(r"[a-f0-9]{40}\Z")


class ReleaseError(RuntimeError):
    pass


def require(value, message):
    if not value:
        raise ReleaseError(message)


def within(path, boundary):
    path = Path(path).expanduser().resolve()
    require(path.is_relative_to(boundary.resolve()), "Path must stay inside " + str(boundary))
    return path


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("x", encoding="utf-8") as output:
        os.chmod(path, 0o600)
        json.dump(value, output, indent=2)
        output.write("\n")


def capture(command, cwd=None):
    result = subprocess.run(list(map(str, command)), cwd=cwd, text=True,
                            capture_output=True, timeout=120)
    require(result.returncode == 0, "Command failed: " + shlex.join(list(map(str, command[:3])))
            + ". Check credentials, prerequisites and repository state; no raw service output was printed.")
    return result.stdout.strip()


def git(repo, *arguments):
    return capture(["git", "-C", repo, *arguments])


def load_module(path):
    require(path.is_file(), "Missing maintained helper: " + str(path)
            + ". Select an up-to-date reviewed --source-root; the original checkout is preserved.")
    spec = importlib.util.spec_from_file_location("sf_release_" + uuid.uuid4().hex, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_root(explicit=None):
    tools = ROOT / "local-tools"
    require((ROOT / "AGENTS.md").is_file() and tools.is_dir() and not tools.is_symlink(),
            "Expected a physical local-tools directory in the canonical Smart Factory workspace; see README.md.")
    for name in ("manual deployment", "deployment-evidence"):
        require((tools / name).resolve().is_relative_to(tools.resolve()),
                "The " + name + " path must stay inside the physical local-tools directory.")
    selected = explicit or json.loads((HERE / "config.json").read_text())["sourceRoot"]
    path = Path(selected).expanduser()
    path = within(path if path.is_absolute() else ROOT / path, ROOT)
    require(not path.is_relative_to((tools / "recovered").resolve()), "Recovered copies are not active release sources.")
    return path


def repositories(base):
    result = {}
    for name in COMPONENTS:
        path = base / ("smart-factory-" + name)
        require(path.is_dir(), "Missing repository: " + str(path))
        require(Path(git(path, "rev-parse", "--show-toplevel")).resolve() == path.resolve(),
                "Expected a separate component Git root: " + str(path))
        remote = git(path, "remote", "get-url", "origin")
        allowed = (f"https://github.com/DruHustle/smart-factory-{name}.git",
                   f"git@github.com:DruHustle/smart-factory-{name}.git")
        require(remote in allowed, "Unexpected origin for " + name + "; inspect it without exposing credentials.")
        result[name] = {"path": str(path), "revision": git(path, "rev-parse", "HEAD"),
                        "branch": git(path, "rev-parse", "--abbrev-ref", "HEAD"),
                        "dirty": bool(git(path, "status", "--porcelain")), "remote": remote}
    return result


def clean_sources(sources):
    dirty = [name for name, value in sources.items() if value["dirty"]]
    require(not dirty, "Commit and qualify the reviewed changes first; dirty repositories: " + ", ".join(dirty))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def get_json(url):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-store"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
        require(response.status == 200, "Expected HTTP 200 from the configured release endpoint.")
        data = response.read(1024 * 1024 + 1)
        require(len(data) <= 1024 * 1024, "Release response exceeds the allowed size.")
        return json.loads(data)


def baseline(runtime):
    require(runtime.get("contractVersion") == 2 and runtime.get("versioned") is True
            and runtime.get("deployment") == "bundle", "Runtime cannot attest versioned bundle identity.")
    sources = dict(zip(COMPONENTS, (runtime.get("source"), runtime.get("backendSource"), runtime.get("edgeSource"))))
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in sources.values()),
            "Runtime has invalid immutable revisions.")
    schema = runtime.get("schema", {})
    require(schema.get("ready") is True and re.fullmatch(r"\d{4}_[a-z0-9_]+", str(schema.get("revision", "")))
            and re.fullmatch(r"[a-f0-9]{64}", str(schema.get("digest", ""))), "Runtime schema is not ready or versioned.")
    capabilities = runtime.get("capabilities")
    require(isinstance(capabilities, list) and capabilities
            and all(isinstance(value, str) and re.fullmatch(r"[a-z0-9-]+", value) for value in capabilities),
            "Runtime capability evidence is invalid.")
    return {"sources": sources, "schema": {key: schema[key] for key in ("revision", "digest")},
            "capabilities": capabilities}


class Session:
    def __init__(self, args, sources):
        self.args, self.sources = args, sources
        self.repo = Path(sources["frontend"]["path"])
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.release = within(args.release_dir, EVIDENCE) if args.release_dir else EVIDENCE / ("manual-" + stamp + "-" + uuid.uuid4().hex[:8])
        self.output = None
        self.steps = []

    def release_holds(self):
        """Find local review holds even when a manifest uses another receipt directory."""
        directories = {self.release}
        for supplied in (self.args.manifest, self.args.bundle):
            if supplied:
                artifact = Path(supplied).expanduser().resolve()
                if artifact.is_relative_to(EVIDENCE.resolve()):
                    for parent in artifact.parents:
                        if parent == EVIDENCE.resolve():
                            break
                        directories.add(parent)
        return sorted(str(path / "release-hold.json") for path in directories
                      if (path / "release-hold.json").exists() or (path / "release-hold.json").is_symlink())

    def promotion_gate(self):
        if self.args.operation in ("backend", "frontend", "all"):
            holds = self.release_holds()
            require(not holds, "Release is held for review: " + ", ".join(holds)
                    + ". Inspect the recorded findings and qualify the corrected candidate in a new release directory."
                    + " Status, verification and recovery remain available.")

    def begin(self):
        self.output = self.release / ("invocation-" + self.args.operation + "-" + uuid.uuid4().hex[:8])
        self.output.mkdir(parents=True, mode=0o700)
        save(self.output / "request.json", {"operation": self.args.operation, "sources": self.sources,
             "target": {"api": API, "frontend": UI, "vm": "ubuntu@152.70.22.84"},
             "startedAt": dt.datetime.now(dt.timezone.utc).isoformat()})
        print("Evidence: " + str(self.output), flush=True)

    def finish(self, status, message=None):
        if self.output:
            save(self.output / "result.json", {"status": status, "message": message,
                 "steps": self.steps, "finishedAt": dt.datetime.now(dt.timezone.utc).isoformat()})

    def run(self, command, label, env=None, cwd=None):
        require(shutil.which(str(command[0])) or Path(command[0]).is_file(), "Install prerequisite: " + str(command[0]))
        log = self.output / (str(len(self.steps) + 1).zfill(2) + "-" + label + ".log")
        print(label + ": " + shlex.join(list(map(str, command))), flush=True)
        # Credentials are inherited through the environment/SSH agent, never command arguments.
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "DOTENV_CONFIG_PATH": os.devnull,
                       "TMPDIR": str(self.output)}
        environment.update(env or {})
        with log.open("x") as output:
            os.chmod(log, 0o600)
            process = subprocess.Popen(list(map(str, command)), cwd=cwd or self.repo,
                                       env=environment, stdout=output, stderr=subprocess.STDOUT)
            while True:
                try:
                    code = process.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    print(label + " still running; protected log: " + str(log), flush=True)
        self.steps.append({"stage": label, "exitCode": code, "log": str(log)})
        guidance = " Correct the reported prerequisite or failure before retrying."
        if label in ("deploy-api-worker", "vm-status"):
            guidance = " A detached VM deployment may continue. Use status with the same release directory."
        elif label in ("dispatch-frontend", "await-frontend"):
            guidance = " Check the saved frontend request/run receipt and GitHub Actions before dispatching again."
        require(code == 0, label + " failed (exit " + str(code) + "). Inspect " + str(log) + "." + guidance)

    def manifest(self, verify_bundle=False):
        require(self.args.manifest, "Supply --manifest from completed ARM64 qualification.")
        core = load_module(self.repo / "scripts/deploy-vm.py")
        try:
            core.M = core.validate_manifest(json.loads(Path(self.args.manifest).read_text()))
        except RuntimeError as error:
            raise ReleaseError("Release manifest rejected: " + core.safe_error(error)) from None
        print(json.dumps({"qualifiedCandidate": core.M["candidate"], "qualifiedFallback": core.M["rollback"],
                          "artifact": core.M["artifact"]}, indent=2), flush=True)
        if verify_bundle:
            require(self.args.bundle, "Supply --bundle with the exact qualified ARM64 ZIP.")
            try:
                core.verify_bundle(Path(self.args.bundle).resolve())
            except RuntimeError as error:
                raise ReleaseError("Qualified artifact rejected: " + core.safe_error(error)) from None
        return core

    def coordinated_inputs(self):
        require(self.args.sha and SHA.fullmatch(self.args.sha) and self.sources["frontend"]["revision"] == self.args.sha,
                "Coordinated release requires the checkout matching --sha.")
        clean_sources(self.sources)
        core = self.manifest(verify_bundle=True)
        require(core.M["candidate"]["sources"] == {name: item["revision"] for name, item in self.sources.items()},
                "Coordinated candidate revisions differ from the selected checkouts.")
        return core

    def status(self):
        if self.args.manifest:
            self.manifest()
            self.run([sys.executable, self.repo / "scripts/deploy-vm.py", "--manifest", Path(self.args.manifest).resolve(),
                      "--state", self.release / "vm-deployment.json", "--status", "--once"], "vm-status")
            return
        observed = {"checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "api": get_json(API + "/api/runtime/contract"),
                    "proxiedApi": get_json(UI + "/api/runtime/contract"), "frontend": get_json(UI + "/release.json")}
        save(self.output / "observed-runtime.json", observed)
        snapshot = baseline(observed["api"])
        save(self.output / "baseline.json", snapshot)
        baseline_path = self.release / "observed-baseline.json"
        if not baseline_path.exists():
            save(baseline_path, snapshot)
        else:
            require(json.loads(baseline_path.read_text()) == snapshot,
                    "Production identity changed since this release's baseline; use a new release directory.")
        print(json.dumps(observed, indent=2))
        require(observed["api"].get("worker") == {"fresh": True, "compatible": True},
                "API worker receipt is missing, stale or incompatible; observed evidence is retained.")
        require(baseline(observed["api"]) == baseline(observed["proxiedApi"])
                and observed["proxiedApi"].get("worker") == {"fresh": True, "compatible": True},
                "The frontend proxy does not serve the same ready API/worker identity.")

    def verify(self):
        require(self.args.sha and SHA.fullmatch(self.args.sha), "Supply --sha with the full expected frontend revision.")
        require(self.sources["frontend"]["revision"] == self.args.sha,
                "Select the checkout matching --sha so verification uses that release's schema and capability contract.")
        clean_sources({"frontend": self.sources["frontend"]})
        if self.args.manifest:
            core = self.manifest()
            for origin in (API, UI):
                require(core.runtime_matches(get_json(origin + "/api/runtime/contract"), core.M["candidate"], require_worker=True),
                        "Live API/worker identity differs from the qualified candidate.")
        for label, origin in (("api", API), ("proxy", UI)):
            get_json(origin + "/health/ready")
            self.run(["node", "--import", "tsx", "scripts/verify-runtime.mts"], "verify-" + label,
                     env={"API_ORIGIN": origin, "RUNTIME_EVIDENCE_FILE": str(self.output / (label + "-runtime.json"))})
        self.run(["node", "--import", "tsx", "scripts/verify-release.mts"], "verify-frontend",
                 env={"RELEASE_ORIGIN": UI, "RELEASE_SHA": self.args.sha})

    def package(self):
        prepare, plan = self.package_inputs()
        package = self.release / "source-package"
        package.mkdir(mode=0o700)
        for name, source in self.sources.items():
            branch = plan["candidate"][name]["ref"]
            path = package / (name + ".bundle")
            self.run(["git", "-C", source["path"], "bundle", "create", path, branch], "bundle-" + name)
            require(git(source["path"], "rev-parse", branch) == source["revision"], "Source moved while packaging; discard this incomplete package.")
            plan["candidate"][name]["bundleSha256"] = digest(path)
        prepare.validate_plan(plan)
        save(package / "release-plan.json", plan)
        prepare.load_source_package(package)
        print("Source package: " + str(package))

    def package_inputs(self):
        clean_sources(self.sources)
        require(self.args.baseline, "Capture status first, then supply its baseline.json using --baseline.")
        prepare = load_module(self.repo / "scripts/prepare-manual-release.py")
        pins = json.loads((self.repo / "deploy/qualification-sources.json").read_text())
        require(all(pins[name] == self.sources[name]["revision"] for name in ("backend", "edge")),
                "Frontend qualification pins must match the selected backend and edge commits.")
        require(json.loads((self.repo / "deploy/rollback-sources.json").read_text()) == prepare.FALLBACK,
                "Fallback pins differ from the maintained preparation engine.")
        plan = {"planVersion": 1, "candidate": {}, "rollback": prepare.FALLBACK,
                "baseline": json.loads(Path(self.args.baseline).read_text())}
        for name, source in self.sources.items():
            require(source["branch"] != "HEAD", "Source packaging requires a named review branch for " + name)
            branch = "refs/heads/" + source["branch"]
            plan["candidate"][name] = {"sha": source["revision"], "ref": branch,
                                      "bundleFile": name + ".bundle", "bundleSha256": "0" * 64}
        prepare.validate_plan(plan)
        return prepare, plan

    def prepare(self):
        package = Path(self.args.source_package).resolve() if self.args.source_package else self.release / "source-package"
        module = load_module(self.repo / "scripts/prepare-manual-release.py")
        module.load_source_package(package)
        self.run([sys.executable, self.repo / "scripts/prepare-manual-release.py", "--source-package", package,
                  "--work-dir", self.release / "qualification", "--lock-dir", within(ROOT / "local-tools/release-tools/manual-locks", ROOT / "local-tools"),
                  "--prepare"], "qualify-arm64")

    def backend(self):
        self.manifest(verify_bundle=True)
        self.run([sys.executable, self.repo / "scripts/deploy-vm.py", "--manifest", Path(self.args.manifest).resolve(),
                  "--bundle", Path(self.args.bundle).resolve(), "--state", self.release / "vm-deployment.json", "--deploy"], "deploy-api-worker")

    def frontend_source_gate(self):
        require(self.args.sha and SHA.fullmatch(self.args.sha), "Supply --sha with the qualified current main revision.")
        require(self.sources["frontend"]["revision"] == self.args.sha, "Frontend checkout and requested --sha differ.")
        clean_sources({"frontend": self.sources["frontend"]})
        require(shutil.which("gh"), "Install GitHub CLI and authenticate using gh auth login.")
        current = capture(["gh", "api", f"repos/{REPOSITORY}/commits/main", "--jq", ".sha"])
        require(current == self.args.sha, "Requested frontend is not current remote main; finish reviewed promotion first.")
        runs = json.loads(capture(["gh", "api", f"repos/{REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100"]))
        require(any(run["head_sha"] == self.args.sha and run["conclusion"] == "success" for run in runs["workflow_runs"]),
                "No successful push CI for the exact main revision; do not bypass release gates.")

    def frontend(self):
        self.frontend_source_gate()
        if self.args.manifest:
            core = self.manifest()
            require(core.M["candidate"]["sources"]["frontend"] == self.args.sha,
                    "The qualified candidate and requested frontend SHA differ.")
            for origin in (API, UI):
                require(core.runtime_matches(get_json(origin + "/api/runtime/contract"), core.M["candidate"], require_worker=True),
                        "Live API/worker identity differs from the qualified candidate; frontend was not dispatched.")
        self.run(["node", "--import", "tsx", "scripts/verify-runtime.mts"], "frontend-api-preflight",
                 env={"API_ORIGIN": API, "RUNTIME_EVIDENCE_FILE": str(self.output / "pre-promotion-api.json")})
        request_id = uuid.uuid4().hex
        save(self.output / "frontend-dispatch-request.json", {"sha": self.args.sha, "requestId": request_id})
        self.run(["gh", "workflow", "run", "deploy-vercel-oracle.yml", "--repo", REPOSITORY, "--ref", "main",
                  "--field", "expected_sha=" + self.args.sha, "--field", "request_id=" + request_id], "dispatch-frontend")
        # Ambiguous concurrent dispatches are never silently attributed to this invocation.
        deadline = time.monotonic() + 180
        run_id = None
        while time.monotonic() < deadline:
            rows = json.loads(capture(["gh", "run", "list", "--repo", REPOSITORY, "--workflow", "deploy-vercel-oracle.yml",
                                      "--event", "workflow_dispatch", "--limit", "20", "--json", "databaseId,headSha,displayTitle"]))
            matches = [row for row in rows if row["displayTitle"] == "UI " + row["headSha"] + " " + request_id]
            require(len(matches) <= 1, "Multiple matching frontend runs; inspect GitHub Actions before retrying.")
            if matches:
                run_id = str(matches[0]["databaseId"])
                resolved_sha = matches[0]["headSha"]
                break
            time.sleep(5)
        require(run_id, "No matching deployment run appeared; inspect GitHub Actions before dispatching again.")
        save(self.output / "frontend-run.json", {"id": run_id, "sha": self.args.sha, "resolvedSha": resolved_sha, "requestId": request_id,
             "url": f"https://github.com/{REPOSITORY}/actions/runs/{run_id}"})
        require(resolved_sha == self.args.sha, "Main changed during dispatch; the workflow's expected-SHA guard refuses promotion. Inspect the recorded run.")
        self.run(["gh", "run", "watch", run_id, "--repo", REPOSITORY, "--exit-status", "--interval", "10"], "await-frontend")
        self.verify()

    def edge_inputs(self):
        source = self.sources["edge"]
        clean_sources({"edge": source})
        require(self.args.wheels, "Supply --wheels with audited offline wheels for the commissioned Pi architecture/Python.")
        wheels = Path(self.args.wheels).resolve()
        require(wheels.is_dir() and list(wheels.glob("*.whl")), "The offline wheel directory is missing or empty.")
        repo = Path(source["path"])
        installer = load_module(repo / "raspberry-pi/scripts/install-telemetry-release.py")
        requirements = git(repo, "show", source["revision"] + ":raspberry-pi/requirements.txt")
        pins = installer.requirement_pins(requirements)
        allowed_hashes = set(re.findall(r"--hash=sha256:([a-f0-9]{64})", requirements))
        distributions = set()
        for wheel in wheels.iterdir():
            require(wheel.is_file() and not wheel.is_symlink() and wheel.suffix == ".whl", "Wheel directory must contain only regular .whl files.")
            fields = wheel.name.split("-")
            require(len(fields) in (5, 6), "Invalid wheel filename: " + wheel.name)
            name = re.sub(r"[-_.]+", "-", fields[0]).lower()
            require(pins.get(name) == fields[1] and digest(wheel) in allowed_hashes,
                    "Wheel is not hash-pinned by the reviewed requirements: " + wheel.name)
            distributions.add(name)
        require(distributions == set(pins), "Offline wheels must cover every pinned dependency; the Pi installer additionally verifies platform compatibility.")
        return source, repo, wheels, installer

    def edge(self):
        source, repo, wheels, installer = self.edge_inputs()
        destination = self.release / ("edge-" + source["revision"][:12])
        destination.mkdir(mode=0o700)
        selected = ("raspberry-pi/src/", "raspberry-pi/tests/", "raspberry-pi/examples/", "raspberry-pi/scripts/", "fixtures/")
        for entry in git(repo, "ls-tree", "-rz", source["revision"]).split("\0"):
            if not entry:
                continue
            meta, name = entry.split("\t", 1)
            if not (name.startswith(selected) or name == "raspberry-pi/requirements.txt"):
                continue
            mode, kind, blob = meta.split()
            require(kind == "blob" and mode in ("100644", "100755"), "Unsupported source entry in edge package.")
            require(re.fullmatch(r"[A-Za-z0-9_./+-]+", name) and ".." not in Path(name).parts, "Unsafe edge source path.")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(subprocess.check_output(["git", "-C", str(repo), "cat-file", "blob", blob]))
        (destination / "SOURCE_REVISION").write_text(source["revision"] + "\n")
        shutil.copyfile(destination / "raspberry-pi/scripts/install-telemetry-release.py", destination / "install-telemetry-release.py")
        (destination / "wheels").mkdir()
        for wheel in wheels.iterdir():
            require(wheel.is_file() and not wheel.is_symlink() and wheel.suffix == ".whl", "Wheel directory must contain only regular .whl files.")
            shutil.copyfile(wheel, destination / "wheels" / wheel.name)
        files = sorted(path for path in destination.rglob("*") if path.is_file())
        (destination / "SHA256SUMS").write_text("".join(digest(path) + "  " + path.relative_to(destination).as_posix() + "\n" for path in files))
        require(installer.verify_bundle(destination)[0] == source["revision"], "Edge package identity mismatch.")
        save(self.output / "edge-package.json", {"path": str(destination), "revision": source["revision"],
             "checksumManifest": digest(destination / "SHA256SUMS"), "installedOnHardware": False})
        print("Verified gateway package: " + str(destination) + ". Follow README for commissioned-host qualification/cutover; no device was changed.")

    def recover(self):
        # The proven VM engine automatically selects its independently qualified
        # fallback after a failed cutover. Never invent a second manual selector.
        print("Recovery: inspect the saved VM result and protected release directory. ROLLED_BACK is a failed upgrade. "
              "Do not restart a second worker, reverse migrations or choose a legacy image that drops industrial evidence. "
              "Use the independently qualified fallback pair. "
              "For a later rollback, restore a compatible retained Vercel artifact first if required; follow the selected repository's deploy/oracle/README.md.")
        self.status()


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("operation", choices=("inventory", "package", "prepare", "backend", "frontend", "edge", "all", "status", "verify", "recover"))
    modes = p.add_mutually_exclusive_group()
    modes.add_argument("--dry-run", action="store_true", help="Offline plan (default); no credentials, network, builds or target changes.")
    modes.add_argument("--validate", action="store_true", help="Validate local inputs and qualified bundle without contacting any target.")
    modes.add_argument("--execute", action="store_true", help="Perform the requested action; backend/frontend/all require release authorization for this exact candidate.")
    p.add_argument("--source-root", help="Workspace-contained parent of the three component checkouts; see config.json.")
    p.add_argument("--release-dir", help="Persistent release directory under local-tools/deployment-evidence; reuse for status/recovery.")
    p.add_argument("--manifest")
    p.add_argument("--bundle")
    p.add_argument("--baseline")
    p.add_argument("--source-package")
    p.add_argument("--sha", help="Full expected frontend/main revision.")
    p.add_argument("--wheels", help="Audited Pi-compatible offline wheels for edge packaging.")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    os.umask(0o077)
    sys.dont_write_bytecode = True
    session = None
    try:
        require(sys.version_info >= (3, 9), "Python 3.9 or newer is required.")
        sources = repositories(source_root(args.source_root))
        session = Session(args, sources)
        plan = {"mode": "execute" if args.execute else "validate" if args.validate else "offline-plan",
                "operation": args.operation, "repositories": sources, "releaseDirectory": str(session.release),
                "target": {"environment": "production", "api": API, "frontend": UI, "vm": "ubuntu@152.70.22.84"},
                "order": ["qualified API with additive migrations", "one qualified worker", "runtime verification", "gated Vercel UI", "release verification"],
                "artifacts": {key: str(Path(value).expanduser().resolve()) if value else None
                              for key, value in (("manifest", args.manifest), ("bundle", args.bundle), ("sourcePackage", args.source_package))},
                "releaseHolds": session.release_holds(),
                "note": "A plan is not release qualification or deployment approval. Edge packaging does not install gateways."}
        print(json.dumps(plan, indent=2), flush=True)
        if args.operation == "inventory" or not (args.execute or args.validate):
            return 0
        require(args.release_dir, "Supply --release-dir under local-tools/deployment-evidence so receipts can be reused.")
        session.begin()
        session.promotion_gate()
        if args.validate:
            if args.operation == "all":
                session.coordinated_inputs()
            elif args.operation == "backend":
                session.manifest(verify_bundle=True)
            elif args.operation == "prepare":
                module = load_module(session.repo / "scripts/prepare-manual-release.py")
                module.load_source_package(Path(args.source_package).resolve() if args.source_package else session.release / "source-package")
            elif args.operation in ("frontend", "verify"):
                require(args.sha and SHA.fullmatch(args.sha), "Supply a full --sha.")
                require(sources["frontend"]["revision"] == args.sha, "Frontend checkout and expected SHA differ.")
                clean_sources({"frontend": sources["frontend"]})
            elif args.operation == "edge":
                session.edge_inputs()
            elif args.operation == "package":
                session.package_inputs()
            elif args.manifest:
                session.manifest()
            session.finish("LOCAL_INPUTS_VALIDATED")
            return 0
        if args.operation == "all":
            # Validate all local identities before any backend mutation.
            session.coordinated_inputs()
            session.frontend_source_gate()
            session.backend()
            session.frontend()
        else:
            getattr(session, args.operation)()
        session.finish("SUCCEEDED")
        return 0
    except KeyboardInterrupt:
        if session:
            session.finish("INTERRUPTED", "A detached VM job may continue; reconnect with status.")
        print("Interrupted; use status with the same manifest and release directory if deployment started.", file=sys.stderr)
        return 130
    except Exception as error:
        # Raw provider/process errors can contain credentials; preserve safe own messages only.
        message = str(error) if isinstance(error, ReleaseError) else type(error).__name__ + ": local or service verification failed; inspect protected evidence and inputs."
        if session:
            session.finish("FAILED", message)
        print("STOPPED: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
