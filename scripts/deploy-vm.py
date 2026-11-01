#!/usr/bin/env python3
"""Manually qualify and deploy a pinned Smart Factory release to the existing VM.

  python3 deploy-vm.py --check --bundle qualified-arm64-bundle.zip
  python3 deploy-vm.py --deploy --bundle qualified-arm64-bundle.zip
  python3 deploy-vm.py --status

The default is a read-only preflight. Only --deploy starts a detached deployment.
Use --manifest for a reviewed release manifest when none is embedded. Startup
applies the qualified additive migrations. The helper does not seed records,
change accounts, deploy gateways, publish the frontend, or change infrastructure.
Existing configuration and images are retained; application rollback keeps
additive migrations. No database backup is claimed.
"""
import argparse
import contextlib
import copy
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

# Release preparation supplies this only after exact-source native ARM64 qualification.
RELEASE_MANIFEST = None
M = None
HOST = "ubuntu@152.70.22.84"
DEPLOY = Path("/opt/smart-factory-backend")
API_ORIGIN = "https://api.152-70-22-84.sslip.io"
UI_ORIGIN = "https://smart-factory-iot-app.vercel.app"
PROJECT = "smart-factory-backend"
FILE_NAMES = ("compose.yaml", ".env", ".env.api", ".env.worker")
MEMBERS = {"candidate.tar.gz", "rollback.tar.gz", "archive.sha256", "image.json",
           "rollback-image.json", "result.json", "container-audit.json"}
LABELS = ("org.opencontainers.image.revision", "io.smartfactory.backend.revision",
          "io.smartfactory.edge.revision")
REQUIRED_FLAGS = ("sixServicesNonRoot", "migrationsIdempotent", "bootstrapBoundary",
    "individualAuthorization", "nativeSecurityOutbox", "notificationOwnershipAndRestart",
    "coverageUnitsAndScope", "mqttQos0AndQos1", "standaloneSensorTraversal",
    "dependencyFailureRecovery")
ROLLBACK_FLAGS = ("schemaCompatible", "activeViewerPreserved", "revokedAccountStayedRejected",
                  "telemetryIdentitiesPreserved", "industrialObservationsPreserved", "industrialFallbackIngestionVerified")
RECOVERY_FLAGS = ("apiRequestQueued", "workerSmtpAccepted", "emailedLinkOriginAndRouteValidated",
    "administratorDeliveryStatusVerified", "tokenRedeemed", "previousPasswordRejected",
    "previousSessionRejected", "tokenReplayRejected", "newPasswordIdentityVerified")
TERMINAL_STATUSES = {"BACKEND_DEPLOYED", "ROLLED_BACK", "STOPPED_BEFORE_CHANGES", "NEEDS_REVIEW"}



def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest_stream(stream):
    value = hashlib.sha256()
    while True:
        part = stream.read(1024 * 1024)
        if not part:
            return value.hexdigest()
        value.update(part)


def digest_file(path):
    with open(path, "rb") as stream:
        return digest_stream(stream)


def private_regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_uid == os.getuid(), "Expected a private owned regular file: " + path.name)
    return path


def private_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == os.getuid(), "Expected a private owned directory: " + path.name)
    return path


def environment_map(entries):
    values = {}
    for item in entries or []:
        require(isinstance(item, str) and "=" in item, "Unexpected container environment format.")
        key, value = item.split("=", 1)
        values[key] = value
    return values


def csv_count(value):
    return len([item for item in str(value or "").split(",") if item.strip()])


def mail_summary(api, worker):
    raw_provider = str(worker.get("EMAIL_PROVIDER", "resend"))
    provider = raw_provider.strip().lower()
    public_provider = provider if provider in ("smtp", "ses", "resend") else "unsupported"
    api_provider = str(api.get("EMAIL_PROVIDER", "resend")).lower()
    data = {"provider": public_provider, "apiProviderMatchesWorker": api_provider == provider,
            "apiDeliveryFlagPresent": "EMAIL_DELIVERY_CONFIGURED" in api,
            "apiDeliveryFlagEnabled": api.get("EMAIL_DELIVERY_CONFIGURED") == "true",
            "apiWorkerModeEnabled": api.get("BACKEND_DEPLOYMENT_MODE") in ("render-bundle", "compose", "local"),
            "apiResetOriginMatches": api.get("PASSWORD_RESET_ORIGIN") == UI_ORIGIN,
            "workerResetOriginMatches": worker.get("PASSWORD_RESET_ORIGIN") == UI_ORIGIN}
    token_api = str(api.get("DASHBOARD_SERVICE_TOKEN") or "")
    token_worker = str(worker.get("DASHBOARD_SERVICE_TOKEN") or "")
    data["serviceTokenPresentOnBoth"] = bool(token_api and token_worker)
    data["serviceTokensMatch"] = bool(token_api and token_worker) and hmac.compare_digest(
        token_api.encode("utf-8"), token_worker.encode("utf-8"))
    data["serviceTokenLengthValid"] = len(token_api.strip()) >= 32 and len(token_worker.encode("utf-8")) >= 32
    if provider == "smtp":
        try:
            port = int(worker.get("SMTP_PORT", "587"))
        except (TypeError, ValueError):
            port = 587
        data.update(usernamePresent=bool(worker.get("SMTP_USERNAME")),
                    passwordPresent=bool(worker.get("SMTP_PASSWORD")),
                    senderPresent=bool(worker.get("SMTP_FROM")),
                    hostPresent=bool(worker.get("SMTP_HOST", "smtp.gmail.com")),
                    portInRange=1 <= port <= 65535,
                    allowAllRecipients=str(worker.get("SMTP_ALLOW_ALL_RECIPIENTS", "")).lower() == "true",
                    allowedDomainCount=csv_count(worker.get("SMTP_ALLOWED_RECIPIENT_DOMAINS")),
                    allowedRecipientCount=csv_count(worker.get("SMTP_ALLOWED_RECIPIENTS")))
    elif provider == "resend":
        data.update(apiKeyPresent=bool(worker.get("RESEND_API_KEY")),
                    apiKeyPrefixValid=str(worker.get("RESEND_API_KEY", "")).startswith("re_"),
                    senderPresent=bool(worker.get("RESEND_FROM")),
                    allowedDomainCount=csv_count(worker.get("RESEND_ALLOWED_RECIPIENT_DOMAINS")))
    elif provider == "ses":
        data.update(enabled=str(worker.get("SES_ENABLED", "")).lower() == "true",
                    senderPresent=bool(worker.get("SES_FROM")),
                    allowAllRecipients=str(worker.get("SES_ALLOW_ALL_RECIPIENTS", "")).lower() == "true",
                    allowedDomainCount=csv_count(worker.get("SES_ALLOWED_RECIPIENT_DOMAINS")),
                    allowedRecipientCount=csv_count(worker.get("SES_ALLOWED_RECIPIENTS")),
                    awsCredentialChainNotTested=True)
    data["mailDeliveryTested"] = False
    return data


def file_state(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), "Expected a regular deployment file: " + path.name)
    if path.name != "compose.yaml":
        require(stat.S_IMODE(info.st_mode) == 0o600, "Environment file must remain mode 0600: " + path.name)
    return {"sha256": digest_file(path), "mode": stat.S_IMODE(info.st_mode),
            "uid": info.st_uid, "gid": info.st_gid}



def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def write_json_private(path, value, replace=False):
    data = (json.dumps(value, indent=2) + "\n").encode("utf-8")
    if replace:
        temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex[:8])
    else:
        temporary = path
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(str(temporary), str(path))
    finally:
        if replace and temporary.exists():
            temporary.unlink()


def read_private_json(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
            and info.st_uid == os.getuid(), "Expected a private owned record: " + path.name)
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    require(isinstance(value, dict), "Invalid private record: " + path.name)
    return value


@contextlib.contextmanager
def release_lock(directory, blocking=False):
    import fcntl
    lock_path = directory.parent / ".smart-factory-release.lock"
    descriptor = os.open(str(lock_path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.getuid(), "The shared deployment lock must remain private.")
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            raise RuntimeError("Another Smart Factory preparation or deployment is in progress.")
        yield


def patch_env_bytes(original, updates):
    require(isinstance(original, bytes) and b"\x00" not in original,
            "Environment files must be ordinary text without NUL bytes.")
    for key, value in updates.items():
        require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is not None
                and isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9:/._-]+", value) is not None,
                "Only approved plain nonsecret setting values can be patched.")
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    lines = original.splitlines(keepends=True)
    positions = {key: [] for key in updates}
    for index, line in enumerate(lines):
        match = re.match(rb"^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=", line)
        if match:
            key = match.group(1).decode("ascii")
            if key in positions:
                positions[key].append(index)
    for key, value in updates.items():
        require(len(positions[key]) <= 1, "Duplicate target setting requires review: " + key)
        replacement = (key + "=" + value).encode("ascii")
        if positions[key]:
            index = positions[key][0]
            line = lines[index]
            ending = b"\r\n" if line.endswith(b"\r\n") else b"\n" if line.endswith(b"\n") else b""
            lines[index] = replacement + ending
        else:
            if lines and not lines[-1].endswith(b"\n"):
                lines[-1] += newline
            lines.append(replacement + newline)
    return b"".join(lines)


def replace_live_file(path, expected_before_state, content):
    require(file_state(path) == expected_before_state,
            "Deployment file changed before installation: " + path.name)
    require(expected_before_state["uid"] == os.getuid(),
            "The deployment file must be owned by the current operator: " + path.name)
    temporary = path.with_name(path.name + ".release-" + uuid.uuid4().hex[:8])
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchown(stream.fileno(), expected_before_state["uid"], expected_before_state["gid"])
            os.fchmod(stream.fileno(), expected_before_state["mode"])
        require(file_state(path) == expected_before_state,
                "Deployment file changed during installation: " + path.name)
        os.replace(str(temporary), str(path))
        directory_fd = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def effective_environment(image, service):
    result = environment_map(image.get("Config", {}).get("Env", []))
    for key, value in service.get("environment", {}).items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = str(value)
    return result


def without_extensions(value):
    # Only schema-level Compose extension fields are ignored. Labels and
    # environment mappings are opaque data, including any x-* keys they contain.
    result = copy.deepcopy(value)
    if isinstance(result, dict):
        for key in list(result):
            if key.startswith("x-"):
                del result[key]
        services = result.get("services", {})
        if isinstance(services, dict):
            for service in services.values():
                if isinstance(service, dict):
                    for key in list(service):
                        if key.startswith("x-"):
                            del service[key]
    return result


def password_policy_delivery(value):
    if isinstance(value, dict):
        result = value.get("result", {}).get("data", {})
        if isinstance(result, dict):
            return result.get("json", result).get("delivery") if isinstance(result.get("json", result), dict) else None
    return None


class _NoRuntimeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _runtime_http(url, want_json=False):
    try:
        request = urllib.request.Request(url, headers={"Cache-Control": "no-store"})
        with urllib.request.build_opener(_NoRuntimeRedirect()).open(request, timeout=10) as response:
            if response.status != 200:
                return None if want_json else False
            if not want_json:
                return True
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                return None
            return json.loads(body)
    except (OSError, urllib.error.URLError, ValueError):
        return None if want_json else False


def _runtime_exec(container_id, command, input_text=None, timeout=20):
    args = ["sudo", "-n", "docker", "exec"]
    if input_text is not None:
        args.append("-i")
    args.extend(["-w", "/app", container_id])
    args.extend(command)
    try:
        return subprocess.run(args, input=input_text, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _runtime_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        # Docker timestamps may contain nanoseconds; Python 3.8 accepts microseconds.
        value = re.sub(r"(\.\d{6})\d+", r"\1", value)
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.timestamp()
    except (ValueError, OverflowError):
        return None



_WORKER_RECEIPT_SCRIPT = r'''
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
let database;
try {
  const ca = (process.env.DATABASE_CA_CERT ?? "").replace(/\\n/g, "\n");
  if (!process.env.DATABASE_URL || !ca) throw Error("Unavailable");
  database = postgres(process.env.DATABASE_URL, {
    ssl: { ca, rejectUnauthorized: true }, max: 1, connect_timeout: 5,
    idle_timeout: 1, max_lifetime: 15, prepare: false,
    connection: { statement_timeout: 5000, default_transaction_read_only: "on",
                  application_name: "smart-factory-release-check" },
    onnotice: () => {},
  });
  const [row] = await database`SELECT report, received_at FROM runtime_worker_status WHERE worker = 'telemetry'`;
  if (!row || !row.report || typeof row.report !== "object") throw Error("Unavailable");
  const allowed = ["worker", "source", "runtime", "contractVersion", "migrationsDigest",
    "mqttSubscribed", "observedAt", "pending", "quarantined", "failedAttempts",
    "oldestPendingAt", "notificationReady"];
  const receipt = Object.fromEntries(allowed.map(key => [key, row.report[key]]));
  receipt.receivedAt = new Date(row.received_at).toISOString();
  const directory = process.env.TELEMETRY_MIGRATIONS_DIR ?? "/app/telemetry-migrations";
  const names = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (!Array.isArray(names) || !names.length || !names.every(name => typeof name === "string" && /^[A-Za-z0-9_.-]+\.sql$/.test(name))) throw Error("Unavailable");
  const hashes = await Promise.all(names.map(async name => createHash("sha256").update(await readFile(join(directory, name))).digest("hex")));
  const expectedMigrationsDigest = createHash("sha256").update(hashes.join("\n")).digest("hex");
  process.stdout.write(JSON.stringify({ receipt, expectedMigrationsDigest }) + "\n");
} catch {
  process.stderr.write("Worker receipt verification unavailable.\n");
  process.exitCode = 1;
} finally {
  if (database) await database.end({ timeout: 3 });
}
'''


def sources(release):
    return tuple(release["sources"][key] for key in ("frontend", "backend", "edge"))


def validate_manifest(value):
    require(isinstance(value, dict) and value.get("manifestVersion") == 1,
            "A reviewed version-1 release manifest is required; no release is embedded yet.")
    artifact = value.get("artifact", {})
    require(re.fullmatch(r"[a-f0-9]{64}", str(artifact.get("sha256", ""))) is not None
            and type(artifact.get("size")) is int and 0 < artifact["size"] <= 2 * 1024**3,
            "The manifest must pin the exact qualified ZIP checksum and size.")
    provenance = artifact.get("provenance", {})
    require(isinstance(provenance, dict) and provenance.get("kind") in
            ("local-arm64-qualification", "github-arm64-qualification"),
            "The manifest must identify how the native ARM64 artifact was qualified.")
    if provenance["kind"] == "github-arm64-qualification":
        for key in ("workflowRunId", "artifactId"):
            require(type(provenance.get(key)) is int and provenance[key] > 0,
                    "GitHub qualification must identify its exact run and artifact.")
    for role in ("candidate", "rollback", "baseline"):
        release = value.get(role, {})
        require(isinstance(release, dict) and isinstance(release.get("sources"), dict)
                and set(release["sources"]) == {"frontend", "backend", "edge"},
                "Every release role must pin all three source revisions.")
        require(all(isinstance(item, str) and re.fullmatch(r"[a-f0-9]{40}", item)
                    for item in sources(release)), "Invalid immutable source revision.")
        schema = release.get("schema", {})
        require(isinstance(schema, dict)
                and re.fullmatch(r"\d{4}_[a-z0-9_]+", str(schema.get("revision", "")))
                and re.fullmatch(r"[a-f0-9]{64}", str(schema.get("digest", ""))),
                "Every release role must pin its exact migration revision and digest.")
        capabilities = release.get("capabilities")
        require(isinstance(capabilities, list) and capabilities
                and all(isinstance(item, str) and re.fullmatch(r"[a-z0-9-]+", item) for item in capabilities)
                and len(capabilities) == len(set(capabilities)), "Invalid required capability list.")
        if role != "baseline":
            source_tag = release.get("sourceTag")
            require(isinstance(source_tag, str) and re.fullmatch(
                r"factory-qualified:" + role + r"(?:-[a-zA-Z0-9_.-]{1,80})?", source_tag),
                "Each image must identify its exact isolated qualification tag.")
            for key in ("configId", "manifestId"):
                require(re.fullmatch(r"sha256:[a-f0-9]{64}", str(release.get(key, ""))),
                        "Candidate and rollback must pin config and OCI manifest digests.")
            require(re.fullmatch(r"[a-f0-9]{64}", str(release.get("archiveSha256", ""))),
                    "Candidate and rollback archive checksums must be independently pinned.")
            require({"password-reset-v1", "account-requests-v1", "account-role-approval-v1",
                     "industrial-connectivity-v1", "published-passports-v1"}.issubset(capabilities),
                    "Candidate and fallback must preserve account, passport and industrial capabilities.")
    require(sources(value["candidate"]) != sources(value["baseline"]),
            "The candidate must differ from the reviewed installed baseline.")
    return copy.deepcopy(value)


def manifest_digest():
    return hash_bytes(json.dumps(M, sort_keys=True, separators=(",", ":")).encode())


def runtime_matches(value, release, require_worker=False, extra_capabilities=()):
    if not isinstance(value, dict):
        return False
    if tuple(value.get(key) for key in ("source", "backendSource", "edgeSource")) != sources(release):
        return False
    if value.get("contractVersion") != 2 or value.get("deployment") != "bundle" or value.get("versioned") is not True:
        return False
    schema = value.get("schema")
    if not isinstance(schema, dict) or schema.get("ready") is not True:
        return False
    if any(schema.get(key) != release["schema"][key] for key in ("revision", "digest")):
        return False
    capabilities = value.get("capabilities")
    if not isinstance(capabilities, list) or not all(isinstance(item, str) for item in capabilities):
        return False
    if not (set(release["capabilities"]) | set(extra_capabilities)).issubset(capabilities):
        return False
    worker = value.get("worker")
    return not require_worker or (isinstance(worker, dict) and worker.get("fresh") is True
                                  and worker.get("compatible") is True)


def check_image(image, release, loaded=False):
    require(isinstance(image, dict), "Image inspection is missing.")
    identities = (release["configId"], release["manifestId"])
    require(image.get("Id") in identities, "Image digest does not match the qualified release.")
    require(image.get("Os") == "linux" and image.get("Architecture") == "arm64",
            "The qualified image must be Linux ARM64.")
    configuration = image.get("Config") or {}
    user = str(configuration.get("User") or "").split(":", 1)[0]
    require(user not in ("", "root") and not (user.isdecimal() and int(user) == 0),
            "The qualified image must run as a non-root user.")
    labels = configuration.get("Labels") or {}
    require(all(labels.get(key) == expected for key, expected in zip(LABELS, sources(release))),
            "An immutable image source label differs from qualification.")
    descriptor = image.get("Descriptor") or {}
    if descriptor:
        require(descriptor.get("digest") == release["manifestId"],
                "Loaded image descriptor differs from the verified OCI manifest.")
    return image["Id"]


def verify_oci_archive(stream, release):
    """Read top-level OCI metadata without extracting any container filesystem."""
    wanted = {release[key].split(":", 1)[1]: key for key in ("configId", "manifestId")}
    found = {}
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for item in archive:
            path = PurePosixPath(item.name)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in item.name,
                    "Image archive contains an unsafe top-level path.")
            name = path.name.removesuffix(".json")
            if name not in wanted:
                continue
            require(item.isfile() and 0 < item.size <= 4 * 1024**2 and name not in found,
                    "Image archive metadata is duplicate or invalid.")
            data = archive.extractfile(item).read()
            require(hash_bytes(data) == name, "Image archive metadata digest differs.")
            found[name] = json.loads(data)
    require(set(found) == set(wanted), "The archive does not contain both pinned OCI identity records.")
    configuration = found[release["configId"].split(":", 1)[1]]
    manifest = found[release["manifestId"].split(":", 1)[1]]
    require(manifest.get("config", {}).get("digest") == release["configId"],
            "OCI manifest points at an unexpected image configuration.")
    check_image({"Id": release["configId"], "Os": configuration.get("os"),
                 "Architecture": configuration.get("architecture"), "Config": configuration.get("config")}, release)


def verify_bundle(path, extraction=None):
    require(path.is_file() and not path.is_symlink(), "The qualified ZIP must be a regular file.")
    require(path.stat().st_size == M["artifact"]["size"] and digest_file(path) == M["artifact"]["sha256"],
            "The ZIP differs from the exact qualified checksum or size.")
    with zipfile.ZipFile(path) as archive:
        require(len(archive.namelist()) == len(MEMBERS) and set(archive.namelist()) == MEMBERS,
                "The qualification ZIP contains unexpected, duplicate or missing files.")
        for item in archive.infolist():
            mode = item.external_attr >> 16
            require(not item.is_dir() and not stat.S_ISLNK(mode)
                    and stat.S_IFMT(mode) in (0, stat.S_IFREG) and not item.flag_bits & 1,
                    "The qualification ZIP contains a link or unsupported entry.")
            require(0 < item.file_size <= (2 * 1024**3 if item.filename.endswith(".tar.gz") else 4 * 1024**2),
                    "The qualification ZIP contains an oversized or empty entry.")
        checksums = {}
        for line in archive.read("archive.sha256").decode().splitlines():
            fields = line.split()
            require(len(fields) == 2 and re.fullmatch(r"[a-f0-9]{64}", fields[0]),
                    "Image archive checksum record is invalid.")
            path_in_record = PurePosixPath(fields[1].lstrip("*"))
            require(not path_in_record.is_absolute() and ".." not in path_in_record.parts,
                    "Image archive checksum path is invalid.")
            name = path_in_record.name
            require(name in ("candidate.tar.gz", "rollback.tar.gz") and name not in checksums,
                    "Image archive checksum record is unexpected or duplicated.")
            checksums[name] = fields[0]
        require(set(checksums) == {"candidate.tar.gz", "rollback.tar.gz"},
                "Candidate and rollback archive checksums are both required.")
        for role in ("candidate", "rollback"):
            release, name = M[role], role + ".tar.gz"
            require(checksums[name] == release["archiveSha256"], "Image archive checksum differs from the release manifest.")
            with archive.open(name) as stream:
                require(digest_stream(stream) == checksums[name], "Image archive bytes do not match their checksum.")
            with archive.open(name) as stream:
                verify_oci_archive(stream, release)
            records = json.loads(archive.read("image.json" if role == "candidate" else "rollback-image.json"))
            require(isinstance(records, list) and len(records) == 1, "Expected one image inspection per release role.")
            check_image(records[0], release)
        qualification = json.loads(archive.read("result.json"))
        require(isinstance(qualification, dict), "Qualification evidence is missing.")
        require(qualification.get("image", {}).get("id") in (M["candidate"]["configId"], M["candidate"]["manifestId"]),
                "Qualification does not identify the exact candidate image.")
        for key in REQUIRED_FLAGS:
            require(qualification.get(key) is True, "Required qualification failed or missing: " + key)
        fallback = qualification.get("compatibleRollback", {})
        require(fallback.get("qualifiedPriorImage") == M["rollback"]["sourceTag"]
                and fallback.get("restoredCandidateImage") == M["candidate"]["sourceTag"],
                "Fallback qualification used different image references from this artifact.")
        for key in ROLLBACK_FLAGS:
            require(fallback.get(key) is True, "Required fallback qualification failed or missing: " + key)
        require(type(fallback.get("industrialObservationCount")) is int and fallback["industrialObservationCount"] == 3,
                "Fallback qualification must retain all three industrial observations across rollback and roll-forward.")
        recovery = qualification.get("packagedPasswordRecovery", {})
        for key in RECOVERY_FLAGS:
            require(recovery.get(key) is True, "Required packaged recovery qualification failed or missing: " + key)
        require(runtime_matches(qualification.get("runtime"), M["candidate"], True),
                "The qualified candidate runtime differs from the release manifest.")
        require(runtime_matches(fallback.get("runtime"), M["rollback"], True),
                "The qualified fallback runtime differs from the release manifest.")
        audit = json.loads(archive.read("container-audit.json"))
        require(isinstance(audit, dict) and isinstance(audit.get("Results"), list) and audit["Results"],
                "Container vulnerability audit is missing or empty.")
        audit_id = (audit.get("Metadata") or {}).get("ImageID")
        require(audit_id in (M["candidate"]["configId"], M["candidate"]["manifestId"]),
                "Container audit does not identify the qualified candidate image.")
        for target in audit["Results"]:
            require(isinstance(target, dict) and not any(
                str(item.get("Severity", "")).upper() in ("HIGH", "CRITICAL")
                for item in (target.get("Vulnerabilities") or [])),
                "Container audit contains a high or critical vulnerability.")
        if extraction is not None:
            extraction.mkdir(mode=0o700)
            for name in sorted(MEMBERS):
                descriptor = os.open(str(extraction / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with archive.open(name) as source, os.fdopen(descriptor, "wb") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
    return checksums


def run_command(arguments, label, cwd=None, optional=False, timeout=180, input_text=None):
    try:
        result = subprocess.run(arguments, cwd=str(cwd) if cwd else None, input=input_text,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(label + " exceeded its timeout; no command output was disclosed.") from None
    if result.returncode and not optional:
        raise RuntimeError(label + " failed (exit " + str(result.returncode) + "); no environment values were disclosed.")
    return result


def docker(*arguments, **options):
    label = "Docker " + (" ".join(arguments[:2]) if arguments and arguments[0] == "image" else str(arguments[0]))
    return run_command(["sudo", "-n", "docker", *arguments], label, **options)


def inspect_image(reference, optional=False):
    result = docker("image", "inspect", reference, optional=optional)
    if result.returncode:
        require(optional and re.search(r"(?im)^(?:Error response from daemon:|Error:) No such image:", result.stderr),
                "Docker image inspection failed; no command output was disclosed.")
        return None
    records = json.loads(result.stdout)
    require(isinstance(records, list) and len(records) == 1 and isinstance(records[0], dict),
            "Docker image inspection returned an unexpected result.")
    return records[0]


def compose(*arguments, root=None, **options):
    root = root or DEPLOY
    return docker("compose", "--project-directory", str(root), "--env-file", str(root / ".env"),
                  "-f", str(root / "compose.yaml"), "-p", PROJECT, "--profile", "worker",
                  *arguments, cwd=root, **options)


def compose_configuration(root=None):
    configuration = json.loads(compose("config", "--format", "json", root=root).stdout)
    require(set(configuration.get("services", {})) == {"api", "worker"},
            "The deployment must contain exactly the existing API and singleton worker services.")
    return configuration


def deployment_container(service, expected_image=None, running=None):
    require(service in ("api", "worker"), "Unexpected deployment service.")
    ids = docker("ps", "-a", "--filter", "label=com.docker.compose.project=" + PROJECT,
                 "--filter", "label=com.docker.compose.service=" + service, "-q").stdout.split()
    require(len(ids) == 1, "Expected exactly one " + service + " container; no service was guessed.")
    records = json.loads(docker("inspect", ids[0]).stdout)
    require(isinstance(records, list) and len(records) == 1, "Unexpected container inspection.")
    item = records[0]
    labels = item.get("Config", {}).get("Labels", {}) or {}
    require(labels.get("com.docker.compose.project") == PROJECT
            and labels.get("com.docker.compose.service") == service
            and labels.get("com.docker.compose.project.config_files") == str(DEPLOY / "compose.yaml")
            and labels.get("com.docker.compose.project.working_dir") == str(DEPLOY),
            "Container Compose identity differs from the existing deployment.")
    if expected_image is not None:
        require(item.get("Image") == expected_image, "The " + service + " image changed unexpectedly.")
    if running is not None:
        require(item.get("State", {}).get("Running") is running,
                "The " + service + " running state is unexpected.")
    return item


def assert_no_other_worker(worker_id):
    ids = docker("ps", "--filter", "label=io.smartfactory.backend.revision", "-q").stdout.split()
    for container_id in ids:
        records = json.loads(docker("inspect", container_id).stdout)
        require(len(records) == 1, "Unexpected Smart Factory container inspection.")
        item = records[0]
        role = environment_map(item.get("Config", {}).get("Env", [])).get("RENDER_SERVICE_ROLE")
        if role != "web":
            require(item.get("Id") == worker_id,
                    "Another Smart Factory worker or combined bundle is running; resolve the singleton consumer first.")


def public_json(url):
    value = _runtime_http(url, True)
    require(isinstance(value, dict), "A required release/readiness endpoint did not return valid JSON.")
    return value


def frontend_snapshot():
    value = public_json(UI_ORIGIN + "/release.json")
    require(value.get("application") == "Smart Factory" and value.get("contractVersion") == 2
            and re.fullmatch(r"[a-f0-9]{40}", str(value.get("source", ""))),
            "The published frontend release identity is invalid.")
    required = value.get("requiredCapabilities")
    require(isinstance(required, list) and required and all(isinstance(item, str) for item in required),
            "The published frontend lacks its capability manifest.")
    for role in ("candidate", "rollback"):
        require(set(required).issubset(M[role]["capabilities"]),
                "The " + role + " cannot serve the currently published frontend.")
    return {key: value.get(key) for key in ("application", "source", "contractVersion", "requiredCapabilities", "builtAt")}


def mail_configuration_plan(api, worker):
    summary = mail_summary(api, worker)
    for key in ("serviceTokenPresentOnBoth", "serviceTokensMatch", "serviceTokenLengthValid", "apiWorkerModeEnabled"):
        require(summary.get(key) is True, "Existing worker/service-token configuration failed: " + key)
    require(summary["provider"] in ("smtp", "resend", "ses") and summary["apiProviderMatchesWorker"],
            "Existing API and worker email providers must agree; this helper will not replace a provider.")
    provider = summary["provider"]
    policy = summary.get("allowAllRecipients", False) or summary.get("allowedDomainCount", 0) > 0 or summary.get("allowedRecipientCount", 0) > 0
    if provider == "smtp":
        configured = all(summary.get(key) is True for key in
                         ("usernamePresent", "passwordPresent", "senderPresent", "hostPresent", "portInRange")) and policy
    elif provider == "resend":
        configured = all(summary.get(key) is True for key in ("apiKeyPresent", "apiKeyPrefixValid", "senderPresent")) and policy
    else:
        configured = summary.get("enabled") is True and summary.get("senderPresent") is True and policy
    for environment in (api, worker):
        require(not environment.get("PASSWORD_RESET_ORIGIN") or environment["PASSWORD_RESET_ORIGIN"] == UI_ORIGIN,
                "An existing password-reset origin differs; review it before deployment.")
    api_updates = {"EMAIL_DELIVERY_CONFIGURED": "true" if configured else "false"}
    worker_updates = {}
    if not api.get("PASSWORD_RESET_ORIGIN"):
        api_updates["PASSWORD_RESET_ORIGIN"] = UI_ORIGIN
    if not worker.get("PASSWORD_RESET_ORIGIN"):
        worker_updates["PASSWORD_RESET_ORIGIN"] = UI_ORIGIN
    summary["providerConfigurationPresent"] = bool(configured)
    summary["expectedResetPolicy"] = "email" if configured else "administrator"
    return api_updates, worker_updates, summary


def snapshot_current():
    require(os.uname().machine == "aarch64", "Expected the existing Linux ARM64 VM.")
    require(DEPLOY.resolve(strict=True) == DEPLOY and DEPLOY.is_dir(), "The deployment directory is missing or redirected.")
    require(shutil.disk_usage(DEPLOY).free >= 6 * 1024**3, "At least 6 GiB free disk space is required to retain verified release images.")
    endpoint = json.loads(docker("context", "inspect", "--format", "{{json .Endpoints.docker.Host}}").stdout)
    require(endpoint == "unix:///var/run/docker.sock", "Docker must address this VM's existing local daemon.")
    version = compose("version", "--short").stdout.strip().lstrip("v")
    match = re.match(r"(\d+)\.(\d+)", version)
    require(match and tuple(map(int, match.groups())) >= (2, 30), "Docker Compose 2.30 or newer is required for raw environment files.")
    files = {name: file_state(DEPLOY / name) for name in FILE_NAMES}
    require(all(value["uid"] == os.getuid() for value in files.values()),
            "The current operator must own all existing deployment files.")
    groups = set(os.getgroups()) | {os.getegid()}
    require(all(value["gid"] in groups for value in files.values()),
            "The current operator must be able to preserve the existing deployment file groups.")
    items = {role: deployment_container(role, running=True) for role in ("api", "worker")}
    require(items["api"]["Image"] == items["worker"]["Image"], "Existing API and worker images differ.")
    require(all(item.get("State", {}).get("Health", {}).get("Status") == "healthy" for item in items.values()),
            "Both existing services must be healthy before deployment.")
    assert_no_other_worker(items["worker"]["Id"])
    image = inspect_image(items["api"]["Image"])
    labels = image.get("Config", {}).get("Labels", {}) or {}
    require(all(labels.get(key) == expected for key, expected in zip(LABELS, sources(M["baseline"]))),
            "The installed image sources differ from the reviewed baseline.")
    require(image.get("Os") == "linux" and image.get("Architecture") == "arm64", "Existing image architecture differs.")
    configuration = compose_configuration()
    environments = {}
    for role in ("api", "worker"):
        require(inspect_image(configuration["services"][role]["image"])["Id"] == items[role]["Image"],
                "On-disk and running image references differ; inspect pending changes first.")
        environments[role] = environment_map(items[role].get("Config", {}).get("Env", []))
        require(environments[role] == effective_environment(image, configuration["services"][role]),
                "On-disk and running environment values differ; inspect pending changes first.")
    runtime = public_json(API_ORIGIN + "/api/runtime/contract")
    local_runtime = public_json("http://127.0.0.1:10000/api/runtime/contract")
    require(runtime_matches(runtime, M["baseline"], True) and runtime_matches(local_runtime, M["baseline"], True),
            "The installed API/worker baseline is not the exact reviewed healthy release.")
    front = frontend_snapshot()
    api_updates, worker_updates, mail = mail_configuration_plan(environments["api"], environments["worker"])
    containers = {role: {"id": item["Id"], "image": item["Image"]} for role, item in items.items()}
    return {"files": files, "containers": containers, "currentImageId": image["Id"],
            "frontendBefore": front, "runtimeBefore": runtime, "configuration": configuration,
            "environments": environments, "mail": mail, "apiUpdates": api_updates, "workerUpdates": worker_updates}


def safe_snapshot(snapshot):
    return {key: snapshot[key] for key in ("files", "containers", "currentImageId", "frontendBefore", "runtimeBefore", "mail")}


def remote_check():
    snapshot = snapshot_current()
    return {"status": "PREFLIGHT_PASSED", "manifestSha256": manifest_digest(),
            "baselineSources": M["baseline"]["sources"], "candidateSources": M["candidate"]["sources"],
            "fallbackSources": M["rollback"]["sources"], "frontendSource": snapshot["frontendBefore"]["source"],
            "mailConfigurationPresence": snapshot["mail"], "changed": False,
            "plannedSettings": {".env": ["BACKEND_IMAGE"], ".env.api": list(snapshot["apiUpdates"]),
                                ".env.worker": list(snapshot["workerUpdates"])},
            "databaseBackupCreated": False, "productionAccountVerified": False}



class RuntimeChecks:
    API_TIMEOUT = 1500
    WORKER_TIMEOUT = 900
    POLL_INTERVAL = 5
    PROGRESS_INTERVAL = 30

    def __init__(self, progress_callback, baseline_capabilities=None):
        self.progress = progress_callback
        self.baseline_capabilities = baseline_capabilities
        self._api_id = None

    def _contract_ok(self, value, candidate, require_worker=False):
        return runtime_matches(value, M["candidate" if candidate else "rollback"], require_worker,
                               self.baseline_capabilities or ())

    def processes_ready(self, container_id, role):
        active = {"api", "device", "identity", "analytics"} if role == "api" else {"telemetry", "notification"}
        if role not in ("api", "worker"):
            return False
        all_programs = {"api", "device", "identity", "analytics", "telemetry", "notification"}
        result = _runtime_exec(container_id, ["supervisorctl", "-c", "/app/deploy/render/supervisord.conf", "status"])
        if result is None:
            return False
        # Inactive programs legitimately make some Supervisor versions exit nonzero.
        statuses = {}
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) < 2 or parts[0] in statuses:
                return False
            statuses[parts[0]] = parts[1]
        return set(statuses) == all_programs and all(statuses[name] == ("RUNNING" if name in active else "STOPPED") for name in all_programs)

    def notification_ready(self, container_id):
        result = _runtime_exec(container_id, ["curl", "--silent", "--show-error", "--max-time", "10",
                               "--output", "/dev/null", "--write-out", "%{http_code}",
                               "http://127.0.0.1:3106/health/ready"], timeout=15)
        return result is not None and result.returncode == 0 and result.stdout.strip() == "200"

    def _stable_running(self, item, service):
        require(item.get("State", {}).get("Running") is True,
                        "The new " + service + " container stopped before readiness.")
        require(item.get("RestartCount", 0) == 0,
                        "The new " + service + " container restarted before readiness; inspect protected diagnostics.")

    def _contracts(self, candidate, require_worker=False):
        if not _runtime_http("http://127.0.0.1:10000/health/ready"):
            return None, "Waiting for local API readiness."
        if not _runtime_http(API_ORIGIN + "/health/ready"):
            return None, "Waiting for public API readiness."
        local = _runtime_http("http://127.0.0.1:10000/api/runtime/contract", True)
        public = _runtime_http(API_ORIGIN + "/api/runtime/contract", True)
        if not self._contract_ok(local, candidate, require_worker) or not self._contract_ok(public, candidate, require_worker):
            return None, "Waiting for the exact runtime sources, schema and required capabilities."
        return public, "Runtime contract verified."

    def wait_api(self, expected_image, candidate=True):
        deadline = time.monotonic() + self.API_TIMEOUT
        last_progress = float("-inf")
        reason = "Waiting for dashboard and device migrations, API processes and readiness."
        container_id = None
        while time.monotonic() < deadline:
            now = time.monotonic()
            if now - last_progress >= self.PROGRESS_INTERVAL:
                self.progress("api_starting", reason)
                last_progress = now
            item = deployment_container("api", expected_image)
            self._stable_running(item, "api")
            if container_id is None:
                container_id = item["Id"]
            require(item["Id"] == container_id, "The API container changed during readiness verification.")
            if self.processes_ready(container_id, "api"):
                contract, reason = self._contracts(candidate)
                if contract is not None:
                    self._api_id = container_id
                    self.progress("api_ready", "API processes, readiness, sources and schema verified.")
                    return contract
            else:
                reason = "Waiting for dashboard and device migrations and all four API processes."
            time.sleep(min(self.POLL_INTERVAL, max(0, deadline - time.monotonic())))
        raise RuntimeError("API readiness timed out after {} seconds. {}".format(self.API_TIMEOUT, reason))

    def _receipt(self, api_id, worker_started_at, candidate):
        result = _runtime_exec(api_id, ["node", "--input-type=module"], _WORKER_RECEIPT_SCRIPT, timeout=20)
        if result is None or result.returncode or len(result.stdout) > 65536:
            return None
        try:
            evidence = json.loads(result.stdout)
        except ValueError:
            return None
        if not isinstance(evidence, dict):
            return None
        receipt = evidence.get("receipt")
        digest = evidence.get("expectedMigrationsDigest")
        if not isinstance(receipt, dict) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            return None
        expected_source = M["candidate" if candidate else "rollback"]["sources"]["backend"]
        if receipt.get("worker") != "telemetry" or receipt.get("source") != expected_source or receipt.get("contractVersion") != 2:
            return None
        if receipt.get("migrationsDigest") != digest or receipt.get("mqttSubscribed") is not True or receipt.get("notificationReady") is not True:
            return None
        observed = _runtime_timestamp(receipt.get("observedAt"))
        received = _runtime_timestamp(receipt.get("receivedAt"))
        started = _runtime_timestamp(worker_started_at)
        now = time.time()
        if any(stamp is None for stamp in (observed, received, started)):
            return None
        if not (0 <= now - observed < 90 and 0 <= now - received < 90 and observed >= started and received >= started):
            return None
        if any(type(receipt.get(name)) is not int or not 0 <= receipt[name] <= 2147483647 for name in ("pending", "quarantined", "failedAttempts")):
            return None
        # Never return unexpected database/report keys, even under a mocked probe.
        keys = ("worker", "source", "runtime", "contractVersion", "migrationsDigest", "mqttSubscribed",
                "observedAt", "receivedAt", "pending", "quarantined", "failedAttempts",
                "oldestPendingAt", "notificationReady")
        return {key: receipt.get(key) for key in keys}

    def wait_worker(self, expected_image, candidate=True):
        deadline = time.monotonic() + self.WORKER_TIMEOUT
        last_progress = float("-inf")
        reason = "Waiting for telemetry migrations, MQTT subscription and notification readiness."
        worker_id = None
        api_id = self._api_id
        while time.monotonic() < deadline:
            now = time.monotonic()
            if now - last_progress >= self.PROGRESS_INTERVAL:
                self.progress("worker_starting", reason)
                last_progress = now
            api = deployment_container("api", expected_image)
            worker = deployment_container("worker", expected_image)
            self._stable_running(api, "api")
            self._stable_running(worker, "worker")
            assert_no_other_worker(worker["Id"])
            api_id = api_id or api["Id"]
            worker_id = worker_id or worker["Id"]
            require(api["Id"] == api_id and worker["Id"] == worker_id,
                            "A container changed during worker readiness verification.")
            if not self.processes_ready(worker_id, "worker"):
                reason = "Waiting for telemetry migrations and both worker processes."
            elif not self.processes_ready(api_id, "api"):
                reason = "Waiting for all four API processes."
            elif not _runtime_http("http://127.0.0.1:10001/health/ready"):
                reason = "Waiting for MQTT subscription and telemetry database readiness."
            elif not self.notification_ready(worker_id):
                reason = "Waiting for notification database readiness."
            else:
                contract, reason = self._contracts(candidate, require_worker=True)
                if contract is not None:
                    receipt = self._receipt(api_id, worker.get("State", {}).get("StartedAt"), candidate)
                    if receipt is not None:
                        self.progress("worker_ready", "One worker, MQTT, notifications and its new authenticated receipt verified.")
                        containers = {service: {"id": item["Id"], "image": item["Image"],
                                               "startedAt": item.get("State", {}).get("StartedAt")}
                                      for service, item in (("api", api), ("worker", worker))}
                        return {"runtime": contract, "receipt": receipt, "containers": containers}
                    reason = "Waiting for a fresh authenticated receipt from the new worker."
            time.sleep(min(self.POLL_INTERVAL, max(0, deadline - time.monotonic())))
        raise RuntimeError("Worker readiness timed out after {} seconds. {}".format(self.WORKER_TIMEOUT, reason))


def update_progress(directory, phase, detail):
    write_json_private(directory / "progress.json", {"status": "RUNNING", "phase": phase,
        "detail": detail, "updatedAt": now_iso(), "serverDirectory": str(directory)}, replace=True)


def assert_worker_stopped():
    ids = docker("ps", "-a", "--filter", "label=com.docker.compose.project=" + PROJECT,
                 "--filter", "label=com.docker.compose.service=worker", "-q").stdout.split()
    require(len(ids) <= 1, "More than one worker container exists; refusing an ambiguous lifecycle operation.")
    if ids:
        deployment_container("worker", running=False)
    assert_no_other_worker(None)


def protected_tag(directory, role):
    require(role in ("preserved", "candidate", "rollback"), "Unknown protected image role.")
    return PROJECT + ":" + role + "-" + directory.name


def import_image(directory, role):
    result = docker("image", "load", "--input", str(directory / "qualified-artifact" / (role + ".tar.gz")),
                    optional=True, timeout=900)
    require(result.returncode == 0, "The verified " + role + " image could not be imported; no command output was disclosed.")
    image = inspect_image(M[role]["sourceTag"])
    image_id = check_image(image, M[role], loaded=True)
    tag = protected_tag(directory, role)
    previous = inspect_image(tag, optional=True)
    require(previous is None or previous["Id"] == image_id, "A protected release tag already has another identity.")
    docker("image", "tag", image_id, tag)
    require(inspect_image(tag)["Id"] == image_id, "The protected release tag was not retained.")
    return image_id


class Deployment:
    def __init__(self, directory):
        self.directory = directory
        self.original = {}
        self.expected_files = {}
        self.state = {}
        self.mutation_started = False
        self.progress = lambda phase, detail: update_progress(directory, phase, detail)
        self.checks = None

    def assert_files(self):
        require({name: file_state(DEPLOY / name) for name in FILE_NAMES} == self.expected_files,
                "Live deployment files changed outside this release; automatic changes stopped.")

    def assert_frontend_unchanged(self):
        require(frontend_snapshot() == self.state["frontendBefore"],
                "The frontend changed during this release; automatic changes stopped for compatibility review.")

    def assert_current_containers(self):
        for role in ("api", "worker"):
            item = deployment_container(role, self.state["currentImageId"], True)
            require(item["Id"] == self.state["containers"][role]["id"],
                    "A running container changed while preparing this release.")

    def preflight(self):
        self.progress("VALIDATING", "Verifying the qualified bundle and current deployment before service changes.")
        snapshot = snapshot_current()
        self.state = safe_snapshot(snapshot)
        self.expected_files = snapshot["files"]
        self.checks = RuntimeChecks(self.progress, snapshot["frontendBefore"]["requiredCapabilities"])
        self.checks_required_notification = snapshot["containers"]["worker"]["id"]
        require(self.checks.notification_ready(self.checks_required_notification)
                and self.checks.processes_ready(self.checks_required_notification, "worker"),
                "Both existing worker processes and notification storage must be ready.")
        verify_bundle(self.directory / "qualified-arm64-bundle.zip", self.directory / "qualified-artifact")
        backup = self.directory / "configuration-backup"
        backup.mkdir(mode=0o700)
        for name in FILE_NAMES:
            self.original[name] = (DEPLOY / name).read_bytes()
            require(hash_bytes(self.original[name]) == self.expected_files[name]["sha256"],
                    "Configuration changed while its backup was being prepared.")
            descriptor = os.open(str(backup / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                output.write(self.original[name])
                output.flush()
                os.fsync(output.fileno())
            require(digest_file(private_regular(backup / name)) == self.expected_files[name]["sha256"],
                    "A configuration backup did not verify.")
        preserved_tag = protected_tag(self.directory, "preserved")
        existing = inspect_image(preserved_tag, optional=True)
        require(existing is None or existing["Id"] == self.state["currentImageId"],
                "The preserved image tag already points to another release.")
        docker("image", "tag", self.state["currentImageId"], preserved_tag)
        prior_tags = {}
        for role in ("candidate", "rollback"):
            reference = M[role]["sourceTag"]
            existing = inspect_image(reference, optional=True)
            prior_tags[reference] = existing["Id"] if existing else None
            if existing:
                docker("image", "tag", existing["Id"], PROJECT + ":artifact-" + role + "-before-" + self.directory.name)
        write_json_private(self.directory / "before-load.json", {**self.state,
            "manifestSha256": manifest_digest(), "priorArtifactTags": prior_tags,
            "currentImageProtectedTag": preserved_tag})
        self.progress("LOADING_IMAGES", "Retaining the current image and loading verified candidate and fallback images.")
        try:
            for role in ("candidate", "rollback"):
                self.state[role + "ImageId"] = import_image(self.directory, role)
        finally:
            for reference, image_id in prior_tags.items():
                if image_id is not None:
                    docker("image", "tag", image_id, reference)
                    require(inspect_image(reference)["Id"] == image_id, "An existing artifact tag could not be restored.")
        self.assert_files()
        self.assert_current_containers()
        self.assert_frontend_unchanged()
        api_updates, worker_updates = snapshot["apiUpdates"], snapshot["workerUpdates"]
        self.planned = dict(self.original)
        self.planned[".env"] = patch_env_bytes(self.original[".env"], {"BACKEND_IMAGE": protected_tag(self.directory, "candidate")})
        self.planned[".env.api"] = patch_env_bytes(self.original[".env.api"], api_updates)
        self.planned[".env.worker"] = patch_env_bytes(self.original[".env.worker"], worker_updates)
        plan_directory = self.directory / "planned-configuration"
        plan_directory.mkdir(mode=0o700)
        for name, data in self.planned.items():
            descriptor = os.open(str(plan_directory / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                output.write(data)
        planned_configuration = compose_configuration(plan_directory)
        expected_configuration = copy.deepcopy(snapshot["configuration"])
        for role, updates in (("api", api_updates), ("worker", worker_updates)):
            expected_configuration["services"][role]["image"] = protected_tag(self.directory, "candidate")
            expected_configuration["services"][role].setdefault("environment", {}).update(updates)
        require(without_extensions(planned_configuration) == without_extensions(expected_configuration),
                "The release would change more than its image and approved non-secret recovery metadata.")
        candidate = inspect_image(self.state["candidateImageId"])
        for role in ("api", "worker"):
            planned_environment = effective_environment(candidate, planned_configuration["services"][role])
            current = snapshot["environments"][role]
            protected_keys = {key for key in set(current) | set(planned_environment)
                              if key == "DASHBOARD_SERVICE_TOKEN" or key.startswith(("SMTP_", "SES_", "RESEND_"))}
            require(all(current.get(key) == planned_environment.get(key) for key in protected_keys),
                    "Existing mail credentials, recipient policy or service tokens would change.")
            for key, value in zip(("SOURCE_REVISION", "BACKEND_SOURCE_REVISION", "EDGE_SOURCE_REVISION"), sources(M["candidate"])):
                require(planned_environment.get(key) == value, "Configuration overrides a qualified source revision.")
        self.planned_configuration = planned_configuration
        self.state.update(manifestSha256=manifest_digest(), directory=str(self.directory), preparedAt=now_iso(),
                          currentImageProtectedTag=preserved_tag, expectedResetPolicy=snapshot["mail"]["expectedResetPolicy"])
        write_json_private(self.directory / "state.json", self.state)
        write_json_private(self.directory / "plan.json", {"createdAt": now_iso(),
            "candidateImageId": self.state["candidateImageId"], "rollbackImageId": self.state["rollbackImageId"],
            "changedKeys": {".env": ["BACKEND_IMAGE"], ".env.api": list(api_updates), ".env.worker": list(worker_updates)},
            "plannedFileHashes": {name: hash_bytes(data) for name, data in self.planned.items()},
            "mailDeliveryTested": False, "databaseBackupCreated": False})
        self.assert_files()
        self.assert_current_containers()
        self.assert_frontend_unchanged()

    def install(self, files):
        self.assert_files()
        for name in (".env.api", ".env.worker", ".env"):
            if hash_bytes(files[name]) == self.expected_files[name]["sha256"]:
                continue
            expected = dict(self.expected_files[name], sha256=hash_bytes(files[name]))
            try:
                replace_live_file(DEPLOY / name, self.expected_files[name], files[name])
            finally:
                try:
                    actual = file_state(DEPLOY / name)
                except (OSError, RuntimeError):
                    actual = None
                if actual == expected:
                    self.expected_files = dict(self.expected_files, **{name: expected})
                    write_json_private(self.directory / "installed-files.json", self.expected_files, replace=True)
            require(file_state(DEPLOY / name) == expected, "Installed configuration differs from the verified plan.")
        self.assert_files()

    def stop_worker(self):
        compose("stop", "--timeout", "60", "worker")
        assert_worker_stopped()

    def start_role(self, role, image_id):
        self.assert_files()
        self.assert_frontend_unchanged()
        assert_worker_stopped()
        configuration = compose_configuration()
        require(inspect_image(configuration["services"][role]["image"])["Id"] == image_id,
                "The selected image changed before container replacement.")
        compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", role)

    def verify_running_environments(self, image_id):
        configuration, image = compose_configuration(), inspect_image(image_id)
        for role in ("api", "worker"):
            item = deployment_container(role, image_id, True)
            require(environment_map(item.get("Config", {}).get("Env", [])) == effective_environment(image, configuration["services"][role]),
                    "The running environment differs from the retained deployment settings.")

    def apply(self):
        self.preflight()
        self.progress("STOPPING_WORKER", "Stopping the existing singleton worker before replacing either role.")
        self.mutation_started = True
        self.stop_worker()
        self.install(self.planned)
        require(without_extensions(compose_configuration()) == without_extensions(self.planned_configuration),
                "Live Compose resolution differs from the verified plan.")
        self.progress("UPGRADING_API", "Starting the candidate API and waiting for its additive migrations and four processes.")
        self.start_role("api", self.state["candidateImageId"])
        self.checks.wait_api(self.state["candidateImageId"], candidate=True)
        require(password_policy_delivery(public_json(API_ORIGIN + "/api/trpc/auth.passwordResetPolicy")) == self.state["expectedResetPolicy"],
                "The candidate password-reset policy does not match existing worker configuration.")
        self.progress("UPGRADING_WORKER", "Starting exactly one worker and verifying MQTT, notifications and a new authenticated receipt.")
        self.start_role("worker", self.state["candidateImageId"])
        evidence = self.checks.wait_worker(self.state["candidateImageId"], candidate=True)
        self.assert_files()
        self.verify_running_environments(self.state["candidateImageId"])
        self.assert_frontend_unchanged()
        return self.result("BACKEND_DEPLOYED", evidence, self.state["candidateImageId"])

    def rollback(self):
        self.assert_files()
        self.assert_frontend_unchanged()
        self.progress("ROLLING_BACK", "Restoring the independently qualified compatible fallback; additive migrations remain.")
        self.stop_worker()
        files = dict(self.original)
        files[".env"] = patch_env_bytes(files[".env"], {"BACKEND_IMAGE": protected_tag(self.directory, "rollback")})
        self.install(files)
        image_id = self.state["rollbackImageId"]
        require(check_image(inspect_image(protected_tag(self.directory, "rollback")), M["rollback"], True) == image_id,
                "The qualified fallback image identity changed.")
        self.start_role("api", image_id)
        self.checks.wait_api(image_id, candidate=False)
        self.start_role("worker", image_id)
        evidence = self.checks.wait_worker(image_id, candidate=False)
        self.assert_files()
        self.verify_running_environments(image_id)
        self.assert_frontend_unchanged()
        return self.result("ROLLED_BACK", evidence, image_id)

    def result(self, status, evidence, image_id):
        return {"status": status, "completedAt": now_iso(), "serverDirectory": str(self.directory),
                "manifestSha256": manifest_digest(), "activeImageId": image_id,
                "candidateImageId": self.state["candidateImageId"], "rollbackImageId": self.state["rollbackImageId"],
                "preservedImageId": self.state["currentImageId"], "runtime": evidence["runtime"],
                "workerReceipt": evidence["receipt"], "containers": evidence["containers"],
                "frontendSource": self.state["frontendBefore"]["source"], "frontendPublished": False,
                "configurationBackup": str(self.directory / "configuration-backup"),
                "databaseBackupCreated": False, "migrationsReversed": False, "gatewayDeployed": False,
                "mailDeliveryTested": False, "productionAccountVerified": False,
                **({"passwordResetPolicy": self.state["expectedResetPolicy"]} if status == "BACKEND_DEPLOYED" else {})}


def execute_deployment(deployment):
    try:
        return deployment.apply()
    except Exception as error:
        failure = safe_error(error)
        if not deployment.mutation_started:
            return {"status": "STOPPED_BEFORE_CHANGES", "error": failure, "completedAt": now_iso(),
                    "serverDirectory": str(deployment.directory)}
        try:
            report = deployment.rollback()
            report["deploymentError"] = failure
            return report
        except Exception as recovery_error:
            return {"status": "NEEDS_REVIEW", "deploymentError": failure,
                    "recoveryError": safe_error(recovery_error), "completedAt": now_iso(),
                    "serverDirectory": str(deployment.directory)}


def safe_error(error):
    if isinstance(error, RuntimeError):
        return str(error)
    return type(error).__name__ + " prevented this step; no command output or configuration values were disclosed."


def validate_directory(value):
    directory = Path(value)
    require(directory.parent == Path.home() / "smart-factory-releases"
            and re.fullmatch(r"[a-f0-9]{7}-\d{8}T\d{6}Z-[a-f0-9]{8}", directory.name)
            and directory.resolve(strict=True) == directory,
            "Unexpected server release directory.")
    private_directory(directory.parent)
    private_directory(directory)
    return directory


def remote_allocate():
    os.umask(0o077)
    parent = Path.home() / "smart-factory-releases"
    parent.mkdir(mode=0o700, exist_ok=True)
    private_directory(parent)
    name = M["candidate"]["sources"]["frontend"][:7] + "-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    directory = parent / name
    directory.mkdir(mode=0o700)
    return {"status": "STAGED", "directory": str(directory), "manifestSha256": manifest_digest()}


def process_start_identity(pid):
    try:
        # The command name may contain spaces; fields after the final ')' start at field 3.
        fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
        return fields[19]
    except (OSError, IndexError):
        return None


def remote_status(directory):
    if not (directory / "request.json").exists():
        return {"status": "STAGED", "serverDirectory": str(directory),
                "detail": "Files may be uploaded; no deployment job has been requested."}
    request = read_private_json(directory / "request.json")
    require(request.get("manifestSha256") == manifest_digest(), "The retained job belongs to a different release manifest.")
    if (directory / "result.json").exists():
        return read_private_json(directory / "result.json")
    progress = read_private_json(directory / "progress.json")
    if (directory / "process.json").exists():
        process = read_private_json(directory / "process.json")
        require(type(process.get("pid")) is int and process["pid"] > 1, "The retained process identifier is invalid.")
        if not process.get("startIdentity") or process_start_identity(process["pid"]) != process["startIdentity"]:
            progress.update(status="NEEDS_REVIEW", detail="The detached job ended without a completion record; preserve its release directory for review.")
    return progress


def remote_start(directory, helper_sha):
    os.umask(0o077)
    with release_lock(directory):
        if (directory / "request.json").exists():
            return remote_status(directory)
        for name in ("deploy-vm.py", "release-manifest.json", "qualified-arm64-bundle.zip"):
            path = directory / name
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), "Staged release files must be owned regular files.")
            os.chmod(path, 0o600)
        require(re.fullmatch(r"[a-f0-9]{64}", helper_sha or "")
                and digest_file(directory / "deploy-vm.py") == helper_sha,
                "The staged deployment helper differs from the requested file.")
        staged = validate_manifest(read_private_json(directory / "release-manifest.json"))
        require(staged == M, "The staged manifest differs from the requested release.")
        write_json_private(directory / "request.json", {"createdAt": now_iso(), "manifestSha256": manifest_digest(), "helperSha256": helper_sha})
        update_progress(directory, "STARTING", "Starting the detached deployment; service changes follow full validation.")
        try:
            descriptor = os.open(str(directory / "private-output.log"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                process = subprocess.Popen([sys.executable, str(directory / "deploy-vm.py"), "--manifest",
                    str(directory / "release-manifest.json"), "--remote-mode", "run", "--directory", str(directory)],
                    stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, cwd=directory,
                    close_fds=True, start_new_session=True)
            write_json_private(directory / "process.json", {"pid": process.pid, "startIdentity": process_start_identity(process.pid), "startedAt": now_iso()})
        except OSError:
            report = {"status": "STOPPED_BEFORE_CHANGES", "error": "The detached process could not start.", "serverDirectory": str(directory), "completedAt": now_iso()}
            write_json_private(directory / "result.json", report)
            return report
    return remote_status(directory)


def remote_run(directory):
    os.umask(0o077)
    with release_lock(directory, blocking=True):
        if (directory / "result.json").exists():
            return read_private_json(directory / "result.json")
        request = read_private_json(directory / "request.json")
        require(request.get("manifestSha256") == manifest_digest()
                and request.get("helperSha256") == digest_file(Path(__file__).resolve()),
                "The helper or manifest changed after the deployment request.")
        require(not (directory / "execution-claim.json").exists(),
                "This job has already started; use status instead of replaying deployment.")
        write_json_private(directory / "execution-claim.json", {"pid": os.getpid(), "startedAt": now_iso()})
        report = execute_deployment(Deployment(directory))
        write_json_private(directory / "result.json", report)
        write_json_private(directory / "progress.json", report, replace=True)
        return report


def ssh_options():
    key = Path.home() / ".ssh/id_ed25519"
    require(key.is_file(), "The existing ~/.ssh/id_ed25519 key is required.")
    require(shutil.which("ssh") is not None and shutil.which("scp") is not None, "OpenSSH ssh and scp are required.")
    return ["-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no",
            "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-i", str(key)]


def remote_call(mode, directory=None, helper_sha=None):
    arguments = ["python3", "-", "--remote-mode", mode]
    if directory is not None:
        arguments += ["--directory", directory]
    if helper_sha is not None:
        arguments += ["--helper-sha", helper_sha]
    # Input is Python source over the existing pinned SSH transport, never a shell substitution.
    code = "_INJECTED_MANIFEST = " + repr(M) + "\n" + Path(__file__).read_text()
    response = run_command(["ssh", "-T", *ssh_options(), HOST, shlex.join(arguments)],
                           "SSH release check (a started job may continue; use --status)",
                           input_text=code, timeout=180 if mode == "check" else 75)
    value = json.loads(response.stdout)
    require(isinstance(value, dict), "Unexpected server response.")
    return value


def find_bundle(explicit):
    if explicit:
        path = Path(explicit).expanduser()
        verify_bundle(path)
        return path.resolve()
    candidates = [Path.cwd() / "qualified-arm64-bundle.zip", Path(__file__).resolve().parent / "qualified-arm64-bundle.zip"]
    downloads = Path.home() / "Downloads"
    if downloads.is_dir():
        candidates += list(downloads.glob("qualified-arm64-bundle*.zip"))
    for path in candidates:
        if path.is_file() and not path.is_symlink() and path.stat().st_size == M["artifact"]["size"] and digest_file(path) == M["artifact"]["sha256"]:
            verify_bundle(path)
            return path.resolve()
    raise RuntimeError("Provide --bundle with the exact ZIP produced by the completed ARM64 qualification. No matching bundle was found.")


def status_exit_code(value):
    return 0 if value.get("status") in ("BACKEND_DEPLOYED", "PREFLIGHT_PASSED") else 1


def monitor(directory, initial=None, follow=True):
    value = initial or remote_call("status", directory)
    previous = None
    while follow and value.get("status") == "RUNNING":
        summary = (value.get("phase"), value.get("detail"))
        if summary != previous:
            print(str(summary[0]) + ": " + str(summary[1]), flush=True)
            previous = summary
        time.sleep(8)
        value = remote_call("status", directory)
    print(json.dumps(value, indent=2), flush=True)
    return status_exit_code(value)


def run_client(args):
    state_path = Path(args.state).expanduser() if args.state else Path(__file__).resolve().parent / ("smart-factory-vm-" + manifest_digest()[:12] + ".json")
    if args.status:
        require(state_path.exists(), "No local deployment receipt exists; supply --state for an existing run.")
        receipt = read_private_json(state_path)
        require(receipt.get("manifestSha256") == manifest_digest(), "The local receipt belongs to a different release.")
        return monitor(receipt["directory"], follow=not args.once)
    print("Verifying exact ARM64 candidate, fallback, tests, archive checksums and vulnerability audit...", flush=True)
    bundle = find_bundle(args.bundle)
    if not args.deploy:
        print("Checking the existing VM, configuration, current frontend and singleton worker...", flush=True)
        result = remote_call("check")
        print(json.dumps(result, indent=2))
        return status_exit_code(result)
    receipt = read_private_json(state_path) if state_path.exists() else None
    if receipt:
        require(receipt.get("manifestSha256") == manifest_digest(), "The local receipt belongs to a different release.")
        current = remote_call("status", receipt["directory"])
        if current.get("status") != "STAGED":
            return monitor(receipt["directory"], current)
    else:
        # This is still read-only and catches host/configuration drift before uploading images.
        remote_call("check")
        receipt = remote_call("allocate")
        require(receipt.get("manifestSha256") == manifest_digest()
                and re.fullmatch(r"/home/ubuntu/smart-factory-releases/[a-f0-9]{7}-\d{8}T\d{6}Z-[a-f0-9]{8}", str(receipt.get("directory", ""))),
                "The server returned an unexpected release directory.")
        state_path.parent.mkdir(parents=True, exist_ok=True)
        write_json_private(state_path, {"directory": receipt["directory"], "manifestSha256": manifest_digest(), "createdAt": now_iso()})
    directory = receipt["directory"]
    print("Uploading the verified images and deployment helper. Receipt: " + str(state_path), flush=True)
    with tempfile.TemporaryDirectory(prefix="smart-factory-manifest-") as temporary:
        manifest_path = Path(temporary) / "release-manifest.json"
        write_json_private(manifest_path, M)
        for local, name in ((Path(__file__).resolve(), "deploy-vm.py"), (manifest_path, "release-manifest.json"), (bundle, "qualified-arm64-bundle.zip")):
            run_command(["scp", *ssh_options(), str(local), HOST + ":" + directory + "/" + name], "Verified release upload", timeout=1800)
    value = remote_call("start", directory, digest_file(Path(__file__).resolve()))
    return monitor(directory, value)


def main(argv=None):
    global M
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Validate the release and perform read-only VM preflight (default).")
    mode.add_argument("--deploy", action="store_true", help="Start the explicit manual VM deployment after all gates pass.")
    mode.add_argument("--status", action="store_true", help="Reconnect to the saved detached job; never redeploy.")
    parser.add_argument("--once", action="store_true", help="With --status, print one snapshot rather than follow progress.")
    parser.add_argument("--bundle", help="Exact qualified ARM64 ZIP from the completed qualification.")
    parser.add_argument("--manifest", help="Reviewed release manifest, if it is not embedded in this file.")
    parser.add_argument("--state", help="Private local receipt path for reconnecting to the same release.")
    parser.add_argument("--remote-mode", choices=("check", "allocate", "start", "run", "status"), help=argparse.SUPPRESS)
    parser.add_argument("--directory", help=argparse.SUPPRESS)
    parser.add_argument("--helper-sha", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        require(sys.version_info >= (3, 9), "Python 3.9 or newer is required.")
        if args.manifest:
            path = Path(args.manifest).expanduser()
            require(path.is_file() and not path.is_symlink() and path.stat().st_size < 1024 * 1024,
                    "The reviewed manifest must be a bounded regular JSON file.")
            M = validate_manifest(json.loads(path.read_text()))
        else:
            M = validate_manifest(globals().get("_INJECTED_MANIFEST", RELEASE_MANIFEST))
        if args.remote_mode:
            require(not (args.check or args.deploy or args.status or args.bundle or args.state or args.once),
                    "Remote internal modes cannot be combined with client options.")
            if args.remote_mode == "check":
                report = remote_check()
            elif args.remote_mode == "allocate":
                report = remote_allocate()
            else:
                require(args.directory, "A retained server directory is required.")
                directory = validate_directory(args.directory)
                if args.remote_mode == "status":
                    report = remote_status(directory)
                elif args.remote_mode == "start":
                    report = remote_start(directory, args.helper_sha)
                else:
                    report = remote_run(directory)
            print(json.dumps(report))
            return status_exit_code(report) if args.remote_mode == "run" else 0
        require(not args.once or args.status, "--once is available only with --status.")
        return run_client(args)
    except KeyboardInterrupt:
        print("A started VM job continues after disconnection. Use this same manifest and --status to reconnect.", file=sys.stderr)
        return 2
    except Exception as error:
        print("STOPPED: " + safe_error(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
