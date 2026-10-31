#!/usr/bin/env python3
"""Review, qualify and manually deploy this exact Smart Factory source package.

  python3 smart_factory_deploy_vm.py --inspect
  python3 smart_factory_deploy_vm.py --check
  python3 smart_factory_deploy_vm.py --prepare
  python3 smart_factory_deploy_vm.py --deploy
  python3 smart_factory_deploy_vm.py --status [--once]

The default, --inspect, only verifies and describes the embedded source package.
--check checks local preparation prerequisites; it never accesses the VM.
--prepare builds and tests both native ARM64 images locally. --deploy reuses a
fully verified local qualification, or prepares it first, before invoking the
manual VM deployment helper. --status only observes the saved deployment job.

Python 3.9+ is required. Preparation needs native Apple Silicon or Linux ARM64,
Git, and a local ARM64 Docker engine with the containerd image store. The VM
helper uses the existing ~/.ssh/id_ed25519 key and strict host-key checking.
No source or image is published. The frontend and gateways are not deployed.
"""
import argparse
import base64
import binascii
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types
import uuid
import zipfile


# The final private deliverable replaces these two literal placeholders once.
PAYLOAD_SHA256 = "__PAYLOAD_SHA256__"
PAYLOAD_BASE64 = "__PAYLOAD_BASE64__"
MAX_PAYLOAD_BYTES = 128 * 1024**2
MAX_EXPANDED_BYTES = 256 * 1024**2
MAX_METADATA_BYTES = 2 * 1024**2
MEMBER_LIMITS = {
    "scripts/deploy-vm.py": MAX_METADATA_BYTES,
    "scripts/prepare-manual-release.py": MAX_METADATA_BYTES,
    "source-package/release-plan.json": MAX_METADATA_BYTES,
    **{"source-package/" + name + ".bundle": 96 * 1024**2
       for name in ("frontend", "backend", "edge")},
}
PACKAGE_DIRECTORIES = {"scripts", "source-package"}
WORK_ENTRIES = {"installer-state.json", "installer.lock", "package", "package.pending",
                "qualification", "verified-release.json", "deployment-manifest.json", "vm-deployment.json"}
FALLBACK = {
    "frontend": "9baf7022c18d2b52f0f0d02618d72dff52f75ec2",
    "backend": "591dbe921632045645f4404283612fec0b962257",
    "edge": "01ce7bf49ad26e898545a4815e26dca01d0c6206",
}
TARGET = {"host": "ubuntu@152.70.22.84", "directory": "/opt/smart-factory-backend",
          "composeProject": "smart-factory-backend",
          "api": "https://api.152-70-22-84.sslip.io",
          "frontend": "https://smart-factory-iot-app.vercel.app"}
SHA40 = re.compile(r"[a-f0-9]{40}\Z")
SHA64 = re.compile(r"[a-f0-9]{64}\Z")


class InstallerError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise InstallerError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        while True:
            block = source.read(1024 * 1024)
            if not block:
                return result.hexdigest()
            result.update(block)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode("utf-8")


def parse_json(data):
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "A release metadata object has duplicate fields.")
            value[key] = item
        return value
    try:
        return json.loads(data, object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError):
        raise InstallerError("A release metadata file is not valid JSON.") from None


def validate_plan(value, members):
    require(isinstance(value, dict) and type(value.get("planVersion")) is int and value["planVersion"] == 1,
            "The embedded release plan must use version 1.")
    candidate = value.get("candidate")
    require(isinstance(candidate, dict) and set(candidate) == set(FALLBACK),
            "The embedded plan must pin all three source repositories.")
    for name, source in candidate.items():
        require(isinstance(source, dict) and set(source) == {"sha", "bundleFile", "bundleSha256", "ref"},
                "The source plan has unexpected fields.")
        require(isinstance(source["sha"], str) and SHA40.fullmatch(source["sha"])
                and source["bundleFile"] == name + ".bundle"
                and isinstance(source["bundleSha256"], str) and SHA64.fullmatch(source["bundleSha256"]),
                "Each source needs an immutable revision and exact local bundle checksum.")
        reference = source["ref"]
        require(isinstance(reference, str) and re.fullmatch(r"refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}", reference)
                and ".." not in reference and "@{" not in reference
                and all(part and part not in (".", "..") and not part.startswith(".")
                        and not part.endswith((".lock", ".")) for part in reference.split("/")),
                "A local source bundle reference is invalid.")
        require(digest(members["source-package/" + source["bundleFile"]]) == source["bundleSha256"],
                "An embedded source bundle checksum differs from the release plan.")
    require(value.get("rollback") == FALLBACK, "The embedded fallback sources differ from the reviewed fallback.")
    baseline = value.get("baseline")
    require(isinstance(baseline, dict) and isinstance(baseline.get("sources"), dict)
            and set(baseline["sources"]) == set(FALLBACK)
            and all(isinstance(item, str) and SHA40.fullmatch(item) for item in baseline["sources"].values()),
            "The observed production baseline must pin all three source revisions.")
    schema, capabilities = baseline.get("schema"), baseline.get("capabilities")
    require(isinstance(schema, dict) and re.fullmatch(r"\d{4}_[a-z0-9_]+", str(schema.get("revision", "")))
            and SHA64.fullmatch(str(schema.get("digest", ""))), "The observed production schema must be pinned.")
    require(isinstance(capabilities, list) and capabilities
            and all(isinstance(item, str) and re.fullmatch(r"[a-z0-9-]+", item) for item in capabilities)
            and len(capabilities) == len(set(capabilities)), "The observed production capabilities are invalid.")
    require({name: source["sha"] for name, source in candidate.items()} != baseline["sources"],
            "The reviewed candidate must differ from the installed baseline.")
    return value


def read_payload(encoded=None, expected_sha=None):
    encoded = PAYLOAD_BASE64 if encoded is None else encoded
    expected_sha = PAYLOAD_SHA256 if expected_sha is None else expected_sha
    require(isinstance(expected_sha, str) and SHA64.fullmatch(expected_sha),
            "This is an unassembled installer template; use the completed private installer.")
    maximum_encoded = 4 * ((MAX_PAYLOAD_BYTES + 2) // 3)
    require(isinstance(encoded, str) and len(encoded) <= maximum_encoded * 2,
            "The embedded source payload exceeds its size limit.")
    compact = "".join(encoded.split())
    require(0 < len(compact) <= maximum_encoded, "The embedded source payload exceeds its size limit.")
    try:
        raw = base64.b64decode(compact, validate=True)
    except (ValueError, binascii.Error):
        raise InstallerError("The embedded source payload is not valid base64.") from None
    require(0 < len(raw) <= MAX_PAYLOAD_BYTES and digest(raw) == expected_sha,
            "The embedded source payload checksum does not match.")
    members = {}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            require(len(entries) == len(MEMBER_LIMITS) and {item.filename for item in entries} == set(MEMBER_LIMITS),
                    "The source payload must contain exactly the six reviewed files with safe names.")
            require(sum(item.file_size for item in entries) <= MAX_EXPANDED_BYTES,
                    "The expanded source payload exceeds its size limit.")
            for entry in entries:
                mode = (entry.external_attr >> 16) & 0xFFFF
                require(not entry.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG)
                        and not entry.flag_bits & 1
                        and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                        "The source payload contains a link, special file or unsupported ZIP entry.")
                require(0 < entry.file_size <= MEMBER_LIMITS[entry.filename],
                        "An embedded source file exceeds its size limit or is empty.")
                with archive.open(entry) as source:
                    data = source.read(MEMBER_LIMITS[entry.filename] + 1)
                require(len(data) == entry.file_size, "An embedded source file has an inconsistent length.")
                members[entry.filename] = data
    except (zipfile.BadZipFile, EOFError, RuntimeError) as error:
        if isinstance(error, InstallerError):
            raise
        raise InstallerError("The embedded source ZIP is damaged or unsupported.") from None
    plan_data = members["source-package/release-plan.json"]
    return {"sha256": expected_sha, "members": members,
            "plan": validate_plan(parse_json(plan_data), members), "planSha256": digest(plan_data)}


def inspect_payload(payload):
    return {"status": "REVIEWED_SOURCE_PACKAGE", "payloadSha256": payload["sha256"],
            "planSha256": payload["planSha256"],
            "candidateSources": {name: source["sha"] for name, source in payload["plan"]["candidate"].items()},
            "fallbackSources": payload["plan"]["rollback"], "observedBaseline": payload["plan"]["baseline"],
            "target": TARGET, "productionAccess": False,
            "qualification": "Run --prepare for the required native ARM64 build, acceptance, rollback and vulnerability checks.",
            "deployment": "Only --deploy starts VM deployment after the qualification gates pass."}


def private_directory(path, create=False):
    # Inspect every existing component before making anything, rather than
    # silently following a symlink through a custom work-directory ancestor.
    for parent in (*reversed(path.parents), path):
        try:
            information = parent.lstat()
        except FileNotFoundError:
            require(create, "A required private working directory does not exist.")
            parent.mkdir(mode=0o700)
            information = parent.lstat()
        require(stat.S_ISDIR(information.st_mode), "A work-directory component is redirected or is not a directory.")
    require(information.st_uid == os.getuid() and stat.S_IMODE(information.st_mode) == 0o700,
            "Use an owned work directory with permissions 0700; existing permissions were not changed.")
    return path


def regular_private(path, maximum=None):
    information = path.lstat()
    require(stat.S_ISREG(information.st_mode) and information.st_uid == os.getuid()
            and stat.S_IMODE(information.st_mode) == 0o600,
            "An installer file is not an owned regular file with permissions 0600.")
    require(maximum is None or information.st_size <= maximum, "An installer metadata file exceeds its size limit.")
    return path


def read_private_json(path):
    return parse_json(regular_private(path, MAX_METADATA_BYTES).read_bytes())


def write_private(path, data, replace=False):
    if replace and (path.exists() or path.is_symlink()):
        regular_private(path)
    temporary = path.with_name(path.name + ".part-" + uuid.uuid4().hex) if replace else path
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if replace:
            os.replace(temporary, path)
    finally:
        if replace and temporary.exists():
            temporary.unlink()


def work_path(payload, override=None):
    return Path(os.path.abspath(os.path.expanduser(str(override)))) if override else Path.home() / ".smart-factory-manual" / payload["sha256"][:20]


def ownership_record(payload):
    return {"stateVersion": 1, "payloadSha256": payload["sha256"], "planSha256": payload["planSha256"],
            "memberSha256": {name: digest(value) for name, value in payload["members"].items()}}


def verify_workspace(base, payload, allow_empty=False):
    private_directory(base)
    entries = {path.name for path in base.iterdir()}
    if not entries and allow_empty:
        return False
    require("installer-state.json" in entries, "This nonempty work directory has no matching installer ownership receipt; nothing was overwritten.")
    require(entries <= WORK_ENTRIES, "This work directory contains unrelated entries; nothing was overwritten.")
    require(read_private_json(base / "installer-state.json") == ownership_record(payload),
            "This work directory belongs to a different source payload; nothing was overwritten.")
    for name in entries:
        if name in ("package", "package.pending", "qualification"):
            private_directory(base / name)
        else:
            regular_private(base / name)
    return True


@contextlib.contextmanager
def workspace_lock(base, payload):
    import fcntl
    private_directory(base, create=True)
    known = verify_workspace(base, payload, allow_empty=True)
    lock = base / "installer.lock"
    descriptor = os.open(str(lock), os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        regular_private(lock)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InstallerError("Another installer is preparing or deploying this source package; use --status to observe an existing deployment.") from None
        if not known:
            # A concurrent first invocation may have completed initialization
            # between the first directory check and our lock acquisition.
            if (base / "installer-state.json").exists():
                verify_workspace(base, payload)
            else:
                require({path.name for path in base.iterdir()} == {"installer.lock"},
                        "The new work directory changed during initialization; nothing was overwritten.")
                write_private(base / "installer-state.json", json_bytes(ownership_record(payload)))
        else:
            verify_workspace(base, payload)
        yield
    finally:
        os.close(descriptor)


def package_inventory(directory):
    private_directory(directory)
    entries = {}
    for path in directory.iterdir():
        require(path.name in PACKAGE_DIRECTORIES, "The extracted package contains unrelated entries; nothing was overwritten.")
        private_directory(path)
        for child in path.iterdir():
            name = path.name + "/" + child.name
            require(name in MEMBER_LIMITS, "The extracted package contains unrelated entries; nothing was overwritten.")
            regular_private(child, MEMBER_LIMITS[name])
            entries[name] = child
    return entries


def verify_package(directory, payload, complete=True):
    entries = package_inventory(directory)
    if complete:
        require(set(entries) == set(MEMBER_LIMITS), "The extracted package is incomplete; no existing file was replaced.")
    for name, path in entries.items():
        expected = payload["members"][name]
        require(path.stat().st_size == len(expected) and file_digest(path) == digest(expected),
                "An extracted package file differs from the embedded source; nothing was overwritten.")
    return entries


def install_package(base, payload):
    package, pending = base / "package", base / "package.pending"
    if package.exists() or package.is_symlink():
        require(not (pending.exists() or pending.is_symlink()), "Both complete and pending package paths exist; review the working directory.")
        verify_package(package, payload)
        return package
    private_directory(pending, create=True)
    existing = verify_package(pending, payload, complete=False)
    for name, data in payload["members"].items():
        if name not in existing:
            path = pending / name
            private_directory(path.parent, create=True)
            write_private(path, data)
    verify_package(pending, payload)
    require(not (package.exists() or package.is_symlink()), "The package destination changed during extraction; nothing was overwritten.")
    pending.rename(package)
    return package


def load_core(package, payload):
    verify_package(package, payload)
    path = package / "scripts/deploy-vm.py"
    module = types.ModuleType("smart_factory_embedded_deploy_core")
    module.__file__ = str(path)
    # The file was checked against the immutable embedded payload. Executing
    # through compile avoids generating __pycache__ inside the sealed package.
    exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    return module


def manifest_for_plan(value, payload, core):
    manifest = core.validate_manifest(value)
    plan = payload["plan"]
    require(manifest["candidate"]["sources"] == {name: source["sha"] for name, source in plan["candidate"].items()}
            and manifest["rollback"]["sources"] == plan["rollback"] and manifest["baseline"] == plan["baseline"],
            "The qualified manifest differs from this exact reviewed source plan.")
    provenance = manifest["artifact"].get("provenance", {})
    require(provenance.get("kind") == "local-arm64-qualification"
            and provenance.get("planSha256") == payload["planSha256"]
            and (provenance.get("hostSystem"), provenance.get("hostArchitecture")) in
            (("Darwin", "arm64"), ("Linux", "aarch64"), ("Linux", "arm64")),
            "The artifact was not qualified natively from this exact local source plan.")
    core.M = manifest
    return manifest


def verification_record(payload, manifest, manifest_data, state, core):
    return {"verificationVersion": 1, "status": "VERIFIED", "payloadSha256": payload["sha256"],
            "planSha256": payload["planSha256"], "manifestFileSha256": digest(manifest_data),
            "manifestSha256": core.manifest_digest(), "artifactSha256": manifest["artifact"]["sha256"],
            "artifactSize": manifest["artifact"]["size"], "runId": state["runId"]}


def verify_qualification(base, package, payload):
    qualification = private_directory(base / "qualification")
    manifest_path = regular_private(qualification / "release-manifest.json", MAX_METADATA_BYTES)
    bundle = regular_private(qualification / "qualified-arm64-bundle.zip")
    state = read_private_json(qualification / "prepare-state.json")
    require(isinstance(state, dict) and type(state.get("stateVersion")) is int and state["stateVersion"] == 1
            and state.get("planSha256") == payload["planSha256"]
            and re.fullmatch(r"[a-f0-9]{32}", str(state.get("runId", ""))),
            "The local preparation receipt belongs to a different or invalid source plan.")
    verified_path = base / "verified-release.json"
    previous = read_private_json(verified_path) if verified_path.exists() or verified_path.is_symlink() else None
    require(state.get("status") == "PREPARED" or (previous and state.get("status") == "PREREQUISITES_PASSED"),
            "Local qualification has not completed successfully; run --prepare and resolve its failures.")
    manifest_data = manifest_path.read_bytes()
    core = load_core(package, payload)
    manifest = manifest_for_plan(parse_json(manifest_data), payload, core)
    expected_tags = {role: "factory-qualified:" + role + "-" + state["runId"] for role in ("candidate", "rollback")}
    require(state.get("tags") == expected_tags and all(manifest[role]["sourceTag"] == tag for role, tag in expected_tags.items()),
            "The tested image tags do not match this preparation's ownership receipt.")
    require(all(state.get("ownedImages", {}).get(role) in (manifest[role]["configId"], manifest[role]["manifestId"])
                for role in ("candidate", "rollback")), "The qualification image identities differ from the owned build receipt.")
    print("Verifying the exact local ARM64 images, acceptance evidence, rollback and vulnerability audit...", flush=True)
    core.verify_bundle(bundle)
    record = verification_record(payload, manifest, manifest_data, state, core)
    if state.get("status") != "PREPARED":
        require(previous == record, "The saved verification does not match the current artifact; run --prepare.")
    if previous != record:
        require(not (base / "vm-deployment.json").exists(), "A deployment receipt already pins a different qualified artifact; use --status.")
        write_private(verified_path, json_bytes(record), replace=verified_path.exists())
    return manifest_path, bundle, record


def child_environment():
    allowed = {"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "SSH_AUTH_SOCK",
               "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
               "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
               "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}
    environment = {key: value for key, value in os.environ.items() if key in allowed}
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def run_child(arguments):
    # No shell interpolation; isolated Python ignores user startup/path hooks.
    # -I ignores PYTHON* variables, so -B must be explicit: preparation imports
    # the verified core and must not create __pycache__ in the sealed package.
    return subprocess.run([sys.executable, "-I", "-B", *map(str, arguments)], env=child_environment(), check=False).returncode


def run_preparation(base, package, prepare=False):
    return run_child([package / "scripts/prepare-manual-release.py", "--source-package", package / "source-package",
                      "--work-dir", base / "qualification", "--deploy-core", package / "scripts/deploy-vm.py",
                      "--prepare" if prepare else "--check"])


def frozen_manifest(base, package, payload):
    path = regular_private(base / "deployment-manifest.json", MAX_METADATA_BYTES)
    record = read_private_json(base / "verified-release.json")
    require(isinstance(record, dict) and type(record.get("verificationVersion")) is int
            and record["verificationVersion"] == 1 and record.get("status") == "VERIFIED"
            and record.get("payloadSha256") == payload["sha256"] and record.get("planSha256") == payload["planSha256"]
            and record.get("manifestFileSha256") == file_digest(path),
            "The retained deployment manifest has no matching source-bound verification receipt.")
    core = load_core(package, payload)
    manifest = manifest_for_plan(read_private_json(path), payload, core)
    require(record.get("manifestSha256") == core.manifest_digest()
            and record.get("artifactSha256") == manifest["artifact"]["sha256"]
            and record.get("artifactSize") == manifest["artifact"]["size"],
            "The retained deployment manifest differs from its verified artifact.")
    receipt = read_private_json(base / "vm-deployment.json")
    require(isinstance(receipt, dict) and receipt.get("manifestSha256") == record["manifestSha256"],
            "The saved VM deployment belongs to a different qualified release.")
    return path


def run_status(base, payload, once=False):
    # A status request requires an existing receipt. It never extracts files,
    # invokes preparation, reads the large image ZIP or requires local Docker.
    verify_workspace(base, payload)
    package = base / "package"
    manifest = frozen_manifest(base, package, payload)
    arguments = [package / "scripts/deploy-vm.py", "--manifest", manifest,
                 "--state", base / "vm-deployment.json", "--status"]
    if once:
        arguments.append("--once")
    return run_child(arguments)


def run_mode(mode, base, package, payload):
    receipt = base / "vm-deployment.json"
    if mode == "check":
        return run_preparation(base, package)
    if mode == "prepare":
        require(not receipt.exists(), "A VM deployment already pins this qualification; use --status instead of rebuilding it.")
        result = run_preparation(base, package, prepare=True)
        if result:
            return result
        manifest, bundle, unused = verify_qualification(base, package, payload)
        print(json.dumps({"status": "VERIFIED", "manifest": str(manifest), "bundle": str(bundle), "productionAccess": False}), flush=True)
        return 0
    require(mode == "deploy", "Unknown installer mode.")
    qualification = base / "qualification"
    artifact_paths = [qualification / "release-manifest.json", qualification / "qualified-arm64-bundle.zip",
                      base / "verified-release.json"]
    present = [path.exists() or path.is_symlink() for path in artifact_paths]
    if not any(present):
        require(not receipt.exists(), "The deployment artifact is unavailable; use --status without rebuilding.")
        result = run_preparation(base, package, prepare=True)
        if result:
            return result
    else:
        require(all(present[:2]), "The previous qualification is incomplete; run --prepare explicitly. No VM access was attempted.")
    manifest, bundle, record = verify_qualification(base, package, payload)
    frozen = base / "deployment-manifest.json"
    if receipt.exists():
        frozen = frozen_manifest(base, package, payload)
        require(file_digest(frozen) == record["manifestFileSha256"], "The saved deployment uses a different artifact; use --status.")
    elif not frozen.exists() or file_digest(regular_private(frozen, MAX_METADATA_BYTES)) != record["manifestFileSha256"]:
        write_private(frozen, manifest.read_bytes(), replace=frozen.exists())
    return run_child([package / "scripts/deploy-vm.py", "--manifest", frozen, "--bundle", bundle,
                      "--state", receipt, "--deploy"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    modes = parser.add_mutually_exclusive_group()
    for name, help_text in (
        ("inspect", "Verify and describe the embedded source package without prerequisites or VM access (default)."),
        ("check", "Check local ARM64 preparation prerequisites; no VM access."),
        ("prepare", "Build, test, scan and verify the exact images locally; no VM access."),
        ("deploy", "Prepare or reuse verified images, then explicitly deploy to the existing VM."),
        ("status", "Observe the saved deployment job without preparing, building or redeploying."),
    ):
        modes.add_argument("--" + name, action="store_const", const=name, dest="mode", help=help_text)
    parser.set_defaults(mode="inspect")
    parser.add_argument("--once", action="store_true", help="With --status, show one snapshot instead of following progress.")
    parser.add_argument("--work-dir", type=Path, help="Use this owned private directory for the package, qualification and deployment receipts.")
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        require(sys.version_info >= (3, 9), "Python 3.9 or newer is required.")
        require(not args.once or args.mode == "status", "--once is available only with --status.")
        payload = read_payload()
        if args.mode == "inspect":
            print(json.dumps(inspect_payload(payload), indent=2), flush=True)
            return 0
        base = work_path(payload, args.work_dir)
        if args.mode == "status":
            return run_status(base, payload, args.once)
        with workspace_lock(base, payload):
            package = install_package(base, payload)
            return run_mode(args.mode, base, package, payload)
    except InstallerError as error:
        print("STOPPED: " + str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. If VM deployment started, use --status with this same installer and work directory.", file=sys.stderr)
        return 130
    except Exception as error:
        # Child tools already provide safe diagnostics. Do not interpolate raw
        # process output, arbitrary file contents or environment values here.
        print("STOPPED: local verification or file access failed (" + type(error).__name__ + "). No further action was started.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
