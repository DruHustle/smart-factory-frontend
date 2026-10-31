"""Offline integrity and lifecycle tests for the assembled manual installer.

Real nested OCI and release ZIP metadata go through the actual deployment core.
All external child commands are mocked; no container or VM is contacted.
"""
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import warnings
import zipfile


SOURCE = Path(__file__).resolve().parents[1] / "manual-installer.py"
spec = importlib.util.spec_from_file_location("manual_installer_test_subject", SOURCE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
fixture_spec = importlib.util.spec_from_file_location("manual_installer_oci_fixtures", Path(__file__).with_name("test_prepare_manual_release.py"))
fixtures = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixtures)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def zip_bytes(entries):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data, mode in entries:
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = mode << 16
                item.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(item, data)
    return output.getvalue()


def archive_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in entries.items():
            item = tarfile.TarInfo(name)
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    return output.getvalue()


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.original_umask = os.umask(0o077)
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.base = self.root / "work"
        self.plan = fixtures.plan_fixture()
        self.members = {"scripts/" + name: (SOURCE.parent / name).read_bytes()
                        for name in ("deploy-vm.py", "prepare-manual-release.py")}
        for name, source in self.plan["candidate"].items():
            data = ("# v2 git bundle\n" + source["sha"] + " " + source["ref"] + "\n\nPACKsynthetic-" + name).encode()
            self.members["source-package/" + name + ".bundle"] = data
            source["bundleSha256"] = hash_bytes(data)
        self.members["source-package/release-plan.json"] = encoded(self.plan)
        self.raw = self.payload_zip()
        self.payload = installer.read_payload(base64.b64encode(self.raw).decode(), hash_bytes(self.raw))

    def tearDown(self):
        self.temporary.cleanup()
        os.umask(self.original_umask)

    def payload_zip(self, members=None, entries=None):
        return zip_bytes(entries if entries is not None else [(name, data, stat.S_IFREG | 0o600)
                         for name, data in (self.members if members is None else members).items()])

    def parse_zip(self, raw):
        return installer.read_payload(base64.b64encode(raw).decode(), hash_bytes(raw))

    def initialized(self):
        with installer.workspace_lock(self.base, self.payload):
            package = installer.install_package(self.base, self.payload)
        return package

    def call_main(self, *arguments):
        with patch.object(installer, "PAYLOAD_SHA256", hash_bytes(self.raw)), \
                patch.object(installer, "PAYLOAD_BASE64", base64.b64encode(self.raw).decode()), \
                patch("builtins.print"):
            return installer.main([*arguments, "--work-dir", str(self.base)])

    def qualified(self, broken_flag=False):
        package = self.base / "package"
        qualification = installer.private_directory(self.base / "qualification", create=True)
        core = installer.load_core(package, self.payload)
        run_id = "d" * 32
        state = {"stateVersion": 1, "status": "PREPARED", "planSha256": self.payload["planSha256"],
                 "runId": run_id, "tags": {role: "factory-qualified:" + role + "-" + run_id
                                          for role in ("candidate", "rollback")}, "ownedImages": {}}
        roles, archive_members, image_ids = {}, {}, {}
        runtime_values = {}
        for role in ("candidate", "rollback"):
            sources = {name: source["sha"] for name, source in self.plan["candidate"].items()} if role == "candidate" else self.plan["rollback"]
            entries, inspection, config_id, manifest_id = fixtures.oci_fixture(state["tags"][role], sources)
            archive = archive_bytes(entries)
            archive_members[role + ".tar.gz"] = archive
            archive_members["image.json" if role == "candidate" else "rollback-image.json"] = encoded([inspection])
            roles[role] = {"sources": sources, "configId": config_id, "manifestId": manifest_id,
                           "archiveSha256": hash_bytes(archive), "sourceTag": state["tags"][role],
                           "schema": {"revision": "0035_industrial_connectivity", "digest": "f" * 64},
                           "capabilities": fixtures.CAPABILITIES.copy()}
            image_ids[role] = inspection["Id"]
            state["ownedImages"][role] = inspection["Id"]
            runtime_values[role] = fixtures.runtime(sources)
        result = {**dict.fromkeys(core.REQUIRED_FLAGS, True), "runtime": runtime_values["candidate"],
                  "image": {"id": image_ids["candidate"]},
                  "compatibleRollback": {**dict.fromkeys(core.ROLLBACK_FLAGS, True),
                      "runtime": runtime_values["rollback"], "industrialObservationCount": 3,
                      "qualifiedPriorImage": state["tags"]["rollback"], "restoredCandidateImage": state["tags"]["candidate"]},
                  "packagedPasswordRecovery": dict.fromkeys(core.RECOVERY_FLAGS, True)}
        if broken_flag:
            result["packagedPasswordRecovery"]["workerSmtpAccepted"] = False
        archive_members["result.json"] = encoded(result)
        archive_members["container-audit.json"] = encoded({"Metadata": {"ImageID": image_ids["candidate"]},
                                                         "Results": [{"Target": "synthetic fixture", "Vulnerabilities": []}]})
        archive_members["archive.sha256"] = "".join(roles[role]["archiveSha256"] + "  " + role + ".tar.gz\n"
                                                     for role in roles).encode()
        raw_bundle = zip_bytes([(name, data, stat.S_IFREG | 0o600) for name, data in archive_members.items()])
        manifest = {"manifestVersion": 1, "artifact": {"sha256": hash_bytes(raw_bundle), "size": len(raw_bundle),
                    "provenance": {"kind": "local-arm64-qualification", "planSha256": self.payload["planSha256"],
                                   "hostSystem": "Darwin", "hostArchitecture": "arm64"}},
                    **roles, "baseline": self.plan["baseline"]}
        installer.write_private(qualification / "release-manifest.json", encoded(manifest))
        installer.write_private(qualification / "qualified-arm64-bundle.zip", raw_bundle)
        installer.write_private(qualification / "prepare-state.json", encoded(state))
        return manifest, state

    def saved_job(self):
        self.initialized()
        self.qualified()
        with patch("builtins.print"):
            manifest, unused, record = installer.verify_qualification(self.base, self.base / "package", self.payload)
        installer.write_private(self.base / "deployment-manifest.json", manifest.read_bytes())
        installer.write_private(self.base / "vm-deployment.json", encoded({"manifestSha256": record["manifestSha256"],
            "directory": "/home/ubuntu/smart-factory-releases/aaaaaaa-20261031T120000Z-12345678"}))
        return record


class PayloadIntegrityTests(InstallerTest):
    def test_valid_payload_inspects_exact_sources_and_target(self):
        result = installer.inspect_payload(self.payload)
        self.assertEqual(result["candidateSources"], {name: value["sha"] for name, value in self.plan["candidate"].items()})
        self.assertEqual(result["fallbackSources"], installer.FALLBACK)
        self.assertEqual(result["target"]["host"], "ubuntu@152.70.22.84")
        self.assertFalse(result["productionAccess"])
        self.assertFalse(self.base.exists())

    def test_outer_hash_and_template_placeholders_are_enforced(self):
        with self.assertRaisesRegex(installer.InstallerError, "checksum"):
            installer.read_payload(base64.b64encode(self.raw + b"changed").decode(), hash_bytes(self.raw))
        with self.assertRaisesRegex(installer.InstallerError, "unassembled"):
            installer.read_payload("__PAYLOAD_BASE64__", "__PAYLOAD_SHA256__")

    def test_bad_base64_and_payload_size_are_bounded(self):
        with self.assertRaisesRegex(installer.InstallerError, "base64"):
            installer.read_payload("%%%", "a" * 64)
        with patch.object(installer, "MAX_PAYLOAD_BYTES", 16):
            with self.assertRaisesRegex(installer.InstallerError, "size limit"):
                self.parse_zip(self.raw)
        with patch.object(installer, "MAX_EXPANDED_BYTES", 1):
            with self.assertRaisesRegex(installer.InstallerError, "expanded"):
                self.parse_zip(self.raw)

    def test_exact_member_set_rejects_traversal_duplicates_missing_and_extras(self):
        entries = [(name, value, stat.S_IFREG | 0o600) for name, value in self.members.items()]
        for changed in (entries[:-1], entries + [entries[0]],
                        [*entries[:-1], ("../outside", b"data", stat.S_IFREG | 0o600)],
                        [*entries, ("extra", b"data", stat.S_IFREG | 0o600)]):
            with self.subTest(names=[entry[0] for entry in changed]):
                with self.assertRaisesRegex(installer.InstallerError, "six reviewed files"):
                    self.parse_zip(self.payload_zip(entries=changed))

    def test_links_special_files_empty_files_and_size_limits_are_rejected(self):
        entries = [(name, value, stat.S_IFREG | 0o600) for name, value in self.members.items()]
        for mode in (stat.S_IFLNK | 0o777, stat.S_IFIFO | 0o600):
            changed = entries.copy()
            changed[0] = (changed[0][0], changed[0][1], mode)
            with self.assertRaisesRegex(installer.InstallerError, "special file"):
                self.parse_zip(self.payload_zip(entries=changed))
        changed = dict(self.members)
        changed["scripts/deploy-vm.py"] = b""
        with self.assertRaisesRegex(installer.InstallerError, "empty"):
            self.parse_zip(self.payload_zip(changed))
        limits = {**installer.MEMBER_LIMITS, "scripts/deploy-vm.py": 1}
        with patch.object(installer, "MEMBER_LIMITS", limits):
            with self.assertRaisesRegex(installer.InstallerError, "size limit"):
                self.parse_zip(self.raw)

    def test_plan_bundle_hash_and_all_source_pins_are_checked(self):
        changed = dict(self.members)
        changed["source-package/frontend.bundle"] += b"changed"
        with self.assertRaisesRegex(installer.InstallerError, "source bundle checksum"):
            self.parse_zip(self.payload_zip(changed))
        for mutation in (lambda plan: plan["candidate"]["frontend"].update(sha="main"),
                         lambda plan: plan["rollback"].update(frontend="0" * 40),
                         lambda plan: plan["candidate"]["frontend"].update(ref="refs/heads/../redirect")):
            plan = copy.deepcopy(self.plan)
            mutation(plan)
            changed = {**self.members, "source-package/release-plan.json": encoded(plan)}
            with self.assertRaises(installer.InstallerError):
                self.parse_zip(self.payload_zip(changed))

    def test_duplicate_plan_fields_are_rejected(self):
        changed = {**self.members, "source-package/release-plan.json": b'{"planVersion":1,"planVersion":2}'}
        with self.assertRaisesRegex(installer.InstallerError, "duplicate fields"):
            self.parse_zip(self.payload_zip(changed))

    def test_inspect_is_default_and_never_accesses_files_or_children(self):
        with patch.object(installer, "workspace_lock") as lock, patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main(), 0)
            self.assertEqual(self.call_main("--inspect"), 0)
        lock.assert_not_called()
        child.assert_not_called()
        self.assertFalse(self.base.exists())


class ExtractionTests(InstallerTest):
    def test_private_exact_extraction_is_idempotent_without_rewriting_files(self):
        package = self.initialized()
        before = {name: (path.stat().st_mtime_ns, path.read_bytes())
                  for name, path in installer.verify_package(package, self.payload).items()}
        with installer.workspace_lock(self.base, self.payload):
            self.assertEqual(installer.install_package(self.base, self.payload), package)
        self.assertEqual(before, {name: (path.stat().st_mtime_ns, path.read_bytes())
                                 for name, path in installer.verify_package(package, self.payload).items()})
        self.assertEqual(stat.S_IMODE(package.stat().st_mode), 0o700)
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in installer.package_inventory(package).values()))

    def test_unrelated_existing_root_is_preserved_without_creating_a_lock(self):
        self.base.mkdir(mode=0o700)
        foreign = self.base / "unrelated.txt"
        foreign.write_bytes(b"keep this")
        with self.assertRaisesRegex(installer.InstallerError, "no matching installer"):
            with installer.workspace_lock(self.base, self.payload):
                self.fail("Unowned root accepted")
        self.assertEqual(list(self.base.iterdir()), [foreign])
        self.assertEqual(foreign.read_bytes(), b"keep this")

    def test_package_mismatch_and_foreign_entries_are_not_overwritten(self):
        package = self.initialized()
        path = package / "scripts/deploy-vm.py"
        path.write_bytes(b"preserve changed source")
        with self.assertRaisesRegex(installer.InstallerError, "differs from the embedded"):
            installer.install_package(self.base, self.payload)
        self.assertEqual(path.read_bytes(), b"preserve changed source")
        path.write_bytes(self.members["scripts/deploy-vm.py"])
        foreign = package / "scripts/unrelated.txt"
        foreign.write_bytes(b"keep")
        with self.assertRaisesRegex(installer.InstallerError, "unrelated entries"):
            installer.install_package(self.base, self.payload)
        self.assertEqual(foreign.read_bytes(), b"keep")

    def test_root_and_parent_symlinks_are_refused(self):
        actual = self.root / "actual"
        actual.mkdir(mode=0o700)
        self.base.symlink_to(actual, target_is_directory=True)
        for candidate in (self.base, self.base / "child"):
            with self.assertRaisesRegex(installer.InstallerError, "redirected"):
                with installer.workspace_lock(candidate, self.payload):
                    self.fail("Symlink accepted")
        self.assertEqual(list(actual.iterdir()), [])

    def test_permissions_are_not_silently_changed(self):
        self.base.mkdir(mode=0o755)
        self.base.chmod(0o755)
        with self.assertRaisesRegex(installer.InstallerError, "0700"):
            with installer.workspace_lock(self.base, self.payload):
                self.fail("Public work directory accepted")
        self.assertEqual(stat.S_IMODE(self.base.stat().st_mode), 0o755)

    def test_matching_partial_package_resumes_but_corrupt_partial_file_is_kept(self):
        with installer.workspace_lock(self.base, self.payload):
            pending = installer.private_directory(self.base / "package.pending", create=True)
            scripts = installer.private_directory(pending / "scripts", create=True)
            path = scripts / "deploy-vm.py"
            installer.write_private(path, b"corrupt preserved partial")
            with self.assertRaisesRegex(installer.InstallerError, "differs from the embedded"):
                installer.install_package(self.base, self.payload)
            self.assertEqual(path.read_bytes(), b"corrupt preserved partial")
            path.write_bytes(self.members["scripts/deploy-vm.py"])
            package = installer.install_package(self.base, self.payload)
        self.assertFalse(pending.exists())
        self.assertEqual(set(installer.verify_package(package, self.payload)), set(installer.MEMBER_LIMITS))

    def test_different_payload_cannot_reuse_an_owned_root(self):
        self.initialized()
        changed = {**self.payload, "sha256": "0" * 64}
        with self.assertRaisesRegex(installer.InstallerError, "different source payload"):
            with installer.workspace_lock(self.base, changed):
                self.fail("Mismatched payload reused")

    def test_core_verification_does_not_write_cache_into_sealed_package(self):
        package = self.initialized()
        installer.load_core(package, self.payload)
        self.assertEqual(set(installer.verify_package(package, self.payload)), set(installer.MEMBER_LIMITS))
        self.assertFalse((package / "scripts/__pycache__").exists())


class LifecycleTests(InstallerTest):
    def test_check_invokes_local_preflight_only(self):
        with patch.object(installer, "run_child", return_value=0) as child:
            self.assertEqual(self.call_main("--check"), 0)
        arguments = child.call_args.args[0]
        self.assertEqual(Path(arguments[0]).name, "prepare-manual-release.py")
        self.assertIn("--check", arguments)
        self.assertNotIn("--deploy", arguments)
        self.assertFalse((self.base / "vm-deployment.json").exists())

    def test_failed_preparation_never_deploys_and_preserves_its_exit_code(self):
        with patch.object(installer, "run_child", return_value=17) as child:
            self.assertEqual(self.call_main("--deploy"), 17)
        self.assertEqual(child.call_count, 1)
        self.assertEqual(Path(child.call_args.args[0][0]).name, "prepare-manual-release.py")
        self.assertFalse((self.base / "deployment-manifest.json").exists())

    def test_invalid_acceptance_evidence_after_preparation_never_calls_vm(self):
        def child(arguments):
            self.assertEqual(Path(arguments[0]).name, "prepare-manual-release.py")
            self.qualified(broken_flag=True)
            return 0
        with patch.object(installer, "run_child", side_effect=child) as run:
            self.assertEqual(self.call_main("--deploy"), 1)
        self.assertEqual(run.call_count, 1)
        self.assertFalse((self.base / "verified-release.json").exists())

    def test_prepare_creates_verified_receipt_after_real_core_gate_without_vm(self):
        def child(arguments):
            self.assertEqual(Path(arguments[0]).name, "prepare-manual-release.py")
            self.qualified()
            return 0
        with patch.object(installer, "run_child", side_effect=child) as run:
            self.assertEqual(self.call_main("--prepare"), 0)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(installer.read_private_json(self.base / "verified-release.json")["status"], "VERIFIED")
        self.assertFalse((self.base / "deployment-manifest.json").exists())

    def test_deploy_reuses_exact_qualification_and_preserves_failure_exit_code(self):
        self.initialized()
        self.qualified()
        with patch.object(installer, "run_child", return_value=1) as child:
            self.assertEqual(self.call_main("--deploy"), 1)
        self.assertEqual(child.call_count, 1)
        arguments = child.call_args.args[0]
        self.assertEqual(Path(arguments[0]).name, "deploy-vm.py")
        self.assertIn("--deploy", arguments)
        self.assertIn(self.base / "vm-deployment.json", arguments)
        self.assertEqual((self.base / "deployment-manifest.json").read_bytes(),
                         (self.base / "qualification/release-manifest.json").read_bytes())
        self.assertEqual(stat.S_IMODE((self.base / "deployment-manifest.json").stat().st_mode), 0o600)

    def test_corrupt_artifact_is_rejected_without_rebuilding_or_vm_access(self):
        self.initialized()
        self.qualified()
        archive = self.base / "qualification/qualified-arm64-bundle.zip"
        archive.write_bytes(archive.read_bytes() + b"corruption")
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--deploy"), 1)
        child.assert_not_called()

    def test_manifest_sources_provenance_and_baseline_must_match_embedded_plan(self):
        self.initialized()
        original, unused = self.qualified()
        path = self.base / "qualification/release-manifest.json"
        for change in (lambda value: value["candidate"]["sources"].update(edge="0" * 40),
                       lambda value: value["rollback"]["sources"].update(backend="0" * 40),
                       lambda value: value["baseline"]["sources"].update(frontend="0" * 40),
                       lambda value: value["artifact"]["provenance"].update(planSha256="0" * 64),
                       lambda value: value["artifact"]["provenance"].update(hostArchitecture="x86_64")):
            modified = copy.deepcopy(original)
            change(modified)
            path.write_bytes(encoded(modified))
            with patch.object(installer, "run_child") as child:
                self.assertEqual(self.call_main("--deploy"), 1)
            child.assert_not_called()

    def test_preparation_receipt_and_unique_image_ownership_are_required(self):
        self.initialized()
        unused, original = self.qualified()
        path = self.base / "qualification/prepare-state.json"
        for change in (lambda state: state.update(planSha256="0" * 64),
                       lambda state: state.update(status="FAILED"),
                       lambda state: state.update(stateVersion=True),
                       lambda state: state["tags"].update(candidate="factory-qualified:candidate-unrelated"),
                       lambda state: state["ownedImages"].update(rollback="sha256:" + "0" * 64)):
            changed = copy.deepcopy(original)
            change(changed)
            path.write_bytes(encoded(changed))
            with patch.object(installer, "run_child") as child:
                self.assertEqual(self.call_main("--deploy"), 1)
            child.assert_not_called()

    def test_incomplete_prior_result_requires_explicit_prepare(self):
        self.initialized()
        self.qualified()
        (self.base / "qualification/qualified-arm64-bundle.zip").unlink()
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--deploy"), 1)
        child.assert_not_called()

    def test_verified_artifact_remains_reusable_after_local_check(self):
        self.initialized()
        self.qualified()
        with patch("builtins.print"):
            installer.verify_qualification(self.base, self.base / "package", self.payload)
        path = self.base / "qualification/prepare-state.json"
        state = installer.read_private_json(path)
        state["status"] = "PREREQUISITES_PASSED"
        path.write_bytes(encoded(state))
        with patch.object(installer, "run_child", return_value=0) as child:
            self.assertEqual(self.call_main("--deploy"), 0)
        self.assertEqual(Path(child.call_args.args[0][0]).name, "deploy-vm.py")

    def test_status_never_builds_or_reads_archive_and_propagates_failed_job(self):
        self.saved_job()
        (self.base / "qualification/qualified-arm64-bundle.zip").unlink()
        (self.base / "qualification/prepare-state.json").unlink()
        with patch.object(installer, "run_child", return_value=1) as child, \
                patch.object(installer, "run_preparation") as prepare, patch.object(installer, "install_package") as extract:
            self.assertEqual(self.call_main("--status", "--once"), 1)
        prepare.assert_not_called()
        extract.assert_not_called()
        arguments = child.call_args.args[0]
        self.assertEqual(Path(arguments[0]).name, "deploy-vm.py")
        self.assertIn("--status", arguments)
        self.assertIn("--once", arguments)
        self.assertNotIn("--bundle", arguments)
        self.assertNotIn("--deploy", arguments)

    def test_status_without_existing_receipt_does_not_initialize_any_directory(self):
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--status"), 1)
        child.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_status_rejects_manifest_or_receipt_drift_before_vm_access(self):
        self.saved_job()
        path = self.base / "vm-deployment.json"
        receipt = installer.read_private_json(path)
        receipt["manifestSha256"] = "0" * 64
        path.write_bytes(encoded(receipt))
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--status"), 1)
        child.assert_not_called()

    def test_existing_vm_job_cannot_trigger_an_implicit_rebuild(self):
        self.saved_job()
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--prepare"), 1)
        child.assert_not_called()
        (self.base / "qualification/qualified-arm64-bundle.zip").unlink()
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--deploy"), 1)
        child.assert_not_called()

    def test_changed_sealed_script_blocks_all_children(self):
        package = self.initialized()
        (package / "scripts/deploy-vm.py").write_bytes(b"changed")
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--check"), 1)
        child.assert_not_called()

    def test_once_requires_status_and_does_not_initialize(self):
        with patch.object(installer, "run_child") as child:
            self.assertEqual(self.call_main("--check", "--once"), 1)
        child.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_child_argv_is_isolated_no_shell_and_drops_app_credentials(self):
        path = self.root / "directory with spaces/child.py"
        with patch.dict(os.environ, {"SMTP_PASSWORD": "private-synthetic", "PYTHONPATH": "/unrelated",
                                     "SSH_AUTH_SOCK": "/private/agent.sock"}), \
                patch.object(installer.subprocess, "run", return_value=subprocess.CompletedProcess([], 7)) as run:
            self.assertEqual(installer.run_child([path, "--status"]), 7)
        arguments = run.call_args.args[0]
        self.assertEqual(arguments, [sys.executable, "-I", "-B", str(path), "--status"])
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertNotIn("SMTP_PASSWORD", run.call_args.kwargs["env"])
        self.assertNotIn("PYTHONPATH", run.call_args.kwargs["env"])
        self.assertEqual(run.call_args.kwargs["env"]["SSH_AUTH_SOCK"], "/private/agent.sock")

    def test_real_isolated_child_import_keeps_sealed_package_without_bytecode(self):
        package = self.initialized()
        code = ("import importlib.util,sys; assert sys.flags.isolated; assert sys.dont_write_bytecode; "
                "p=sys.argv[1]; s=importlib.util.spec_from_file_location('checked_core',p); "
                "m=importlib.util.module_from_spec(s); s.loader.exec_module(m)")
        self.assertEqual(installer.run_child(["-c", code, package / "scripts/deploy-vm.py"]), 0)
        self.assertEqual(set(installer.verify_package(package, self.payload)), set(installer.MEMBER_LIMITS))


if __name__ == "__main__":
    unittest.main()
