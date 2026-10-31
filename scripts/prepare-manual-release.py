#!/usr/bin/env python3
"""Build and qualify a private Smart Factory release on a local ARM64 Docker engine.

This helper never contacts the production VM and never pushes source or images.
--check verifies the source package and local prerequisites. --prepare clones
public baselines, applies the hash-pinned local Git bundles, builds both images,
runs the actual packaged acceptance/rollback/mail tests and vulnerability scan,
and verifies the final seven-file deployment ZIP with deploy-vm.py.

Python 3.9+, Git, Docker Buildx and Docker Compose are required. Use native
Apple Silicon Python + Docker Desktop, or Linux ARM64. The local Docker engine
must use the containerd image store: classic docker-save archives do not contain
the actual OCI manifest required by the deployment verifier.
"""
import argparse
import contextlib
import copy
import datetime
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import time
import uuid
import zipfile


REPOSITORIES = {
    name: "https://github.com/DruHustle/smart-factory-" + name + ".git"
    for name in ("frontend", "backend", "edge")
}
FALLBACK = {
    "frontend": "9baf7022c18d2b52f0f0d02618d72dff52f75ec2",
    "backend": "591dbe921632045645f4404283612fec0b962257",
    "edge": "01ce7bf49ad26e898545a4815e26dca01d0c6206",
}
MEMBERS = {"candidate.tar.gz", "rollback.tar.gz", "archive.sha256", "image.json",
           "rollback-image.json", "result.json", "container-audit.json"}
LABELS = ("org.opencontainers.image.revision", "io.smartfactory.backend.revision",
          "io.smartfactory.edge.revision")
FIXTURE_PROJECT = "smart-factory-bundle-test"
MAX_METADATA = 4 * 1024**2
MIN_FREE_BYTES = 12 * 1024**3
SHA = re.compile(r"[a-f0-9]{40}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
IMAGE_DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
BRANCH = re.compile(r"refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}\Z")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                return digest.hexdigest()
            digest.update(block)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".part")
    require(not temporary.is_symlink(), "Refusing a redirected output file.")
    with open(temporary, "wb") as output:
        os.chmod(temporary, 0o600)
        output.write(json_bytes(value))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def regular_file(path, maximum=None):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), "Expected a regular file: " + path.name)
    require(info.st_size > 0 and (maximum is None or info.st_size <= maximum),
            "File is empty or exceeds its allowed size: " + path.name)
    return path


def private_directory(path):
    if not path.exists():
        path.mkdir(mode=0o700, parents=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700,
            "Use an owned directory with permissions 0700: " + str(path))
    return path


def validate_plan(value):
    require(isinstance(value, dict) and value.get("planVersion") == 1,
            "A version-1 source release plan is required.")
    candidates = value.get("candidate")
    require(isinstance(candidates, dict) and set(candidates) == set(REPOSITORIES),
            "The plan must identify exactly the frontend, backend and edge bundles.")
    for name, source in candidates.items():
        require(isinstance(source, dict) and set(source) == {"sha", "bundleFile", "bundleSha256", "ref"},
                "Unexpected source-package fields for " + name)
        require(isinstance(source["sha"], str) and SHA.fullmatch(source["sha"]),
                "A source revision is not an immutable SHA.")
        require(source["bundleFile"] == name + ".bundle", "Unexpected local bundle filename.")
        require(isinstance(source["bundleSha256"], str) and SHA256.fullmatch(source["bundleSha256"]),
                "A local source bundle needs its exact checksum.")
        ref = source["ref"]
        require(isinstance(ref, str) and BRANCH.fullmatch(ref)
                and all(part and part not in (".", "..") and not part.endswith((".lock", "."))
                        and not part.startswith(".") for part in ref.split("/"))
                and ".." not in ref and "@{" not in ref,
                "The source bundle reference must be a safe branch reference.")
    require(value.get("rollback") == FALLBACK, "The approved public fallback revisions differ.")
    baseline = value.get("baseline")
    require(isinstance(baseline, dict) and isinstance(baseline.get("sources"), dict)
            and set(baseline["sources"]) == set(REPOSITORIES)
            and all(isinstance(v, str) and SHA.fullmatch(v) for v in baseline["sources"].values()),
            "The previously observed production source identities are required.")
    schema = baseline.get("schema", {})
    require(isinstance(schema, dict)
            and re.fullmatch(r"\d{4}_[a-z0-9_]+", str(schema.get("revision", "")))
            and SHA256.fullmatch(str(schema.get("digest", ""))),
            "The previously observed production schema must be pinned.")
    capabilities = baseline.get("capabilities")
    require(isinstance(capabilities, list) and capabilities
            and all(isinstance(v, str) and re.fullmatch(r"[a-z0-9-]+", v) for v in capabilities)
            and len(capabilities) == len(set(capabilities)), "Invalid baseline capabilities.")
    require({name: item["sha"] for name, item in candidates.items()} != baseline["sources"],
            "The candidate must differ from the observed production baseline.")
    return copy.deepcopy(value)


def load_source_package(directory):
    require(directory.is_dir() and not directory.is_symlink(), "Source package must be a real directory.")
    plan_path = regular_file(directory / "release-plan.json", MAX_METADATA)
    plan = validate_plan(json.loads(plan_path.read_text()))
    for source in plan["candidate"].values():
        path = regular_file(directory / source["bundleFile"], 512 * 1024**2)
        require(file_digest(path) == source["bundleSha256"],
                "Local source bundle checksum mismatch: " + path.name)
    return plan, file_digest(plan_path)


def clean_environment(inherited):
    # Do not inherit app/database/mail/cloud credentials, arbitrary build/scanner
    # overrides, Git hooks, Git URL rewrites or an external BuildKit host.
    allowed = {"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM",
               "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
               "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
               "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}
    environment = {key: value for key, value in inherited.items() if key in allowed}
    environment.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_SYSTEM": os.devnull,
                        "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0",
                        "GIT_ASKPASS": "", "PYTHONDONTWRITEBYTECODE": "1",
                        "DOTENV_CONFIG_PATH": os.devnull, "BUILDX_NO_DEFAULT_ATTESTATIONS": "1"})
    return environment


class Commands:
    def __init__(self, work, environment):
        self.work = work
        self.environment = environment
        self.logs = private_directory(work / "logs")
        # A prior run may have left gaps; never reuse or overwrite its logs.
        self.counter = max((int(path.name.split("-", 1)[0]) for path in self.logs.glob("*.log")
                            if path.name.split("-", 1)[0].isdigit()), default=0)

    def run(self, arguments, stage, cwd=None, timeout=180, extra=None, optional=False):
        self.counter += 1
        slug = re.sub(r"[^a-z0-9]+", "-", stage.lower()).strip("-")[:65]
        path = self.logs / (str(self.counter).zfill(3) + "-" + slug + ".log")
        require(not path.exists() and not path.is_symlink(), "Refusing to overwrite an existing command log.")
        environment = dict(self.environment)
        environment.update(extra or {})
        started = time.monotonic()
        print(json.dumps({"status": "RUNNING", "stage": stage, "log": str(path)}), flush=True)
        with open(path, "xb") as output:
            os.chmod(path, 0o600)
            process = subprocess.Popen(arguments, cwd=cwd, env=environment,
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                while True:
                    remaining = timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        raise TimeoutError(stage + " exceeded its bounded execution time.")
                    try:
                        code = process.wait(timeout=min(30, remaining))
                        break
                    except subprocess.TimeoutExpired:
                        print(json.dumps({"status": "RUNNING", "stage": stage,
                                          "elapsedSeconds": int(time.monotonic() - started)}), flush=True)
            except BaseException:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGINT)
                    try:
                        process.wait(timeout=45)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)
                raise
        if code and not optional:
            raise RuntimeError(stage + " failed (exit " + str(code) + "). See " + str(path))
        # Captured command results are metadata only; long build logs stay on disk.
        text = path.read_text(errors="replace") if path.stat().st_size <= 8 * 1024**2 else ""
        return subprocess.CompletedProcess(arguments, code, text, "")


def docker(commands, *arguments, **options):
    return commands.run(["docker", *arguments], options.pop("stage", "Docker " + arguments[0]), **options)


def git(commands, directory, *arguments, **options):
    return commands.run(["git", "-c", "credential.helper=", "-c", "core.hooksPath=" + os.devnull,
                         "-c", "core.autocrlf=false", "-C", str(directory), *arguments],
                        options.pop("stage", "Git " + arguments[0]), **options)


def local_docker_endpoint(commands):
    inherited = commands.environment
    # DOCKER_CONTEXT overrides DOCKER_HOST in Docker itself. Resolve that exact
    # effective context locally before making any daemon request.
    if inherited.get("DOCKER_CONTEXT") or not inherited.get("DOCKER_HOST"):
        arguments = ["context", "inspect"]
        if inherited.get("DOCKER_CONTEXT"):
            arguments.append(inherited["DOCKER_CONTEXT"])
        arguments += ["--format", "{{json .Endpoints.docker.Host}}"]
        endpoint = json.loads(docker(commands, *arguments, stage="Resolve local Docker context").stdout)
    else:
        endpoint = inherited["DOCKER_HOST"]
    require(isinstance(endpoint, str) and endpoint.startswith("unix:///")
            and not any(character in endpoint for character in "\r\n?#"),
            "Use a local Unix-socket Docker engine. Remote/SSH/TCP Docker endpoints are refused before source is sent.")
    inherited.pop("DOCKER_CONTEXT", None)
    inherited.pop("DOCKER_TLS_VERIFY", None)
    inherited.pop("DOCKER_CERT_PATH", None)
    inherited["DOCKER_HOST"] = endpoint
    return endpoint


def fixture_empty(commands):
    for kind, arguments in (
        ("containers", ["ps", "-a", "--format", "{{.Names}}"]),
        ("volumes", ["volume", "ls", "--format", "{{.Name}}"]),
        ("networks", ["network", "ls", "--format", "{{.Name}}"]),
    ):
        names = docker(commands, *arguments, stage="Check existing fixture " + kind).stdout.splitlines()
        require(not any(name == FIXTURE_PROJECT or name.startswith(FIXTURE_PROJECT + "-")
                        or name.startswith(FIXTURE_PROJECT + "_") for name in names),
                "Existing " + FIXTURE_PROJECT + " " + kind + " must be reviewed separately; nothing was removed.")
        label_args = ["ps", "-aq"] if kind == "containers" else [arguments[0], "ls", "-q"]
        matching = docker(commands, *label_args, "--filter", "label=com.docker.compose.project=" + FIXTURE_PROJECT,
                          stage="Check fixture ownership labels for " + kind).stdout.strip()
        require(not matching, "Existing Compose qualification resources were found; nothing was removed.")


def prerequisite_check(commands):
    require(sys.version_info >= (3, 9), "Python 3.9 or newer is required.")
    host = (platform.system(), platform.machine().lower())
    require(host in (("Darwin", "arm64"), ("Linux", "aarch64"), ("Linux", "arm64")),
            "Native Apple Silicon or Linux ARM64 is required; x86 emulation is not qualification.")
    for executable in ("git", "docker"):
        require(shutil.which(executable, path=commands.environment.get("PATH")), executable + " is required.")
    require(shutil.disk_usage(commands.work).free >= MIN_FREE_BYTES,
            "At least 12 GiB of free local working space is required for source and both release archives.")
    commands.run(["git", "--version"], "Git version")
    endpoint = local_docker_endpoint(commands)
    information = json.loads(docker(commands, "info", "--format", "{{json .}}", stage="Local Docker engine").stdout)
    require(information.get("OSType") == "linux" and information.get("Architecture") in ("aarch64", "arm64"),
            "The local Docker engine must be native Linux ARM64.")
    require(information.get("MemTotal", 0) >= 4 * 1024**3,
            "The disposable six-service acceptance stack needs at least 4 GiB allocated to Docker.")
    driver_status = dict(item for item in information.get("DriverStatus", [])
                         if isinstance(item, list) and len(item) == 2)
    require(driver_status.get("driver-type") == "io.containerd.snapshotter.v1",
            "Enable Docker Desktop's containerd image store (or the Linux containerd snapshotter) before preparation. Classic docker-save lacks the required real OCI manifest.")
    compose = docker(commands, "compose", "version", "--short", stage="Docker Compose version").stdout.strip().lstrip("v")
    version = re.match(r"(\d+)\.(\d+)", compose)
    require(version and tuple(map(int, version.groups())) >= (2, 20), "Docker Compose 2.20+ is required locally.")
    docker(commands, "buildx", "version", stage="Docker Buildx version")
    fixture_empty(commands)
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", 3110))
        except OSError:
            raise RuntimeError("Local port 3110 is occupied; the existing service was not changed.") from None
    return {"hostSystem": host[0], "hostArchitecture": host[1], "engineArchitecture": information["Architecture"],
            "dockerVersion": information.get("ServerVersion"), "endpoint": endpoint}


def verify_source_heads(commands, package, plan):
    for name, source in plan["candidate"].items():
        bundle = package / source["bundleFile"]
        heads = commands.run(["git", "bundle", "list-heads", str(bundle)], "Read " + name + " bundle reference").stdout.splitlines()
        require(heads == [source["sha"] + " " + source["ref"]],
                "The local " + name + " bundle must expose only its exact reviewed branch and commit.")


def clean_checkout(commands, directory, expected):
    require(directory.is_dir() and not directory.is_symlink(), "Checkout path is missing or redirected.")
    require(git(commands, directory, "rev-parse", "HEAD", stage="Verify exact checkout identity").stdout.strip() == expected,
            "Checkout does not match the reviewed commit.")
    require(not git(commands, directory, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching",
                    stage="Verify clean checkout").stdout.strip(), "A release checkout contains modified or untracked files.")


def checkout_sources(commands, package, plan):
    candidate_root = private_directory(commands.work / "candidate")
    rollback_root = private_directory(commands.work / "rollback")
    paths = {"candidate": {}, "rollback": {}}
    for name, url in REPOSITORIES.items():
        target, fallback = candidate_root / name, rollback_root / name
        source = plan["candidate"][name]
        if not target.exists():
            commands.run(["git", "-c", "credential.helper=", "-c", "core.hooksPath=" + os.devnull,
                          "-c", "core.autocrlf=false", "clone", "--no-checkout", "--", url, str(target)],
                         "Clone public " + name + " baseline", timeout=900)
            git(commands, target, "bundle", "verify", str(package / source["bundleFile"]),
                stage="Verify " + name + " bundle prerequisites")
            git(commands, target, "fetch", "--no-tags", str(package / source["bundleFile"]),
                source["ref"] + ":refs/remotes/private-review/candidate", stage="Apply local " + name + " bundle")
            git(commands, target, "checkout", "--detach", source["sha"], stage="Checkout reviewed " + name)
        clean_checkout(commands, target, source["sha"])
        require(git(commands, target, "remote", "get-url", "origin").stdout.strip() == url,
                "The checkout's public source URL changed.")
        if not fallback.exists():
            present = git(commands, target, "cat-file", "-e", FALLBACK[name] + "^{commit}", optional=True)
            if present.returncode:
                git(commands, target, "fetch", "--no-tags", "origin", FALLBACK[name], timeout=900,
                    stage="Fetch immutable public fallback " + name)
            git(commands, target, "worktree", "add", "--detach", str(fallback), FALLBACK[name],
                stage="Checkout public fallback " + name)
        clean_checkout(commands, fallback, FALLBACK[name])
        paths["candidate"][name], paths["rollback"][name] = target, fallback
    pins = json.loads((paths["candidate"]["frontend"] / "deploy/qualification-sources.json").read_text())
    require(all(pins.get(name) == plan["candidate"][name]["sha"] for name in ("backend", "edge")),
            "Candidate companion source pins do not match the private release plan.")
    rollback = json.loads((paths["candidate"]["frontend"] / "deploy/rollback-sources.json").read_text())
    require(rollback == FALLBACK, "The actual smoke test's fallback sources differ from the approved plan.")
    return paths


@contextlib.contextmanager
def exclusive_lock(path):
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600, "Preparation lock is not a private owned regular file.")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another manual preparation is using this work directory or the shared smoke fixture.") from None
        yield
    finally:
        os.close(descriptor)


def image_inspection(commands, tag, optional=False):
    result = docker(commands, "image", "inspect", tag, optional=optional, stage="Inspect owned release image")
    if result.returncode:
        return None
    records = json.loads(result.stdout)
    require(isinstance(records, list) and len(records) == 1, "Expected one local image inspection.")
    return records[0]


def validate_image(image, sources):
    require(image.get("Os") == "linux" and image.get("Architecture") == "arm64", "Built image is not Linux ARM64.")
    configuration = image.get("Config") or {}
    user = str(configuration.get("User") or "").split(":", 1)[0]
    require(user not in ("", "root") and not (user.isdecimal() and int(user) == 0),
            "Built image must run as non-root.")
    labels = configuration.get("Labels") or {}
    require(all(labels.get(label) == sources[name] for name, label in zip(REPOSITORIES, LABELS)),
            "Built image source labels differ from the exact reviewed checkouts.")


def oci_identities(archive_path, source_tag, inspected, sources):
    """Read real Docker-save OCI metadata. Never synthesize a manifest digest."""
    metadata, total, names = {}, 0, set()
    with tarfile.open(archive_path, "r|gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in member.name,
                    "Image archive contains an unsafe top-level path.")
            require(member.name not in names, "Image archive contains duplicate entries.")
            names.add(member.name)
            require(member.isdir() or member.isfile(), "Image archive contains a top-level link or special file.")
            if not member.isfile() or not (0 < member.size <= MAX_METADATA):
                continue
            if member.name not in ("index.json", "manifest.json", "oci-layout") and not re.fullmatch(r"blobs/sha256/[a-f0-9]{64}", member.name):
                continue
            stream = archive.extractfile(member)
            prefix = stream.read(min(64, member.size))
            if not prefix.lstrip().startswith((b"{", b"[")):
                continue
            data = prefix + stream.read()
            total += len(data)
            require(total <= 64 * 1024**2, "Image archive metadata exceeds its budget.")
            try:
                value = json.loads(data)
            except (ValueError, UnicodeDecodeError):
                continue
            if member.name.startswith("blobs/sha256/"):
                require(hashlib.sha256(data).hexdigest() == path.name, "An OCI metadata digest is invalid.")
            metadata[member.name] = value
    require(isinstance(metadata.get("oci-layout"), dict)
            and metadata["oci-layout"].get("imageLayoutVersion") == "1.0.0"
            and isinstance(metadata.get("index.json"), dict),
            "Docker-save did not contain a real OCI layout; enable the containerd image store.")
    docker_manifest = metadata.get("manifest.json")
    require(isinstance(docker_manifest, list) and len(docker_manifest) == 1
            and isinstance(docker_manifest[0], dict)
            and docker_manifest[0].get("RepoTags") == [source_tag],
            "Saved image must contain only its unique, owned source tag.")
    config_path = docker_manifest[0].get("Config", "")
    require(isinstance(config_path, str) and re.fullmatch(r"blobs/sha256/[a-f0-9]{64}", config_path),
            "Saved image has no real OCI config identity.")
    config_id = "sha256:" + PurePosixPath(config_path).name
    configuration = metadata.get(config_path)
    require(isinstance(configuration, dict), "OCI image configuration is absent.")
    require(isinstance(metadata["index.json"].get("manifests"), list), "Malformed OCI image index.")
    reachable, pending = set(), list(metadata["index.json"]["manifests"])
    while pending:
        descriptor = pending.pop()
        digest = descriptor.get("digest") if isinstance(descriptor, dict) else None
        require(isinstance(digest, str) and IMAGE_DIGEST.fullmatch(digest), "Invalid OCI index descriptor.")
        if digest in reachable:
            continue
        reachable.add(digest)
        require(len(reachable) <= 64, "OCI index nesting exceeds its budget.")
        record = metadata.get("blobs/sha256/" + digest.split(":", 1)[1])
        require(isinstance(record, dict), "An OCI index metadata record is absent.")
        if "manifests" in record:
            require(isinstance(record["manifests"], list), "Malformed OCI nested index.")
            pending.extend(record["manifests"])
    candidates = []
    for digest in reachable:
        record = metadata["blobs/sha256/" + digest.split(":", 1)[1]]
        if record.get("schemaVersion") == 2 and isinstance(record.get("config"), dict) and record["config"].get("digest") == config_id:
            require(isinstance(record.get("layers"), list) and record["layers"], "OCI manifest has no layer descriptors.")
            for layer in record["layers"]:
                require(isinstance(layer, dict) and IMAGE_DIGEST.fullmatch(str(layer.get("digest", "")))
                        and "blobs/sha256/" + layer["digest"].split(":", 1)[1] in names,
                        "OCI layer descriptor has no matching archive member.")
            candidates.append(digest)
    require(len(candidates) == 1, "Expected exactly one real OCI manifest for the inspected image.")
    manifest_id = candidates[0]
    require(inspected.get("Id") in (config_id, manifest_id), "Docker inspection does not identify the saved OCI image.")
    if inspected.get("Descriptor"):
        require(isinstance(inspected["Descriptor"], dict) and inspected["Descriptor"].get("digest") == manifest_id,
                "Docker image descriptor does not match the saved OCI manifest.")
    validate_image(inspected, sources)
    validate_image({"Os": configuration.get("os"), "Architecture": configuration.get("architecture"),
                    "Config": configuration.get("config")}, sources)
    require(inspected.get("Config", {}).get("Labels") == configuration.get("config", {}).get("Labels"),
            "Saved image labels differ from Docker's inspected labels.")
    return config_id, manifest_id


def load_core(path, candidate):
    regular_file(path, 2 * 1024**2)
    expected = candidate / "scripts/deploy-vm.py"
    require(file_digest(path) == file_digest(regular_file(expected, 2 * 1024**2)),
            "Deployment verifier differs from the exact reviewed candidate source.")
    spec = importlib.util.spec_from_file_location("smart_factory_reviewed_deploy_core", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_images(commands, paths, plan, state, save_state, endpoint):
    builder = "sf-manual-" + state["runId"]
    existing = docker(commands, "buildx", "inspect", builder, optional=True, stage="Check unique local builder")
    require(existing.returncode != 0, "An existing builder has this run's name; it was not changed. Use a new work directory.")
    created = False
    try:
        docker(commands, "buildx", "create", "--name", builder, "--driver", "docker-container", endpoint,
               stage="Create isolated local builder")
        created = True
        docker(commands, "buildx", "inspect", "--bootstrap", builder, stage="Start isolated local builder", timeout=300)
        for role in ("candidate", "rollback"):
            source_ids = ({name: item["sha"] for name, item in plan["candidate"].items()}
                          if role == "candidate" else FALLBACK)
            tag = state["tags"][role]
            existing_image = image_inspection(commands, tag, optional=True)
            if existing_image:
                require(state.get("ownedImages", {}).get(role) == existing_image.get("Id"),
                        "A release image tag already exists without this preparation's matching ownership receipt.")
                validate_image(existing_image, source_ids)
                continue
            frontend = paths[role]["frontend"]
            arguments = ["buildx", "build", "--builder", builder, "--platform", "linux/arm64", "--load",
                         "--provenance=false", "--build-context", "backend=" + str(paths[role]["backend"])]
            for key, name in (("SOURCE_REVISION", "frontend"), ("BACKEND_SOURCE_REVISION", "backend"),
                              ("EDGE_SOURCE_REVISION", "edge")):
                arguments += ["--build-arg", key + "=" + source_ids[name]]
            arguments += ["--file", str(frontend / "deploy/render/Dockerfile"), "--tag", tag, str(frontend)]
            docker(commands, *arguments, stage="Build native ARM64 " + role, timeout=3600)
            built = image_inspection(commands, tag)
            validate_image(built, source_ids)
            state.setdefault("ownedImages", {})[role] = built["Id"]
            save_state("BUILT_" + role.upper())
    finally:
        if created:
            docker(commands, "buildx", "rm", builder, stage="Remove owned temporary builder", timeout=180)


def qualification(commands, candidate, tags, evidence):
    fixture_empty(commands)
    # The repository smoke script owns this previously empty Compose project and
    # removes its containers, volumes and networks in its own finally block.
    commands.run([sys.executable, "scripts/bundle-smoke.py"], "Actual packaged acceptance and fallback tests",
                 cwd=candidate, timeout=2400,
                 extra={"BUNDLE_IMAGE": tags["candidate"], "BUNDLE_ROLLBACK_IMAGE": tags["rollback"],
                        "QUALIFICATION_EVIDENCE_DIR": str(evidence)})
    fixture_empty(commands)
    commands.run([sys.executable, "scripts/audit-container.py", tags["candidate"],
                  "--output", str(evidence / "container-audit.json")],
                 "Audit exact local candidate image", cwd=candidate, timeout=1200)


def export_release(commands, plan, state, evidence, core, prerequisites):
    qualification_result = json.loads(regular_file(evidence / "result.json", MAX_METADATA).read_text())
    runtimes = {"candidate": qualification_result.get("runtime"),
                "rollback": (qualification_result.get("compatibleRollback") or {}).get("runtime")}
    releases = {}
    for role in ("candidate", "rollback"):
        tag = state["tags"][role]
        sources = {name: source["sha"] for name, source in plan["candidate"].items()} if role == "candidate" else FALLBACK
        inspected = image_inspection(commands, tag)
        require(inspected["Id"] == state["ownedImages"][role], "A tested image tag changed before export.")
        validate_image(inspected, sources)
        atomic_json(evidence / ("image.json" if role == "candidate" else "rollback-image.json"), [inspected])
        raw = evidence / (role + ".tar.part")
        archive = evidence / (role + ".tar.gz")
        require(not raw.is_symlink() and not archive.is_symlink(), "Refusing redirected image output.")
        docker(commands, "image", "save", "--output", str(raw), tag, stage="Export tested " + role + " image", timeout=900)
        os.chmod(raw, 0o600)
        with open(raw, "rb") as source, open(archive, "wb") as destination:
            os.chmod(archive, 0o600)
            with gzip.GzipFile(filename="", mode="wb", fileobj=destination, compresslevel=3, mtime=0) as compressor:
                shutil.copyfileobj(source, compressor, 1024 * 1024)
        config_id, manifest_id = oci_identities(archive, tag, inspected, sources)
        raw.unlink()
        runtime = runtimes[role]
        require(isinstance(runtime, dict) and isinstance(runtime.get("schema"), dict), "Qualified runtime evidence is missing.")
        releases[role] = {"sources": dict(sources), "configId": config_id, "manifestId": manifest_id,
                          "archiveSha256": file_digest(archive), "sourceTag": tag,
                          "schema": {key: runtime["schema"].get(key) for key in ("revision", "digest")},
                          "capabilities": runtime.get("capabilities")}
    checksum_path = evidence / "archive.sha256"
    checksum_path.write_text("".join(releases[role]["archiveSha256"] + "  " + role + ".tar.gz\n" for role in releases))
    os.chmod(checksum_path, 0o600)
    output = commands.work / "qualified-arm64-bundle.zip"
    temporary = output.with_name(output.name + ".part")
    require(not temporary.is_symlink() and not output.is_symlink(), "Refusing redirected ZIP output.")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        os.chmod(temporary, 0o600)
        for name in sorted(MEMBERS):
            path = regular_file(evidence / name, 2 * 1024**3 if name.endswith(".tar.gz") else MAX_METADATA)
            archive.write(path, name)
    os.replace(temporary, output)
    manifest = {"manifestVersion": 1, "artifact": {"sha256": file_digest(output), "size": output.stat().st_size,
                "provenance": {"kind": "local-arm64-qualification", "planSha256": state["planSha256"],
                "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "hostSystem": prerequisites["hostSystem"], "hostArchitecture": prerequisites["hostArchitecture"],
                "dockerVersion": prerequisites["dockerVersion"]}},
                "candidate": releases["candidate"], "rollback": releases["rollback"], "baseline": plan["baseline"]}
    core.M = core.validate_manifest(manifest)
    core.verify_bundle(output)
    manifest_path = commands.work / "release-manifest.json"
    atomic_json(manifest_path, manifest)
    return output, manifest_path


def prepare(package, plan, plan_hash, work, core_path, check_only=False):
    state_path = work / "prepare-state.json"
    if state_path.exists() or state_path.is_symlink():
        state = json.loads(regular_file(state_path, MAX_METADATA).read_text())
        require(isinstance(state, dict) and type(state.get("stateVersion")) is int and state["stateVersion"] == 1
                and state.get("planSha256") == plan_hash and re.fullmatch(r"[a-f0-9]{32}", str(state.get("runId", ""))),
                "This work directory belongs to a different or invalid source package.")
        expected_tags = {role: "factory-qualified:" + role + "-" + state["runId"] for role in ("candidate", "rollback")}
        require(state.get("tags") == expected_tags, "The saved unique image tags were changed.")
    else:
        require({path.name for path in work.iterdir()} <= {"prepare.lock"},
                "A new preparation requires an empty work directory; existing unrelated files were not changed.")
        run_id = uuid.uuid4().hex
        state = {"stateVersion": 1, "planSha256": plan_hash, "runId": run_id,
                 "tags": {role: "factory-qualified:" + role + "-" + run_id for role in ("candidate", "rollback")}}
    commands = Commands(work, clean_environment(os.environ))
    def save_state(status):
        state["status"] = status
        state["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        atomic_json(state_path, state)
    try:
        save_state("CHECKING")
        verify_source_heads(commands, package, plan)
        prerequisites = prerequisite_check(commands)
        save_state("PREREQUISITES_PASSED")
        if check_only:
            return {"status": "PREREQUISITES_PASSED", "workDirectory": str(work), "productionAccess": False}
        paths = checkout_sources(commands, package, plan)
        core = load_core(core_path, paths["candidate"]["frontend"])
        save_state("SOURCES_VERIFIED")
        build_images(commands, paths, plan, state, save_state, prerequisites["endpoint"])
        evidence = private_directory(work / "evidence")
        # Do not let an old result file hide an interrupted fresh acceptance run.
        for name in ("result.json", "container-audit.json"):
            path = evidence / name
            if path.exists():
                regular_file(path, MAX_METADATA)
                path.unlink()
        save_state("QUALIFYING")
        qualification(commands, paths["candidate"]["frontend"], state["tags"], evidence)
        save_state("QUALIFIED")
        for role in paths:
            for name in REPOSITORIES:
                expected = plan["candidate"][name]["sha"] if role == "candidate" else FALLBACK[name]
                clean_checkout(commands, paths[role][name], expected)
        bundle, manifest = export_release(commands, plan, state, evidence, core, prerequisites)
        save_state("PREPARED")
        return {"status": "PREPARED", "bundle": str(bundle), "manifest": str(manifest),
                "workDirectory": str(work), "sources": {name: value["sha"] for name, value in plan["candidate"].items()},
                "productionAccess": False, "nativeArm64Qualification": True}
    except BaseException:
        save_state("FAILED")
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-package", required=True, type=Path)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--deploy-core", type=Path, default=Path(__file__).with_name("deploy-vm.py"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Check prerequisites without building or accessing production (default).")
    mode.add_argument("--prepare", action="store_true", help="Build, test, scan and export both native ARM64 images locally.")
    arguments = parser.parse_args(argv)
    os.umask(0o077)
    try:
        package = arguments.source_package.absolute()
        plan, digest = load_source_package(package)
        base = private_directory(Path.home() / ".smart-factory-manual")
        work = private_directory(arguments.work_dir.absolute() if arguments.work_dir else base / digest[:20])
        with exclusive_lock(work / "prepare.lock"), exclusive_lock(base / "fixture.lock"):
            result = prepare(package, plan, digest, work, arguments.deploy_core.absolute(), not arguments.prepare)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "PREPARATION_BLOCKED", "message": str(error), "productionAccess": False}), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(json.dumps({"status": "INTERRUPTED", "productionAccess": False}), file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
