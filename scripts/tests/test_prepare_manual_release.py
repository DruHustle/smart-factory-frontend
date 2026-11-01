"""No-network preparation tests; actual ARM64 qualification runs on the user's host.

Synthetic OCI metadata exercises the real release verifier. These tests do not
claim to build, boot or scan a container image and never contact the VM.
"""
import copy
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile


SOURCE = Path(__file__).resolve().parents[1] / "prepare-manual-release.py"
spec = importlib.util.spec_from_file_location("manual_prepare_test_subject", SOURCE)
prepare = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = prepare
spec.loader.exec_module(prepare)
CAPABILITIES = ["password-reset-v1", "account-requests-v1", "account-role-approval-v1",
                "industrial-connectivity-v1", "published-passports-v1"]


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def plan_fixture():
    return {"planVersion": 1,
            "candidate": {name: {"sha": letter * 40, "bundleFile": name + ".bundle",
                                  "bundleSha256": "d" * 64, "ref": "refs/heads/private-reviewed"}
                          for name, letter in zip(prepare.REPOSITORIES, "abc")},
            "rollback": dict(prepare.FALLBACK),
            "baseline": {"sources": dict(zip(prepare.REPOSITORIES, (letter * 40 for letter in "789"))),
                         "schema": {"revision": "0034_password_reset_tokens", "digest": "e" * 64},
                         "capabilities": [value for value in CAPABILITIES if value != "industrial-connectivity-v1"]}}


class FakeCommands:
    def __init__(self, work, handler=None, environment=None):
        self.work, self.handler = work, handler
        self.environment = dict(environment or {})
        self.calls = []

    def run(self, arguments, stage, **options):
        self.calls.append((list(arguments), stage, options))
        result = self.handler(arguments, stage, options) if self.handler else ""
        if isinstance(result, subprocess.CompletedProcess):
            return result
        return subprocess.CompletedProcess(arguments, 0, result or "", "")


def oci_fixture(tag, sources):
    configuration = {"architecture": "arm64", "os": "linux", "config": {
        "User": "app:app", "Labels": {label: sources[name] for name, label in zip(prepare.REPOSITORIES, prepare.LABELS)}}}
    config_data = encoded(configuration)
    config_id = "sha256:" + digest(config_data)
    layer_data = b"\x00synthetic metadata-only unit-test layer\x00"
    layer_id = "sha256:" + digest(layer_data)
    manifest = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "size": len(config_data), "digest": config_id},
                "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar", "size": len(layer_data), "digest": layer_id}]}
    manifest_data = encoded(manifest)
    manifest_id = "sha256:" + digest(manifest_data)
    descriptor = {"mediaType": manifest["mediaType"], "size": len(manifest_data), "digest": manifest_id,
                  "platform": {"os": "linux", "architecture": "arm64"}}
    blob = lambda value: "blobs/sha256/" + value.split(":")[1]
    entries = {"oci-layout": encoded({"imageLayoutVersion": "1.0.0"}),
               "index.json": encoded({"schemaVersion": 2, "manifests": [descriptor]}),
               "manifest.json": encoded([{"Config": blob(config_id), "RepoTags": [tag], "Layers": [blob(layer_id)]}]),
               blob(config_id): config_data, blob(manifest_id): manifest_data, blob(layer_id): layer_data}
    inspection = {"Id": config_id, "Os": "linux", "Architecture": "arm64", "Config": configuration["config"],
                  "Descriptor": descriptor}
    return entries, inspection, config_id, manifest_id


def write_archive(path, entries, compressed=True, duplicate=None, link=None):
    with tarfile.open(path, "w:gz" if compressed else "w") as archive:
        for name, value in entries.items():
            item = tarfile.TarInfo(name)
            if name == link:
                item.type, item.linkname = tarfile.SYMTYPE, "/tmp/unrelated"
                archive.addfile(item)
            else:
                item.size = len(value)
                archive.addfile(item, io.BytesIO(value))
        if duplicate:
            item = tarfile.TarInfo(duplicate)
            item.size = len(entries[duplicate])
            archive.addfile(item, io.BytesIO(entries[duplicate]))


def runtime(sources):
    return {"contractVersion": 2, "deployment": "bundle", "versioned": True,
            "source": sources["frontend"], "backendSource": sources["backend"], "edgeSource": sources["edge"],
            "schema": {"revision": "0035_industrial_connectivity", "digest": "f" * 64, "ready": True},
            "capabilities": CAPABILITIES.copy(), "worker": {"fresh": True, "compatible": True}}


class TemporaryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)

    def tearDown(self):
        self.temporary.cleanup()


class SourceAndEnvironmentTests(TemporaryTest):
    def test_plan_is_copied_and_fixed_public_fallback_is_required(self):
        plan = plan_fixture()
        validated = prepare.validate_plan(plan)
        validated["candidate"]["frontend"]["sha"] = "0" * 40
        self.assertEqual(plan["candidate"]["frontend"]["sha"], "a" * 40)
        plan["rollback"]["frontend"] = "0" * 40
        with self.assertRaisesRegex(RuntimeError, "fallback revisions"):
            prepare.validate_plan(plan)

    def test_plan_rejects_mutable_or_redirected_sources(self):
        for key, value in (("sha", "main"), ("bundleFile", "../frontend.bundle"),
                           ("ref", "refs/heads/../hidden"), ("ref", "refs/heads/branch.lock"),
                           ("ref", "refs/heads/a..b"), ("ref", "--upload-pack=evil"),
                           ("bundleSha256", "ABC")):
            with self.subTest(key=key, value=value):
                plan = plan_fixture()
                plan["candidate"]["frontend"][key] = value
                with self.assertRaises(RuntimeError):
                    prepare.validate_plan(plan)
        plan = plan_fixture()
        plan["candidate"]["frontend"]["url"] = "https://example.test/untrusted.git"
        with self.assertRaisesRegex(RuntimeError, "Unexpected source-package fields"):
            prepare.validate_plan(plan)

    def test_source_package_checks_actual_bytes_and_disallows_links(self):
        plan = plan_fixture()
        for name, source in plan["candidate"].items():
            data = (name + " synthetic bundle").encode()
            (self.root / source["bundleFile"]).write_bytes(data)
            source["bundleSha256"] = digest(data)
        path = self.root / "release-plan.json"
        path.write_bytes(encoded(plan))
        actual, plan_hash = prepare.load_source_package(self.root)
        self.assertEqual(actual, plan)
        self.assertEqual(plan_hash, digest(path.read_bytes()))
        bundle = self.root / "frontend.bundle"
        bundle.write_bytes(b"different")
        with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
            prepare.load_source_package(self.root)
        bundle.unlink()
        bundle.symlink_to(self.root / "backend.bundle")
        with self.assertRaisesRegex(RuntimeError, "regular file"):
            prepare.load_source_package(self.root)

    def test_environment_drops_app_cloud_build_and_git_overrides(self):
        inherited = {"PATH": "/usr/bin", "HOME": "/Users/person", "DOCKER_HOST": "unix:///var/run/docker.sock",
                     "HTTPS_PROXY": "http://local-proxy", "DATABASE_URL": "secret", "SMTP_PASSWORD": "secret",
                     "SENDGRID_API_KEY": "secret", "AWS_SECRET_ACCESS_KEY": "secret", "JWT_SECRET": "secret",
                     "GIT_SSH_COMMAND": "bad", "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_GLOBAL": "/tmp/unsafe",
                     "BUILDX_BUILDER": "remote-builder", "BUILDKIT_HOST": "tcp://remote", "BUNDLE_IMAGE": "unrelated",
                     "TRIVY_SERVER": "https://remote", "COMPOSE_FILE": "unrelated.yml", "PYTHONPATH": "/tmp/unsafe"}
        environment = prepare.clean_environment(inherited)
        self.assertEqual(environment["HOME"], inherited["HOME"])
        self.assertEqual(environment["HTTPS_PROXY"], inherited["HTTPS_PROXY"])
        self.assertEqual(environment["GIT_CONFIG_GLOBAL"], os.devnull)
        for key in set(inherited) - {"PATH", "HOME", "DOCKER_HOST", "HTTPS_PROXY", "GIT_CONFIG_GLOBAL"}:
            self.assertNotIn(key, environment)

    def test_bundle_ref_must_be_the_only_exact_head(self):
        plan = plan_fixture()
        def heads(arguments, stage, options):
            name = Path(arguments[-1]).stem
            source = plan["candidate"][name]
            return source["sha"] + " " + source["ref"] + "\n"
        commands = FakeCommands(self.root, heads)
        prepare.verify_source_heads(commands, self.root, plan)
        self.assertEqual(len(commands.calls), 3)
        commands.handler = lambda *args: "a" * 40 + " refs/heads/private-reviewed\n" + "b" * 40 + " refs/heads/unreviewed\n"
        with self.assertRaisesRegex(RuntimeError, "only its exact reviewed branch"):
            prepare.verify_source_heads(commands, self.root, plan)

    @unittest.skipUnless(shutil.which("git"), "Git is required for the real local bundle check")
    def test_git_reads_a_real_private_bundle_without_network(self):
        repository = self.root / "source"
        repository.mkdir()
        environment = prepare.clean_environment(os.environ)
        def git(*arguments):
            return subprocess.run(["git", "-C", str(repository), *arguments], env=environment,
                                  check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout.strip()
        git("init", "--initial-branch=private-reviewed")
        (repository / "example.txt").write_text("Synthetic source, no secrets.\n")
        git("add", "example.txt")
        git("-c", "user.name=Test", "-c", "user.email=synthetic@example.test", "commit", "-m", "Synthetic bundle fixture")
        revision = git("rev-parse", "HEAD")
        plan = plan_fixture()
        for name, source in plan["candidate"].items():
            git("bundle", "create", str(self.root / (name + ".bundle")), "refs/heads/private-reviewed")
            source["sha"] = revision
        work = prepare.private_directory(self.root / "work")
        with patch("builtins.print"):
            prepare.verify_source_heads(prepare.Commands(work, environment), self.root, plan)

    def test_clean_checkout_rejects_ignored_injected_files(self):
        commands = FakeCommands(self.root, lambda arguments, *unused: "a" * 40 if "rev-parse" in arguments else "!! .env\n")
        with self.assertRaisesRegex(RuntimeError, "modified or untracked"):
            prepare.clean_checkout(commands, self.root, "a" * 40)
        self.assertIn("--ignored=matching", commands.calls[-1][0])

    def test_core_is_not_imported_when_its_bytes_differ(self):
        candidate = self.root / "candidate"
        (candidate / "scripts").mkdir(parents=True)
        (candidate / "scripts/deploy-vm.py").write_text("raise AssertionError('should not execute')\n")
        core = self.root / "deploy-vm.py"
        core.write_text("raise AssertionError('different unreviewed code')\n")
        with self.assertRaisesRegex(RuntimeError, "differs from the exact reviewed"):
            prepare.load_core(core, candidate)


class DockerIsolationTests(TemporaryTest):
    def test_explicit_unix_endpoint_is_pinned_without_context_or_tls(self):
        commands = FakeCommands(self.root, environment={"DOCKER_HOST": "unix:///var/run/docker.sock",
                                                        "DOCKER_TLS_VERIFY": "1", "DOCKER_CERT_PATH": "/tmp/certs"})
        self.assertEqual(prepare.local_docker_endpoint(commands), "unix:///var/run/docker.sock")
        self.assertEqual(commands.calls, [])
        self.assertNotIn("DOCKER_TLS_VERIFY", commands.environment)
        self.assertNotIn("DOCKER_CERT_PATH", commands.environment)

    def test_docker_context_takes_precedence_and_is_resolved_before_daemon(self):
        commands = FakeCommands(self.root, lambda *unused: '"unix:///Users/person/.docker/run/docker.sock"',
                                {"DOCKER_HOST": "tcp://remote:2376", "DOCKER_CONTEXT": "desktop-linux"})
        endpoint = prepare.local_docker_endpoint(commands)
        self.assertIn("desktop-linux", commands.calls[0][0])
        self.assertEqual(commands.environment["DOCKER_HOST"], endpoint)
        self.assertNotIn("DOCKER_CONTEXT", commands.environment)
        self.assertTrue(all(call[0][1] == "context" for call in commands.calls))

    def test_remote_daemon_is_refused_before_any_daemon_request(self):
        for endpoint in ("ssh://production", "tcp://remote:2375", "http://127.0.0.1:2375", "unix:///tmp/socket\nother"):
            with self.subTest(endpoint=endpoint):
                commands = FakeCommands(self.root, environment={"DOCKER_HOST": endpoint})
                with self.assertRaisesRegex(RuntimeError, "Remote/SSH/TCP"):
                    prepare.local_docker_endpoint(commands)
                self.assertEqual(commands.calls, [])
        commands = FakeCommands(self.root, lambda *unused: '"ssh://production"', {"DOCKER_CONTEXT": "remote"})
        with self.assertRaises(RuntimeError):
            prepare.local_docker_endpoint(commands)
        self.assertEqual(len(commands.calls), 1)
        self.assertEqual(commands.calls[0][0][1:3], ["context", "inspect"])

    def test_fixture_collisions_are_read_only_for_names_and_labels(self):
        for output_on_call in (1, 2, 3, 4, 5, 6):
            with self.subTest(output_on_call=output_on_call):
                calls = []
                def response(arguments, stage, options):
                    calls.append(arguments)
                    return (prepare.FIXTURE_PROJECT + "-existing" if output_on_call % 2 else "resource-id") if len(calls) == output_on_call else ""
                commands = FakeCommands(self.root, response)
                with self.assertRaisesRegex(RuntimeError, "nothing was removed"):
                    prepare.fixture_empty(commands)
                self.assertFalse(any("rm" in call[0] or "down" in call[0] for call in commands.calls))

    def test_unrelated_docker_resources_are_not_modified(self):
        commands = FakeCommands(self.root, lambda args, *unused: "unrelated-project-db\n" if "--format" in args else "")
        prepare.fixture_empty(commands)
        self.assertEqual(len(commands.calls), 6)

    def test_x86_is_rejected_before_docker_calls(self):
        commands = FakeCommands(self.root)
        with patch.object(prepare.platform, "system", return_value="Darwin"), patch.object(prepare.platform, "machine", return_value="x86_64"):
            with self.assertRaisesRegex(RuntimeError, "x86 emulation"):
                prepare.prerequisite_check(commands)
        self.assertEqual(commands.calls, [])

    def test_classic_docker_store_is_rejected_with_actionable_message(self):
        information = {"OSType": "linux", "Architecture": "aarch64", "MemTotal": 8 * 1024**3,
                       "DriverStatus": [["Backing Filesystem", "extfs"]]}
        commands = FakeCommands(self.root, lambda args, *unused: json.dumps(information) if args[1:2] == ["info"] else "",
                                {"DOCKER_HOST": "unix:///var/run/docker.sock"})
        with patch.object(prepare.platform, "system", return_value="Darwin"), patch.object(prepare.platform, "machine", return_value="arm64"), \
                patch.object(prepare.shutil, "which", return_value="/usr/bin/executable"), \
                patch.object(prepare.shutil, "disk_usage", return_value=Mock(free=64 * 1024**3)):
            with self.assertRaisesRegex(RuntimeError, "containerd image store"):
                prepare.prerequisite_check(commands)
        self.assertFalse(any("build" in call[0] for call in commands.calls))

    def test_builder_is_local_unique_and_removed_even_when_build_fails(self):
        state = {"runId": "a" * 32, "buildContextPolicy": prepare.BUILD_CONTEXT_POLICY,
                 "tags": {role: "factory-qualified:" + role + "-test" for role in ("candidate", "rollback")}}
        paths = {role: {name: self.root / role / name for name in prepare.REPOSITORIES} for role in state["tags"]}
        def response(arguments, stage, options):
            if arguments[1:3] == ["buildx", "inspect"] and "--bootstrap" not in arguments:
                return subprocess.CompletedProcess(arguments, 1, "", "")
            if arguments[1:3] == ["image", "inspect"]:
                return subprocess.CompletedProcess(arguments, 1, "", "")
            if arguments[1:3] == ["buildx", "build"]:
                raise RuntimeError("synthetic build failure")
            return ""
        commands = FakeCommands(self.root, response)
        with patch.object(prepare, "normalized_source_contexts", return_value=contextlib.nullcontext(paths["candidate"])):
            with self.assertRaisesRegex(RuntimeError, "synthetic build failure"):
                prepare.build_images(commands, paths, plan_fixture(), state, Mock(), "unix:///local.sock")
        create = next(call[0] for call in commands.calls if call[0][1:3] == ["buildx", "create"])
        self.assertEqual(create[-1], "unix:///local.sock")
        self.assertNotIn("--use", create)
        build = next(call[0] for call in commands.calls if call[0][1:3] == ["buildx", "build"])
        self.assertIn("linux/arm64", build)
        for name, argument in (("frontend", "SOURCE_REVISION"), ("backend", "BACKEND_SOURCE_REVISION"), ("edge", "EDGE_SOURCE_REVISION")):
            self.assertIn(argument + "=" + plan_fixture()["candidate"][name]["sha"], build)
        self.assertEqual(commands.calls[-1][0], ["docker", "buildx", "rm", "sf-manual-" + state["runId"]])

    def test_existing_unowned_tag_is_refused_without_retag_or_removal(self):
        state = {"runId": "a" * 32, "buildContextPolicy": prepare.BUILD_CONTEXT_POLICY,
                 "tags": {role: "factory-qualified:" + role + "-test" for role in ("candidate", "rollback")}}
        def response(arguments, stage, options):
            if arguments[1:3] == ["buildx", "inspect"] and "--bootstrap" not in arguments:
                return subprocess.CompletedProcess(arguments, 1, "", "")
            if arguments[1:3] == ["image", "inspect"]:
                return json.dumps([{"Id": "sha256:" + "0" * 64}])
            return ""
        commands = FakeCommands(self.root, response)
        with self.assertRaisesRegex(RuntimeError, "ownership receipt"):
            prepare.build_images(commands, {}, plan_fixture(), state, Mock(), "unix:///local.sock")
        self.assertFalse(any(call[0][1:3] in (["image", "rm"], ["image", "tag"], ["buildx", "build"]) for call in commands.calls))

    def test_real_smoke_then_scanner_commands_use_owned_tags_and_evidence(self):
        commands = FakeCommands(self.root)
        tags = {role: "factory-qualified:" + role + "-unique" for role in ("candidate", "rollback")}
        with patch.object(prepare, "normalized_source_contexts", return_value=contextlib.nullcontext({"frontend": self.root / "normalized"})):
            prepare.qualification(commands, self.root / "candidate", tags, self.root / "evidence", "a" * 40)
        smoke = next(call for call in commands.calls if "scripts/bundle-smoke.py" in call[0])
        self.assertEqual(smoke[2]["extra"], {"BUNDLE_IMAGE": tags["candidate"], "BUNDLE_ROLLBACK_IMAGE": tags["rollback"],
                                           "QUALIFICATION_EVIDENCE_DIR": str(self.root / "evidence")})
        self.assertEqual(commands.calls[-1][0], [sys.executable, "scripts/audit-container.py", tags["candidate"],
                                               "--output", str(self.root / "evidence/container-audit.json")])
        self.assertTrue(all("ssh" not in call[0] and "push" not in call[0] for call in commands.calls))
        self.assertEqual(smoke[2]["cwd"], self.root / "normalized")


class SourceContextTests(TemporaryTest):
    def setUp(self):
        super().setUp()
        self.old_umask = os.umask(0o077)
        self.environment = prepare.clean_environment(os.environ)

    def tearDown(self):
        os.umask(self.old_umask)
        super().tearDown()

    def repository(self):
        repository = self.root / "source"
        repository.mkdir(mode=0o700)
        def git(*arguments):
            return subprocess.run(["git", "-C", str(repository), *arguments], env=self.environment,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, text=True).stdout.strip()
        git("init", "--initial-branch=fixture")
        files = {"deploy/migrations/manifest.json": b'["one.sql"]\n',
                 "deploy/migrations/one.sql": b"-- Exact synthetic migration\nSELECT 1;\n",
                 "scripts/tests/smtp-capture.py": b"# Synthetic capture fixture\n",
                 "scripts/executable.sh": b"#!/bin/sh\nexit 0\n", "empty.txt": b""}
        for name, value in files.items():
            path = repository / name
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.write_bytes(value)
        (repository / "scripts/executable.sh").chmod(0o700)
        git("add", ".")
        git("-c", "user.name=Test", "-c", "user.email=synthetic@example.test", "commit", "-m", "Exact source context fixture")
        return repository, git("rev-parse", "HEAD"), files, git

    def commands(self, callback=None):
        def response(arguments, stage, options):
            if arguments[0] == "git":
                return subprocess.run(arguments, env=self.environment, check=True, text=True,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return callback(arguments, stage, options) if callback else ""
        return FakeCommands(self.root, response, self.environment)

    def test_exact_git_export_normalizes_only_private_staged_files(self):
        repository, revision, files, unused = self.repository()
        original_modes = {name: stat.S_IMODE((repository / name).stat().st_mode) for name in files}
        with prepare.normalized_source_contexts(self.commands(), {"backend": repository}, {"backend": revision}) as contexts:
            staged = contexts["backend"]
            self.assertEqual(stat.S_IMODE(staged.parent.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(staged.stat().st_mode), 0o755)
            self.assertFalse((staged / ".git").exists())
            for name, value in files.items():
                self.assertEqual((staged / name).read_bytes(), value)
                self.assertEqual(stat.S_IMODE((staged / name).stat().st_mode), 0o755 if name.endswith(".sh") else 0o644)
                self.assertEqual(stat.S_IMODE((staged / name).parent.stat().st_mode), 0o755)
            self.assertEqual({name: stat.S_IMODE((repository / name).stat().st_mode) for name in files}, original_modes)
            self.assertEqual((repository / "deploy/migrations/manifest.json").stat().st_mode & 0o777, 0o600)
        self.assertFalse(staged.parent.exists())
        self.assertEqual({name: (repository / name).read_bytes() for name in files}, files)

    def test_export_ignore_and_substitution_cannot_change_exact_source(self):
        for attribute, expected_error in (("empty.txt export-ignore\n", "omitted tracked files"),
                                           ("empty.txt export-subst\n", "blob differs")):
            with self.subTest(attribute=attribute):
                repository, unused, files, git = self.repository()
                (repository / ".gitattributes").write_text(attribute)
                (repository / "empty.txt").write_text("$Format:%H$\n")
                git("add", ".")
                git("-c", "user.name=Test", "-c", "user.email=synthetic@example.test", "commit", "-m", "Unsafe export attributes fixture")
                revision = git("rev-parse", "HEAD")
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    with prepare.normalized_source_contexts(self.commands(), {"frontend": repository}, {"frontend": revision}):
                        self.fail("Filtered export accepted")
                self.assertEqual(list(self.root.glob("source-contexts-*")), [])
                shutil.rmtree(repository)

    def test_extraction_refuses_existing_paths_links_traversal_and_wrong_modes(self):
        value = b"synthetic source"
        expected = {"safe.txt": {"blob": hashlib.sha1(b"blob " + str(len(value)).encode() + b"\0" + value).hexdigest(), "mode": 0o644}}
        archive = self.root / "source.tar"
        write_archive(archive, {"safe.txt": value}, compressed=False)
        existing = self.root / "existing"
        existing.mkdir(mode=0o700)
        (existing / "preserve").write_bytes(b"unchanged")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            prepare.extract_source_context(archive, existing, expected)
        self.assertEqual((existing / "preserve").read_bytes(), b"unchanged")
        for index, options in enumerate(({"entries": {"../outside": value}}, {"entries": {"safe.txt": value}, "link": "safe.txt"},
                                          {"entries": {"safe.txt": b"different"}})):
            write_archive(archive, compressed=False, **options)
            with self.assertRaises(RuntimeError):
                prepare.extract_source_context(archive, self.root / ("bad-" + str(index)), expected)
        self.assertFalse((self.root.parent / "outside").exists())
        write_archive(archive, {"safe.txt": value}, compressed=False)
        with self.assertRaisesRegex(RuntimeError, "executable bit"):
            prepare.extract_source_context(archive, self.root / "wrong-mode", {"safe.txt": {**expected["safe.txt"], "mode": 0o755}})

    def test_smoke_and_scanner_use_verified_normalized_fixture_until_completion(self):
        repository, revision, unused, unused_git = self.repository()
        observed = []
        def child(arguments, stage, options):
            if arguments[0] != "docker":
                source = options["cwd"]
                self.assertNotEqual(source, repository)
                self.assertEqual((source / "scripts/tests/smtp-capture.py").stat().st_mode & 0o777, 0o644)
                self.assertEqual(source.parent.stat().st_mode & 0o777, 0o700)
                self.assertEqual((repository / "scripts/tests/smtp-capture.py").stat().st_mode & 0o777, 0o600)
                observed.append(source)
            return ""
        tags = {role: "factory-qualified:" + role + "-fixture" for role in ("candidate", "rollback")}
        prepare.qualification(self.commands(child), repository, tags, self.root / "evidence", revision)
        self.assertEqual(len(observed), 2)
        self.assertEqual(observed[0], observed[1])
        self.assertFalse(observed[0].parent.exists())

    def test_nonroot_runtime_guard_has_no_network_root_override_or_writes(self):
        repository, unused, unused_files, unused_git = self.repository()
        def response(arguments, stage, options):
            expected = json.loads(arguments[-1])
            return json.dumps({"nonRoot": True, "migrationCount": len(expected["names"]), "digest": expected["digest"]})
        commands = FakeCommands(self.root, response)
        prepare.verify_runtime_inputs(commands, "factory-qualified:rollback-fixture", repository)
        arguments = commands.calls[0][0]
        self.assertIn("--pull=never", arguments)
        self.assertEqual(arguments[arguments.index("--network") + 1], "none")
        self.assertIn("--read-only", arguments)
        self.assertEqual(arguments[arguments.index("--cap-drop") + 1], "ALL")
        self.assertNotIn("--user", arguments)
        self.assertNotIn("--volume", arguments)
        self.assertIn("-I", arguments)
        self.assertIn("-B", arguments)
        self.assertIn("os.getuid() == 0", arguments[arguments.index("-c") + 1])
        commands.handler = lambda *unused: json.dumps({"nonRoot": True, "migrationCount": 0, "digest": "0" * 64})
        with self.assertRaisesRegex(RuntimeError, "did not verify every exact"):
            prepare.verify_runtime_inputs(commands, "factory-qualified:candidate-fixture", repository)

    def test_old_build_policy_blocks_cached_images_before_docker_use(self):
        commands = FakeCommands(self.root)
        with self.assertRaisesRegex(RuntimeError, "predates the normalized"):
            prepare.build_images(commands, {}, plan_fixture(), {"ownedImages": {"candidate": "old-image"}}, Mock(), "unix:///local.sock")
        self.assertEqual(commands.calls, [])

    def test_new_and_reused_images_for_both_roles_verify_staged_runtime_inputs(self):
        plan = plan_fixture()
        state = {"runId": "a" * 32, "buildContextPolicy": prepare.BUILD_CONTEXT_POLICY,
                 "tags": {role: "factory-qualified:" + role + "-fixture" for role in ("candidate", "rollback")}}
        paths = {role: {name: self.root / role / name for name in prepare.REPOSITORIES} for role in state["tags"]}
        contexts = {role: {name: self.root / ("normalized-" + role) / name for name in ("frontend", "backend")} for role in state["tags"]}
        built, guarded = set(), []
        def response(arguments, stage, options):
            if arguments[1:3] == ["buildx", "inspect"] and "--bootstrap" not in arguments:
                return subprocess.CompletedProcess(arguments, 1, "", "")
            if arguments[1:3] == ["image", "inspect"]:
                role = next(role for role, tag in state["tags"].items() if tag == arguments[-1])
                if role not in built:
                    return subprocess.CompletedProcess(arguments, 1, "", "")
                sources = {name: value["sha"] for name, value in plan["candidate"].items()} if role == "candidate" else prepare.FALLBACK
                return json.dumps([oci_fixture(state["tags"][role], sources)[1]])
            if arguments[1:3] == ["buildx", "build"]:
                role = next(role for role, tag in state["tags"].items() if tag in arguments)
                self.assertEqual(arguments[-1], str(contexts[role]["frontend"]))
                self.assertIn("backend=" + str(contexts[role]["backend"]), arguments)
                built.add(role)
            return ""
        def normalized(commands, source_paths, source_ids):
            role = next(role for role in paths if source_paths["frontend"] == paths[role]["frontend"])
            expected = {name: plan["candidate"][name]["sha"] for name in ("frontend", "backend")} if role == "candidate" else {name: prepare.FALLBACK[name] for name in ("frontend", "backend")}
            self.assertEqual(source_ids, expected)
            return contextlib.nullcontext(contexts[role])
        def guard(commands, tag, backend):
            role = next(role for role, value in state["tags"].items() if value == tag)
            self.assertIn(role, built)
            self.assertEqual(backend, contexts[role]["backend"])
            guarded.append(role)
        commands = FakeCommands(self.root, response)
        with patch.object(prepare, "normalized_source_contexts", side_effect=normalized), patch.object(prepare, "verify_runtime_inputs", side_effect=guard):
            prepare.build_images(commands, paths, plan, state, Mock(), "unix:///local.sock")
            self.assertEqual(guarded, ["candidate", "rollback"])
            self.assertEqual(sum(call[0][1:3] == ["buildx", "build"] for call in commands.calls), 2)
            guarded.clear()
            prepare.build_images(commands, paths, plan, state, Mock(), "unix:///local.sock")
            self.assertEqual(guarded, ["candidate", "rollback"])
            self.assertEqual(sum(call[0][1:3] == ["buildx", "build"] for call in commands.calls), 2,
                             "Owned existing images should be checked without being rebuilt.")

    def test_actual_dropped_linux_uid_reads_normalized_migrations_but_not_original_modes(self):
        if not sys.platform.startswith("linux") or os.getuid() != 0:
            self.skipTest("Actual dropped-UID proof requires Linux root with SETUID/SETGID.")
        caps = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("CapEff:"))
        if int(caps, 16) & 0xc0 != 0xc0:
            self.skipTest("Actual dropped-UID proof requires SETUID/SETGID; run the local test with those permissions.")
        repository, revision, unused, unused_git = self.repository()
        captured = []
        def runtime_arguments(arguments, stage, options):
            captured.append(arguments)
            value = json.loads(arguments[-1])
            return json.dumps({"nonRoot": True, "migrationCount": len(value["names"]), "digest": value["digest"]})
        prepare.verify_runtime_inputs(FakeCommands(self.root, runtime_arguments), "factory-qualified:candidate-fixture", repository)
        runtime_code = captured[0][captured[0].index("-c") + 1]
        self.assertEqual(runtime_code.count('pathlib.Path("/app/telemetry-migrations")'), 1)
        # Only redirect the fixed container path into this synthetic image tree;
        # execute the exact code and hash expectations used by docker run.
        runtime_code = runtime_code.replace('pathlib.Path("/app/telemetry-migrations")', 'pathlib.Path(sys.argv[2])')
        with tempfile.TemporaryDirectory(prefix="factory-image-permissions-") as image_parent:
            Path(image_parent).chmod(0o755)  # Only this disposable image-copy boundary.
            image = Path(image_parent) / "synthetic-image"
            shutil.copytree(repository / "deploy/migrations", image)
            def probe():
                return subprocess.run([sys.executable, "-I", "-B", "-c",
                    "import hashlib,json,os,pathlib,sys; p=pathlib.Path(sys.argv[1]); assert os.getuid()==65534; "
                    "names=json.loads((p/'manifest.json').read_bytes()); "
                    "print(hashlib.sha256('\\n'.join(hashlib.sha256((p/n).read_bytes()).hexdigest() for n in names).encode()).hexdigest()); "
                    "assert not os.access(p/'manifest.json',os.W_OK); assert not os.access(p,os.W_OK)", str(image)],
                    user=65534, group=65534, extra_groups=[], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            denied = probe()
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn("PermissionError", denied.stderr)
            def image_guard():
                return subprocess.run([sys.executable, "-I", "-B", "-c", runtime_code, captured[0][-1], str(image)],
                                      user=65534, group=65534, extra_groups=[], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertNotEqual(image_guard().returncode, 0)
            shutil.rmtree(image)
            with prepare.normalized_source_contexts(self.commands(), {"backend": repository}, {"backend": revision}) as contexts:
                shutil.copytree(contexts["backend"] / "deploy/migrations", image)
                allowed = probe()
                self.assertEqual(allowed.returncode, 0, allowed.stderr)
                self.assertEqual((repository / "deploy/migrations/manifest.json").stat().st_mode & 0o777, 0o600)
                expected_hash = hashlib.sha256((repository / "deploy/migrations/one.sql").read_bytes()).hexdigest()
                self.assertEqual(allowed.stdout.strip(), hashlib.sha256(expected_hash.encode()).hexdigest())
                checked = image_guard()
                self.assertEqual(checked.returncode, 0, checked.stderr)
                self.assertEqual(json.loads(checked.stdout), {"nonRoot": True, "migrationCount": 1,
                                                             "digest": hashlib.sha256(expected_hash.encode()).hexdigest()})


class ArchiveIdentityTests(TemporaryTest):
    def setUp(self):
        super().setUp()
        self.sources = {name: source["sha"] for name, source in plan_fixture()["candidate"].items()}
        self.tag = "factory-qualified:candidate-test"
        self.entries, self.image, self.config_id, self.manifest_id = oci_fixture(self.tag, self.sources)
        self.archive = self.root / "candidate.tar.gz"

    def identities(self, **options):
        write_archive(self.archive, self.entries, **options)
        return prepare.oci_identities(self.archive, self.tag, self.image, self.sources)

    def test_real_metadata_digests_match_both_image_inspection_id_conventions(self):
        self.assertEqual(self.identities(), (self.config_id, self.manifest_id))
        self.image["Id"] = self.manifest_id
        self.assertEqual(self.identities(), (self.config_id, self.manifest_id))

    def test_nested_oci_index_is_followed_to_real_manifest(self):
        nested = self.entries["index.json"]
        nested_id = "sha256:" + digest(nested)
        self.entries["blobs/sha256/" + nested_id.split(":")[1]] = nested
        self.entries["index.json"] = encoded({"schemaVersion": 2, "manifests": [{"digest": nested_id}]})
        self.assertEqual(self.identities(), (self.config_id, self.manifest_id))

    def test_classic_docker_save_cannot_supply_fabricated_manifest_identity(self):
        del self.entries["oci-layout"]
        with self.assertRaisesRegex(RuntimeError, "real OCI layout"):
            self.identities()

    def test_tampered_metadata_is_rejected_by_its_content_digest(self):
        config_path = "blobs/sha256/" + self.config_id.split(":")[1]
        configuration = json.loads(self.entries[config_path])
        configuration["config"]["User"] = "root"
        self.entries[config_path] = encoded(configuration)
        with self.assertRaisesRegex(RuntimeError, "metadata digest"):
            self.identities()

    def test_unreachable_manifest_is_not_invented_from_config(self):
        self.entries["index.json"] = encoded({"schemaVersion": 2, "manifests": []})
        with self.assertRaisesRegex(RuntimeError, "exactly one real OCI manifest"):
            self.identities()

    def test_unexpected_tag_or_missing_layer_is_rejected(self):
        manifest = json.loads(self.entries["manifest.json"])
        manifest[0]["RepoTags"].append("unrelated:tag")
        self.entries["manifest.json"] = encoded(manifest)
        with self.assertRaisesRegex(RuntimeError, "unique, owned source tag"):
            self.identities()
        manifest[0]["RepoTags"] = [self.tag]
        self.entries["manifest.json"] = encoded(manifest)
        del self.entries[manifest[0]["Layers"][0]]
        with self.assertRaisesRegex(RuntimeError, "matching archive member"):
            self.identities()

    def test_links_duplicates_and_traversal_are_rejected_without_extraction(self):
        with self.assertRaisesRegex(RuntimeError, "duplicate entries"):
            self.identities(duplicate="oci-layout")
        with self.assertRaisesRegex(RuntimeError, "link or special"):
            self.identities(link="oci-layout")
        self.entries["../outside"] = b"unrelated"
        with self.assertRaisesRegex(RuntimeError, "unsafe top-level"):
            self.identities()
        self.assertFalse((self.root.parent / "outside").exists())

    def test_malformed_json_shapes_are_explicit_failures(self):
        original = copy.deepcopy(self.entries)
        for name, value in (("oci-layout", []), ("manifest.json", [None]), ("index.json", {"manifests": 4})):
            with self.subTest(name=name):
                self.entries = {**original, name: encoded(value)}
                with self.assertRaises(RuntimeError):
                    self.identities()

    def test_saved_image_and_inspection_must_agree(self):
        self.image["Descriptor"]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(RuntimeError, "descriptor does not match"):
            self.identities()

    def test_all_numeric_root_and_root_group_forms_are_rejected(self):
        for user in ("", "root", "root:1000", "0", "0:1000", "000:app"):
            with self.subTest(user=user):
                image = copy.deepcopy(self.image)
                image["Config"]["User"] = user
                with self.assertRaisesRegex(RuntimeError, "non-root"):
                    prepare.validate_image(image, self.sources)


class LifecycleAndExportTests(TemporaryTest):
    def test_previous_permission_policy_receipt_is_refused_without_mutation(self):
        state = {"stateVersion": 1, "planSha256": "d" * 64, "runId": "a" * 32,
                 "tags": {role: "factory-qualified:" + role + "-" + "a" * 32 for role in ("candidate", "rollback")},
                 "ownedImages": {"candidate": "previous-image"}}
        path = self.root / "prepare-state.json"
        path.write_bytes(encoded(state))
        with patch.object(prepare, "Commands") as commands:
            with self.assertRaisesRegex(RuntimeError, "predates the normalized"):
                prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, False)
        commands.assert_not_called()
        self.assertEqual(json.loads(path.read_bytes()), state)

    def test_failed_image_input_guard_never_starts_fixture_or_exports(self):
        paths = {"candidate": {"frontend": self.root / "candidate"}}
        with patch.object(prepare, "verify_source_heads"), \
                patch.object(prepare, "prerequisite_check", return_value={"endpoint": "unix:///local.sock"}), \
                patch.object(prepare, "checkout_sources", return_value=paths), patch.object(prepare, "load_core"), \
                patch.object(prepare, "build_images", side_effect=RuntimeError("non-root migration input denied")), \
                patch.object(prepare, "qualification") as qualification, patch.object(prepare, "export_release") as export:
            with self.assertRaisesRegex(RuntimeError, "non-root migration input denied"):
                prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, False)
        qualification.assert_not_called()
        export.assert_not_called()
        self.assertEqual(json.loads((self.root / "prepare-state.json").read_text())["status"], "FAILED")

    def test_new_work_directory_refuses_unrelated_files_without_mutation(self):
        evidence = self.root / "evidence"
        evidence.mkdir()
        path = evidence / "result.json"
        path.write_bytes(b"unrelated saved result")
        with patch.object(prepare, "Commands") as commands:
            with self.assertRaisesRegex(RuntimeError, "empty work directory"):
                prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, False)
        commands.assert_not_called()
        self.assertEqual(path.read_bytes(), b"unrelated saved result")
        self.assertFalse((self.root / "prepare-state.json").exists())

    def test_existing_work_requires_version_and_plan_bound_receipt(self):
        state = {"stateVersion": 2, "planSha256": "d" * 64, "runId": "a" * 32}
        path = self.root / "prepare-state.json"
        path.write_bytes(encoded(state))
        with patch.object(prepare, "Commands") as commands:
            with self.assertRaisesRegex(RuntimeError, "different or invalid source package"):
                prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, True)
        commands.assert_not_called()
        self.assertEqual(json.loads(path.read_bytes()), state)

    def test_check_only_never_clones_builds_or_imports_vm_core(self):
        with patch.object(prepare, "verify_source_heads"), patch.object(prepare, "prerequisite_check", return_value={}), \
                patch.object(prepare, "checkout_sources") as checkout, patch.object(prepare, "build_images") as build, \
                patch.object(prepare, "load_core") as core:
            result = prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, True)
            state = json.loads((self.root / "prepare-state.json").read_text())
            repeated = prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, True)
        self.assertEqual(result["status"], "PREREQUISITES_PASSED")
        self.assertEqual(result, repeated)
        self.assertEqual(state["runId"], json.loads((self.root / "prepare-state.json").read_text())["runId"])
        self.assertFalse(result["productionAccess"])
        checkout.assert_not_called()
        build.assert_not_called()
        core.assert_not_called()

    def test_failed_qualification_never_exports_or_marks_prepared(self):
        paths = {"candidate": {"frontend": self.root / "candidate"}}
        with patch.object(prepare, "verify_source_heads"), \
                patch.object(prepare, "prerequisite_check", return_value={"endpoint": "unix:///local.sock"}), \
                patch.object(prepare, "checkout_sources", return_value=paths), patch.object(prepare, "load_core"), \
                patch.object(prepare, "build_images"), patch.object(prepare, "qualification", side_effect=RuntimeError("acceptance failed")), \
                patch.object(prepare, "export_release") as export:
            with self.assertRaisesRegex(RuntimeError, "acceptance failed"):
                prepare.prepare(self.root, plan_fixture(), "d" * 64, self.root, SOURCE, False)
        export.assert_not_called()
        self.assertEqual(json.loads((self.root / "prepare-state.json").read_text())["status"], "FAILED")
        self.assertFalse((self.root / "release-manifest.json").exists())

    def test_log_sequence_continues_after_gaps_without_overwriting(self):
        logs = prepare.private_directory(self.root / "logs")
        (logs / "008-earlier.log").write_text("Preserved earlier evidence")
        with patch("builtins.print"):
            result = prepare.Commands(self.root, prepare.clean_environment(os.environ)).run(
                [sys.executable, "-c", "print('synthetic check')"], "Check")
        self.assertEqual(result.stdout.strip(), "synthetic check")
        self.assertTrue((logs / "009-check.log").exists())
        self.assertEqual((logs / "008-earlier.log").read_text(), "Preserved earlier evidence")
        self.assertEqual(stat.S_IMODE((logs / "009-check.log").stat().st_mode), 0o600)

    def export_fixture(self, broken=False):
        plan = plan_fixture()
        evidence = prepare.private_directory(self.root / "evidence")
        state = {"planSha256": "d" * 64, "tags": {role: "factory-qualified:" + role + "-test" for role in ("candidate", "rollback")},
                 "ownedImages": {}}
        fixtures = {}
        for role in state["tags"]:
            sources = {name: value["sha"] for name, value in plan["candidate"].items()} if role == "candidate" else prepare.FALLBACK
            fixtures[role] = oci_fixture(state["tags"][role], sources)
            state["ownedImages"][role] = fixtures[role][1]["Id"]
        core = prepare.load_core(SOURCE.with_name("deploy-vm.py"), SOURCE.parents[1])
        result = {**dict.fromkeys(core.REQUIRED_FLAGS, True), "runtime": runtime({name: value["sha"] for name, value in plan["candidate"].items()}),
                  "image": {"id": fixtures["candidate"][1]["Id"]},
                  "compatibleRollback": {**dict.fromkeys(core.ROLLBACK_FLAGS, True), "runtime": runtime(prepare.FALLBACK),
                                         "qualifiedPriorImage": state["tags"]["rollback"], "restoredCandidateImage": state["tags"]["candidate"],
                                         "industrialObservationCount": 3},
                  "packagedPasswordRecovery": dict.fromkeys(core.RECOVERY_FLAGS, True)}
        if broken:
            result["packagedPasswordRecovery"]["workerSmtpAccepted"] = False
        (evidence / "result.json").write_bytes(encoded(result))
        (evidence / "container-audit.json").write_bytes(encoded({"Metadata": {"ImageID": fixtures["candidate"][1]["Id"]},
                                                               "Results": [{"Target": "synthetic fixture", "Vulnerabilities": []}]}))
        def response(arguments, stage, options):
            role = next(role for role, tag in state["tags"].items() if tag == arguments[-1])
            if arguments[1:3] == ["image", "inspect"]:
                return json.dumps([fixtures[role][1]])
            if arguments[1:3] == ["image", "save"]:
                write_archive(Path(arguments[arguments.index("--output") + 1]), fixtures[role][0], compressed=False)
                return ""
            raise AssertionError("Unexpected command: " + repr(arguments))
        commands = FakeCommands(self.root, response)
        prerequisites = {"hostSystem": "Darwin", "hostArchitecture": "arm64", "dockerVersion": "synthetic-unittest"}
        return commands, plan, state, evidence, core, prerequisites

    def test_exact_seven_file_export_passes_actual_core_verification(self):
        arguments = self.export_fixture()
        bundle, manifest_path = prepare.export_release(*arguments)
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(manifest["artifact"]["sha256"], prepare.file_digest(bundle))
        self.assertEqual(manifest["candidate"]["sourceTag"], arguments[2]["tags"]["candidate"])
        with zipfile.ZipFile(bundle) as archive:
            self.assertEqual(set(archive.namelist()), prepare.MEMBERS)
            self.assertEqual(len(archive.namelist()), 7)
        core = arguments[-2]
        core.M = core.validate_manifest(manifest)
        self.assertEqual(set(core.verify_bundle(bundle)), {"candidate.tar.gz", "rollback.tar.gz"})
        self.assertEqual(stat.S_IMODE(manifest_path.stat().st_mode), 0o600)
        self.assertFalse(list(arguments[3].glob("*.tar.part")))

    def test_missing_real_recovery_flag_blocks_manifest_handoff(self):
        with self.assertRaisesRegex(RuntimeError, "workerSmtpAccepted"):
            prepare.export_release(*self.export_fixture(broken=True))
        self.assertFalse((self.root / "release-manifest.json").exists())

    def test_tested_image_tag_cannot_be_replaced_before_export(self):
        arguments = list(self.export_fixture())
        arguments[2]["ownedImages"]["candidate"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(RuntimeError, "changed before export"):
            prepare.export_release(*arguments)
        self.assertFalse((self.root / "qualified-arm64-bundle.zip").exists())


if __name__ == "__main__":
    unittest.main()
