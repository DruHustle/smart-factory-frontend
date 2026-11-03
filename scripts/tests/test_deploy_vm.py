"""No-network regression tests for the manual VM release gate and lifecycle."""
import argparse
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
import warnings
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / "deploy-vm.py"
spec = importlib.util.spec_from_file_location("manual_vm_test_subject", SOURCE)
vm = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = vm
spec.loader.exec_module(vm)
env_spec = importlib.util.spec_from_file_location("oracle_env_test_subject", SOURCE.with_name("prepare-oracle-env.py"))
oracle_env = importlib.util.module_from_spec(env_spec)
env_spec.loader.exec_module(oracle_env)

CAPABILITIES = ["password-reset-v1", "account-requests-v1", "account-role-approval-v1",
                "industrial-connectivity-v1", "published-passports-v1"]


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def image_fixture(role, letters):
    sources = dict(zip(("frontend", "backend", "edge"), [letter * 40 for letter in letters]))
    configuration = {"architecture": "arm64", "os": "linux", "config": {
        "User": "app", "Labels": dict(zip(vm.LABELS, sources.values()))}}
    config_bytes = encoded(configuration)
    config_id = "sha256:" + sha(config_bytes)
    descriptor = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                  "config": {"digest": config_id, "size": len(config_bytes),
                             "mediaType": "application/vnd.oci.image.config.v1+json"}, "layers": []}
    manifest_bytes = encoded(descriptor)
    manifest_id = "sha256:" + sha(manifest_bytes)
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for identifier, data in ((config_id, config_bytes), (manifest_id, manifest_bytes)):
            item = tarfile.TarInfo("blobs/sha256/" + identifier.split(":")[1])
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    data = stream.getvalue()
    release = {"sources": sources, "sourceTag": "factory-qualified:" + role + "-unit-test",
               "configId": config_id, "manifestId": manifest_id, "archiveSha256": sha(data),
               "schema": {"revision": "0035_industrial_connectivity", "digest": "d" * 64},
               "capabilities": CAPABILITIES.copy()}
    inspection = {"Id": config_id, "Os": "linux", "Architecture": "arm64", "Config": configuration["config"]}
    return release, data, inspection


def runtime(release):
    return {"contractVersion": 2, "deployment": "bundle", "versioned": True,
            "source": release["sources"]["frontend"], "backendSource": release["sources"]["backend"],
            "edgeSource": release["sources"]["edge"], "schema": {**release["schema"], "ready": True},
            "capabilities": release["capabilities"].copy(), "worker": {"fresh": True, "compatible": True}}


def bundle_fixture(directory):
    candidate, candidate_data, candidate_image = image_fixture("candidate", "abc")
    rollback, rollback_data, rollback_image = image_fixture("rollback", "123")
    baseline = {"sources": {"frontend": "7" * 40, "backend": "8" * 40, "edge": "9" * 40},
                "schema": {"revision": "0034_password_reset_tokens", "digest": "e" * 64},
                "capabilities": [c for c in CAPABILITIES if c != "industrial-connectivity-v1"]}
    manifest = {"manifestVersion": 1, "artifact": {"sha256": "0" * 64, "size": 1,
                "provenance": {"kind": "local-arm64-qualification"}},
                "candidate": candidate, "rollback": rollback, "baseline": baseline}
    result = {**dict.fromkeys(vm.REQUIRED_FLAGS, True), "runtime": runtime(candidate),
              "image": {"id": candidate["configId"]},
              "compatibleRollback": {**dict.fromkeys(vm.ROLLBACK_FLAGS, True), "runtime": runtime(rollback),
                                     "qualifiedPriorImage": rollback["sourceTag"], "restoredCandidateImage": candidate["sourceTag"],
                                     "industrialObservationCount": 3},
              "packagedPasswordRecovery": dict.fromkeys(vm.RECOVERY_FLAGS, True)}
    audit = {"Metadata": {"ImageID": candidate["configId"]}, "Results": [{"Target": "synthetic", "Vulnerabilities": []}]}
    entries = {"candidate.tar.gz": candidate_data, "rollback.tar.gz": rollback_data,
               "archive.sha256": (candidate["archiveSha256"] + "  test-results/arm64/candidate.tar.gz\n" + rollback["archiveSha256"] + "  test-results/arm64/rollback.tar.gz\n").encode(),
               "image.json": encoded([candidate_image]), "rollback-image.json": encoded([rollback_image]),
               "result.json": encoded(result), "container-audit.json": encoded(audit)}
    path = directory / "qualified-arm64-bundle.zip"
    write_bundle(path, entries, manifest)
    return manifest, path, entries


def write_bundle(path, entries, manifest, duplicate=None, symlink=None):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in entries.items():
                item = zipfile.ZipInfo(name)
                item.external_attr = ((stat.S_IFLNK if name == symlink else stat.S_IFREG) | 0o600) << 16
                archive.writestr(item, data)
            if duplicate:
                archive.writestr(duplicate, entries[duplicate])
    manifest["artifact"].update(size=path.stat().st_size, sha256=vm.digest_file(path))


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.manifest, self.bundle, self.entries = bundle_fixture(self.root)
        vm.M = vm.validate_manifest(self.manifest)

    def tearDown(self):
        self.temporary.cleanup()

    def rewrite(self, mutate=None, **options):
        if mutate:
            value = json.loads(self.entries[mutate[0]])
            mutate[1](value)
            self.entries[mutate[0]] = encoded(value)
        write_bundle(self.bundle, self.entries, self.manifest, **options)
        vm.M = vm.validate_manifest(self.manifest)

    def test_complete_bundle_extracts_only_verified_owner_private_files(self):
        destination = self.root / "verified"
        checksums = vm.verify_bundle(self.bundle, destination)
        self.assertEqual(set(checksums), {"candidate.tar.gz", "rollback.tar.gz"})
        self.assertEqual({path.name for path in destination.iterdir()}, vm.MEMBERS)
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o700)
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in destination.iterdir()))

    def test_outer_zip_byte_change_is_rejected_before_extraction(self):
        self.bundle.write_bytes(self.bundle.read_bytes() + b"changed")
        with self.assertRaisesRegex(RuntimeError, "checksum or size"):
            vm.verify_bundle(self.bundle, self.root / "no-output")
        self.assertFalse((self.root / "no-output").exists())

    def test_missing_or_traversal_entry_cannot_be_extracted(self):
        self.entries["../result.json"] = self.entries.pop("result.json")
        self.rewrite()
        with self.assertRaisesRegex(RuntimeError, "unexpected, duplicate or missing"):
            vm.verify_bundle(self.bundle)

    def test_duplicate_zip_entry_is_rejected(self):
        self.rewrite(duplicate="result.json")
        with self.assertRaisesRegex(RuntimeError, "unexpected, duplicate or missing"):
            vm.verify_bundle(self.bundle)

    def test_zip_symbolic_link_is_rejected(self):
        self.rewrite(symlink="result.json")
        with self.assertRaisesRegex(RuntimeError, "link or unsupported"):
            vm.verify_bundle(self.bundle)

    def test_inner_archive_checksum_is_independently_pinned(self):
        self.entries["candidate.tar.gz"] += b"tampered"
        self.rewrite()
        with self.assertRaisesRegex(RuntimeError, "archive bytes"):
            vm.verify_bundle(self.bundle)

    def test_qualification_cannot_silently_drop_industrial_rollback_preservation(self):
        self.rewrite(("result.json", lambda value: value["compatibleRollback"].pop("industrialObservationsPreserved")))
        with self.assertRaisesRegex(RuntimeError, "industrialObservationsPreserved"):
            vm.verify_bundle(self.bundle)

    def test_fallback_must_accept_new_industrial_data_not_only_preserve_existing_rows(self):
        self.rewrite(("result.json", lambda value: value["compatibleRollback"].pop("industrialFallbackIngestionVerified")))
        with self.assertRaisesRegex(RuntimeError, "industrialFallbackIngestionVerified"):
            vm.verify_bundle(self.bundle)

    def test_fallback_requires_three_actual_observations_across_release_stages(self):
        for count in (None, 0, 2, 4, True, "3"):
            with self.subTest(count=count):
                self.rewrite(("result.json", lambda value: value["compatibleRollback"].update(industrialObservationCount=count)))
                with self.assertRaisesRegex(RuntimeError, "all three industrial observations"):
                    vm.verify_bundle(self.bundle)

    def test_fallback_runtime_is_qualified_independently_from_installed_baseline(self):
        self.rewrite(("result.json", lambda value: value["compatibleRollback"].update(runtime=runtime(vm.M["baseline"]))))
        with self.assertRaisesRegex(RuntimeError, "fallback runtime"):
            vm.verify_bundle(self.bundle)

    def test_fallback_test_references_must_bind_the_actual_archives(self):
        self.rewrite(("result.json", lambda value: value["compatibleRollback"].update(qualifiedPriorImage="unrelated:tag")))
        with self.assertRaisesRegex(RuntimeError, "different image references"):
            vm.verify_bundle(self.bundle)

    def test_missing_packaged_password_recovery_is_rejected(self):
        self.rewrite(("result.json", lambda value: value["packagedPasswordRecovery"].update(newPasswordIdentityVerified=False)))
        with self.assertRaisesRegex(RuntimeError, "newPasswordIdentityVerified"):
            vm.verify_bundle(self.bundle)

    def test_qualification_image_must_match_its_artifact(self):
        self.rewrite(("result.json", lambda value: value["image"].update(id="sha256:" + "f" * 64)))
        with self.assertRaisesRegex(RuntimeError, "exact candidate image"):
            vm.verify_bundle(self.bundle)

    def test_image_labels_cannot_differ_from_verified_source(self):
        self.rewrite(("image.json", lambda value: value[0]["Config"]["Labels"].update({vm.LABELS[0]: "f" * 40})))
        with self.assertRaisesRegex(RuntimeError, "source label"):
            vm.verify_bundle(self.bundle)

    def test_root_user_with_nonroot_group_is_rejected(self):
        self.rewrite(("image.json", lambda value: value[0]["Config"].update(User="root:1000")))
        with self.assertRaisesRegex(RuntimeError, "non-root"):
            vm.verify_bundle(self.bundle)

    def test_containerd_manifest_image_id_is_accepted_only_when_pinned(self):
        self.rewrite(("image.json", lambda value: value[0].update(Id=vm.M["candidate"]["manifestId"], Descriptor={"digest": vm.M["candidate"]["manifestId"]})))
        vm.verify_bundle(self.bundle)

    def test_high_vulnerability_or_wrong_audited_image_blocks_release(self):
        for mutation in (lambda value: value["Results"][0].update(Vulnerabilities=[{"Severity": "HIGH"}]),
                         lambda value: value["Metadata"].update(ImageID="sha256:" + "f" * 64)):
            with self.subTest(mutation=mutation):
                self.entries["container-audit.json"] = encoded({"Metadata": {"ImageID": vm.M["candidate"]["configId"]}, "Results": [{"Vulnerabilities": []}]})
                self.rewrite(("container-audit.json", mutation))
                with self.assertRaises(RuntimeError):
                    vm.verify_bundle(self.bundle)

    def test_unknown_installed_sources_and_stale_worker_are_not_accepted(self):
        value = runtime(vm.M["baseline"])
        self.assertTrue(vm.runtime_matches(value, vm.M["baseline"], True))
        value["source"] = "f" * 40
        self.assertFalse(vm.runtime_matches(value, vm.M["baseline"], True))
        value = runtime(vm.M["candidate"])
        value["worker"]["fresh"] = False
        self.assertFalse(vm.runtime_matches(value, vm.M["candidate"], True))

    def test_manifest_refuses_fallback_without_current_industrial_capability(self):
        self.manifest["rollback"]["capabilities"].remove("industrial-connectivity-v1")
        with self.assertRaisesRegex(RuntimeError, "industrial capabilities"):
            vm.validate_manifest(self.manifest)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        vm.configure_origins()
        vm.configure_ssh_target()
        self.addCleanup(vm.configure_origins)
        self.addCleanup(vm.configure_ssh_target)

    def test_custom_origins_are_validated_and_do_not_inherit_the_legacy_alias(self):
        vm.configure_origins("https://api.onesa.eu/", "https://factory.onesa.eu/")
        self.assertEqual(vm.deployment_origins(), {"api": "https://api.onesa.eu", "ui": "https://factory.onesa.eu"})
        self.assertEqual(vm.UI_CANONICAL_ALIAS, "")
        source = vm.UI_ORIGIN + "/release.json"
        opener = Mock()
        opener.open.side_effect = vm.urllib.error.HTTPError(source, 307, "redirect",
            {"Location": vm.DEFAULT_UI_CANONICAL_ALIAS + "/release.json"}, io.BytesIO())
        with patch.object(vm.urllib.request, "build_opener", return_value=opener):
            self.assertIsNone(vm._runtime_http(source, True))
        self.assertEqual(opener.open.call_count, 1)

    def test_invalid_origins_stop_before_manifest_loading_or_remote_work(self):
        for value in ("http://factory.onesa.eu", "https://user:secret@factory.onesa.eu", "https://factory.onesa.eu/path",
                      "https://@factory.onesa.eu", "https://factory.onesa.eu:",
                      "https://factory.onesa.eu/#", "https://factory.onesa.eu?", "https://factory.onesa.eu,https://other.example",
                      "https://factory.onesa.eu:0", "https://factory.onesa.eu:70000", "https://factory.invalid", "https://factory.onesa.eu\n"):
            with self.subTest(value=value), patch.object(vm, "validate_manifest") as manifest, \
                 patch.object(vm, "run_client") as run, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(vm.main(["--api-origin", value]), 1)
                manifest.assert_not_called()
                run.assert_not_called()

    def test_receipts_bind_origins_and_legacy_receipts_keep_the_old_target(self):
        vm.assert_receipt_target({})
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        with self.assertRaisesRegex(RuntimeError, "different origins"):
            vm.assert_receipt_target({})
        vm.assert_receipt_target({"origins": vm.deployment_origins()})
        with self.assertRaisesRegex(RuntimeError, "different origins"):
            vm.assert_receipt_target({"origins": {"api": vm.API_ORIGIN, "ui": vm.DEFAULT_UI_ORIGIN}})

    def test_explicit_ssh_target_is_one_destination_and_invalid_values_stop_before_manifest_loading(self):
        for target in ("ubuntu@192.0.2.10", "factory-owner@onesa-oracle", "onesa-oracle"):
            vm.configure_ssh_target(target)
            self.assertEqual(vm.HOST, target)
        for target in ("", "ssh://owner@host", "owner@host:22", "one@@host", "-oProxyCommand=command",
                       "host other", "host\nother", "$(command)", "../host", "host;command"):
            with self.subTest(target=target), patch.object(vm, "validate_manifest") as manifest, \
                 patch.object(vm, "run_client") as run, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(vm.main(["--ssh-target=" + target]), 1)
                manifest.assert_not_called()
                run.assert_not_called()

    def test_legacy_receipts_remain_bound_to_the_original_ssh_target(self):
        vm.assert_receipt_target({})
        vm.configure_ssh_target("onesa-oracle")
        with self.assertRaisesRegex(RuntimeError, "different SSH target"):
            vm.assert_receipt_target({})
        vm.assert_receipt_target(vm.deployment_target())
        with self.assertRaisesRegex(RuntimeError, "different SSH target"):
            vm.assert_receipt_target({**vm.deployment_target(), "sshTarget": "other-oracle"})

    def test_remote_release_directory_accepts_owner_homes_without_accepting_unsafe_paths(self):
        suffix = "/smart-factory-releases/aaaaaaa-20261103T120000Z-12345678"
        for home in ("/home/ubuntu", "/home/factory-owner", "/root", "/srv/owners/factory"):
            vm.validate_remote_directory(home + suffix)
        for value in (None, "relative" + suffix, "/home/../root" + suffix, "/home/$(command)" + suffix,
                      "/home/space name" + suffix, "/home//owner" + suffix, "//home/owner" + suffix,
                      "/home/owner" + suffix + "/extra", "/home/owner" + suffix + ";command"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "unexpected release directory"):
                vm.validate_remote_directory(value)

    def test_public_snapshot_accepts_only_the_verified_alias_without_chains(self):
        source = vm.UI_ORIGIN + "/release.json"
        target = vm.UI_CANONICAL_ALIAS + "/release.json"
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.read.return_value = b'{"ok":true}'
        opener = Mock()
        opener.open.side_effect = [
            vm.urllib.error.HTTPError(source, 307, "redirect", {"Location": target}, io.BytesIO()), response,
        ]
        with patch.object(vm.urllib.request, "build_opener", return_value=opener):
            self.assertEqual(vm._runtime_http(source, True), {"ok": True})
        self.assertEqual([call.args[0].full_url for call in opener.open.call_args_list], [source, target])

        for first, location in ((source, "https://example.com/release.json"),
                                (vm.API_ORIGIN + "/release.json", target)):
            opener = Mock()
            opener.open.side_effect = vm.urllib.error.HTTPError(first, 307, "redirect", {"Location": location}, io.BytesIO())
            with patch.object(vm.urllib.request, "build_opener", return_value=opener):
                self.assertIsNone(vm._runtime_http(first, True))
            self.assertEqual(opener.open.call_count, 1)

        opener = Mock()
        opener.open.side_effect = [
            vm.urllib.error.HTTPError(source, 307, "redirect", {"Location": target}, io.BytesIO()),
            vm.urllib.error.HTTPError(target, 307, "redirect", {"Location": "https://example.com/"}, io.BytesIO()),
        ]
        with patch.object(vm.urllib.request, "build_opener", return_value=opener):
            self.assertIsNone(vm._runtime_http(source, True))
        self.assertEqual(opener.open.call_count, 2)

    def test_environment_patch_preserves_literal_secret_bytes_and_crlf(self):
        original = b'# retained\r\nSMTP_PASSWORD=pa$$word"#\\more\r\nBACKEND_IMAGE=old:tag\r\nPRIVATE_TOKEN=never-print-me'
        result = vm.patch_env_bytes(original, {"BACKEND_IMAGE": "factory-qualified:candidate-abc"})
        self.assertEqual(result, original.replace(b"BACKEND_IMAGE=old:tag", b"BACKEND_IMAGE=factory-qualified:candidate-abc"))

    def test_duplicate_environment_target_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            vm.patch_env_bytes(b"BACKEND_IMAGE=one\nexport BACKEND_IMAGE=two\n", {"BACKEND_IMAGE": "safe:tag"})

    def test_environment_target_cannot_inject_shell_or_newline(self):
        for value in ("x\nSMTP_PASSWORD=changed", "$(touch /tmp/unwanted)", "`command`"):
            with self.assertRaisesRegex(RuntimeError, "nonsecret"):
                vm.patch_env_bytes(b"", {"BACKEND_IMAGE": value})

    def test_atomic_write_refuses_state_drift_and_preserves_newer_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / ".env"
            target.write_bytes(b"BACKEND_IMAGE=old\n")
            target.chmod(0o600)
            previous = vm.file_state(target)
            target.write_bytes(b"BACKEND_IMAGE=concurrent-edit\n")
            with self.assertRaisesRegex(RuntimeError, "changed before"):
                vm.replace_live_file(target, previous, b"BACKEND_IMAGE=new\n")
            self.assertEqual(target.read_bytes(), b"BACKEND_IMAGE=concurrent-edit\n")

    def test_atomic_write_keeps_owner_permissions(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / ".env"
            target.write_bytes(b"BACKEND_IMAGE=old\n")
            target.chmod(0o600)
            before = vm.file_state(target)
            vm.replace_live_file(target, before, b"BACKEND_IMAGE=new\n")
            after = vm.file_state(target)
            self.assertEqual((after["uid"], after["gid"], after["mode"]), (before["uid"], before["gid"], 0o600))

    def test_compose_extension_normalization_does_not_hide_environment_drift(self):
        value = {"x-runtime": {"ignored": True}, "services": {"api": {"x-meta": {}, "environment": {"x-secret": "retained"}}}}
        self.assertEqual(vm.without_extensions(value), {"services": {"api": {"environment": {"x-secret": "retained"}}}})

    def mail(self):
        api = {"DASHBOARD_SERVICE_TOKEN": "s" * 40, "BACKEND_DEPLOYMENT_MODE": "render-bundle",
               "EMAIL_PROVIDER": "smtp", "ALLOWED_ORIGIN": vm.UI_ORIGIN}
        worker = {"DASHBOARD_SERVICE_TOKEN": "s" * 40, "EMAIL_PROVIDER": "smtp", "SMTP_USERNAME": "synthetic",
                  "SMTP_PASSWORD": "synthetic-secret", "SMTP_FROM": "synthetic@example.test", "SMTP_ALLOWED_RECIPIENTS": "person@example.test"}
        return api, worker

    def test_delivery_flag_comes_from_provider_presence_and_preserves_policy(self):
        api, worker = self.mail()
        original = copy.deepcopy((api, worker))
        updates, worker_updates, summary = vm.mail_configuration_plan(api, worker)
        self.assertEqual(updates, {"EMAIL_DELIVERY_CONFIGURED": "true", "PASSWORD_RESET_ORIGIN": vm.UI_ORIGIN})
        self.assertEqual(worker_updates, {"PASSWORD_RESET_ORIGIN": vm.UI_ORIGIN})
        self.assertEqual((api, worker), original)
        self.assertFalse(summary["mailDeliveryTested"])
        worker.pop("SMTP_PASSWORD")
        self.assertEqual(vm.mail_configuration_plan(api, worker)[0]["EMAIL_DELIVERY_CONFIGURED"], "false")

    def test_no_recipient_policy_never_enables_mail_delivery(self):
        api, worker = self.mail()
        worker.pop("SMTP_ALLOWED_RECIPIENTS")
        self.assertEqual(vm.mail_configuration_plan(api, worker)[0]["EMAIL_DELIVERY_CONFIGURED"], "false")

    def test_cutover_allowlist_requires_one_explicit_reset_origin_on_both_processes(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        api, worker = self.mail()
        api["ALLOWED_ORIGIN"] = vm.DEFAULT_UI_ORIGIN + "," + vm.UI_ORIGIN
        with self.assertRaisesRegex(RuntimeError, "explicit PASSWORD_RESET_ORIGIN"):
            vm.mail_configuration_plan(api, worker)
        api["PASSWORD_RESET_ORIGIN"] = vm.UI_ORIGIN
        with self.assertRaisesRegex(RuntimeError, "both API and worker"):
            vm.mail_configuration_plan(api, worker)
        worker["PASSWORD_RESET_ORIGIN"] = vm.UI_ORIGIN
        updates, worker_updates, summary = vm.mail_configuration_plan(api, worker)
        self.assertEqual(updates, {"EMAIL_DELIVERY_CONFIGURED": "true"})
        self.assertEqual(worker_updates, {})
        self.assertEqual(summary["expectedResetPolicy"], "email")
        api["ALLOWED_ORIGIN"] = vm.DEFAULT_UI_ORIGIN
        with self.assertRaisesRegex(RuntimeError, "selected UI origin"):
            vm.mail_configuration_plan(api, worker)

    def test_mail_plan_requires_the_exact_nonempty_api_browser_allowlist(self):
        for value in (None, "", " ", ",, ", vm.UI_ORIGIN + "/", "https://other.example"):
            api, worker = self.mail()
            if value is None:
                api.pop("ALLOWED_ORIGIN")
            else:
                api["ALLOWED_ORIGIN"] = value
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "ALLOWED_ORIGIN"):
                vm.mail_configuration_plan(api, worker)
        api, worker = self.mail()
        api["ALLOWED_ORIGIN"] = " , " + vm.UI_ORIGIN + ", "
        self.assertEqual(vm.mail_configuration_plan(api, worker)[0]["EMAIL_DELIVERY_CONFIGURED"], "true")

    def test_effective_worker_callback_uses_resolved_compose_precedence(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        image = {"Config": {"Env": ["ALLOWED_ORIGIN=" + vm.UI_ORIGIN, "DASHBOARD_API_ORIGIN=" + vm.API_ORIGIN]}}
        configuration = {"services": {"api": {"environment": {}}, "worker": {"environment": {}}}}
        vm.require_effective_origins(image, configuration)
        for value in (None, "", vm.DEFAULT_API_ORIGIN, vm.API_ORIGIN + "/api", "https://secret@" + "api.onesa.eu"):
            configuration["services"]["worker"]["environment"]["DASHBOARD_API_ORIGIN"] = value
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "DASHBOARD_API_ORIGIN"):
                vm.require_effective_origins(image, configuration)
        configuration["services"]["worker"]["environment"]["DASHBOARD_API_ORIGIN"] = vm.API_ORIGIN
        vm.require_effective_origins(image, configuration)

    def test_real_snapshot_rejects_effective_origin_drift_before_public_checks_or_service_changes(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        previous_manifest = vm.M
        self.addCleanup(setattr, vm, "M", previous_manifest)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, _, _ = bundle_fixture(root)
            vm.M = vm.validate_manifest(manifest)
            deploy = root / "deployment"
            deploy.mkdir()
            for name in vm.FILE_NAMES:
                (deploy / name).write_bytes(b"private fixture\n")
                (deploy / name).chmod(0o600)
            original = {name: (deploy / name).read_bytes() for name in vm.FILE_NAMES}
            image = {"Id": "installed-id", "Os": "linux", "Architecture": "arm64",
                     "Config": {"Labels": dict(zip(vm.LABELS, vm.sources(vm.M["baseline"]))),
                                "Env": ["ALLOWED_ORIGIN=" + vm.UI_ORIGIN, "DASHBOARD_API_ORIGIN=" + vm.API_ORIGIN]}}
            for role, key, value in (("api", "ALLOWED_ORIGIN", None), ("api", "ALLOWED_ORIGIN", ""),
                                     ("api", "ALLOWED_ORIGIN", vm.UI_ORIGIN + "/"),
                                     ("worker", "DASHBOARD_API_ORIGIN", vm.DEFAULT_API_ORIGIN)):
                configuration = {"services": {name: {"image": "installed-id", "environment": {}} for name in ("api", "worker")}}
                configuration["services"][role]["environment"][key] = value
                containers = {name: {"Id": name + "-id", "Image": "installed-id",
                                     "State": {"Health": {"Status": "healthy"}},
                                     "Config": {"Env": [k + "=" + v for k, v in vm.effective_environment(image, configuration["services"][name]).items()]}}
                              for name in ("api", "worker")}
                with self.subTest(role=role, value=value), contextlib.ExitStack() as stack:
                    stack.enter_context(patch.object(vm, "DEPLOY", deploy))
                    stack.enter_context(patch.object(vm.os, "uname", return_value=Mock(machine="aarch64")))
                    stack.enter_context(patch.object(vm.shutil, "disk_usage", return_value=Mock(free=8 * 1024**3)))
                    docker = stack.enter_context(patch.object(vm, "docker", return_value=subprocess.CompletedProcess([], 0, '"unix:///var/run/docker.sock"')))
                    compose = stack.enter_context(patch.object(vm, "compose", return_value=subprocess.CompletedProcess([], 0, "2.30.0")))
                    stack.enter_context(patch.object(vm, "deployment_container", side_effect=lambda name, **kw: containers[name]))
                    stack.enter_context(patch.object(vm, "assert_no_other_worker"))
                    stack.enter_context(patch.object(vm, "inspect_image", return_value=image))
                    stack.enter_context(patch.object(vm, "compose_configuration", return_value=configuration))
                    public = stack.enter_context(patch.object(vm, "public_json"))
                    frontend = stack.enter_context(patch.object(vm, "frontend_snapshot"))
                    with self.assertRaisesRegex(RuntimeError, key):
                        vm.snapshot_current()
                    public.assert_not_called()
                    frontend.assert_not_called()
                    docker.assert_called_once_with("context", "inspect", "--format", "{{json .Endpoints.docker.Host}}")
                    compose.assert_called_once_with("version", "--short")
                    self.assertEqual({name: (deploy / name).read_bytes() for name in vm.FILE_NAMES}, original)

    def test_resend_configuration_stays_on_worker_and_requires_a_recipient_policy(self):
        api, worker = self.mail()
        api["EMAIL_PROVIDER"] = "resend"
        worker = {"DASHBOARD_SERVICE_TOKEN": "s" * 40, "EMAIL_PROVIDER": "resend",
                  "RESEND_API_KEY": "re_synthetic", "RESEND_FROM": "Factory <factory@onesa.eu>",
                  "RESEND_ALLOWED_RECIPIENT_DOMAINS": "onesa.eu"}
        updates, _, summary = vm.mail_configuration_plan(api, worker)
        self.assertEqual(updates["EMAIL_DELIVERY_CONFIGURED"], "true")
        self.assertNotIn("RESEND_API_KEY", updates)
        self.assertFalse(summary["mailDeliveryTested"])
        worker.pop("RESEND_ALLOWED_RECIPIENT_DOMAINS")
        self.assertEqual(vm.mail_configuration_plan(api, worker)[0]["EMAIL_DELIVERY_CONFIGURED"], "false")

    def test_reset_origin_path_or_list_is_not_silently_normalized(self):
        for value in (vm.UI_ORIGIN + "/#/reset-password", vm.UI_ORIGIN + ",https://factory.onesa.eu"):
            api, worker = self.mail()
            worker["PASSWORD_RESET_ORIGIN"] = value
            with self.assertRaisesRegex(RuntimeError, "plain HTTPS origin"):
                vm.mail_configuration_plan(api, worker)

    def test_reset_origin_provider_or_service_token_drift_requires_review(self):
        for change in ({"PASSWORD_RESET_ORIGIN": "https://different.example"}, {"EMAIL_PROVIDER": "resend"}, {"DASHBOARD_SERVICE_TOKEN": "t" * 40}):
            api, worker = self.mail()
            worker.update(change)
            with self.assertRaises(RuntimeError):
                vm.mail_configuration_plan(api, worker)

    def test_lock_serializes_independent_deployment_attempts(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "release"
            directory.mkdir(mode=0o700)
            with vm.release_lock(directory):
                with self.assertRaisesRegex(RuntimeError, "in progress"):
                    with vm.release_lock(directory):
                        pass


class FakeDeployment(vm.Deployment):
    def __init__(self, directory, fail=None):
        super().__init__(directory)
        self.events = []
        self.fail = fail
        self.state = {"candidateImageId": "candidate-id", "rollbackImageId": "fallback-id", "currentImageId": "old-id",
                      "frontendBefore": {"source": "f" * 40}, "expectedResetPolicy": "email"}
        self.original = dict.fromkeys(vm.FILE_NAMES, b"BACKEND_IMAGE=old\nSECRET=retained\n")
        self.planned = dict(self.original)
        self.planned_configuration = {}
        self.checks = Mock()
        self.checks.wait_api.side_effect = lambda image_id, candidate: self.step("api-ready:" + image_id)
        self.checks.wait_worker.side_effect = self.worker_ready
        self.progress = lambda *args: None

    def step(self, value):
        self.events.append(value)
        if self.fail == value:
            raise RuntimeError("Synthetic failure at " + value)

    def worker_ready(self, image_id, candidate):
        self.step("worker-ready:" + image_id)
        return {"runtime": {}, "receipt": {}, "containers": {}}

    def preflight(self):
        self.step("preflight")

    def assert_files(self):
        pass

    def assert_frontend_unchanged(self):
        pass

    def stop_worker(self):
        self.step("stop-worker")

    def install(self, files):
        self.step("install-fallback" if b"rollback-" in files[".env"] else "install-candidate")

    def start_role(self, role, image_id):
        self.step("start-" + role + ":" + image_id)

    def verify_running_environments(self, image_id):
        self.step("verify:" + image_id)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name) / "aaaaaaa-20261031T230000Z-12345678"
        self.directory.mkdir(mode=0o700)
        manifest, _, _ = bundle_fixture(self.directory)
        vm.M = vm.validate_manifest(manifest)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.object(vm, "compose_configuration", return_value={}))
        self.stack.enter_context(patch.object(vm, "public_json", return_value={"result": {"data": {"json": {"delivery": "email"}}}}))
        self.stack.enter_context(patch.object(vm, "inspect_image", return_value={}))
        self.stack.enter_context(patch.object(vm, "check_image", return_value="fallback-id"))

    def tearDown(self):
        self.stack.close()
        self.temporary.cleanup()

    def test_worker_is_stopped_before_api_and_only_started_after_readiness(self):
        deployment = FakeDeployment(self.directory)
        report = vm.execute_deployment(deployment)
        self.assertEqual(report["status"], "BACKEND_DEPLOYED")
        self.assertEqual(deployment.events, ["preflight", "stop-worker", "install-candidate", "start-api:candidate-id",
            "api-ready:candidate-id", "start-worker:candidate-id", "worker-ready:candidate-id", "verify:candidate-id"])
        self.assertFalse(report["databaseBackupCreated"])
        self.assertFalse(report["frontendPublished"])

    def test_api_failure_uses_qualified_fallback_not_unqualified_installed_image(self):
        deployment = FakeDeployment(self.directory, "api-ready:candidate-id")
        report = vm.execute_deployment(deployment)
        self.assertEqual(report["status"], "ROLLED_BACK")
        self.assertEqual(deployment.events[-7:], ["stop-worker", "install-fallback", "start-api:fallback-id",
            "api-ready:fallback-id", "start-worker:fallback-id", "worker-ready:fallback-id", "verify:fallback-id"])
        self.assertNotIn("start-worker:candidate-id", deployment.events)
        self.assertEqual(vm.status_exit_code(report), 1)

    def test_worker_failure_stops_worker_again_before_fallback_api(self):
        deployment = FakeDeployment(self.directory, "worker-ready:candidate-id")
        report = vm.execute_deployment(deployment)
        self.assertEqual(report["status"], "ROLLED_BACK")
        self.assertEqual(deployment.events.count("stop-worker"), 2)
        self.assertLess(deployment.events.index("install-fallback"), deployment.events.index("start-worker:fallback-id"))

    def test_preflight_failure_never_stops_or_rolls_back_services(self):
        deployment = FakeDeployment(self.directory, "preflight")
        report = vm.execute_deployment(deployment)
        self.assertEqual(report["status"], "STOPPED_BEFORE_CHANGES")
        self.assertEqual(deployment.events, ["preflight"])

    def test_failed_rollback_is_reported_as_needing_review(self):
        deployment = FakeDeployment(self.directory, "api-ready:candidate-id")
        deployment.rollback = Mock(side_effect=RuntimeError("Synthetic rollback failure"))
        self.assertEqual(vm.execute_deployment(deployment)["status"], "NEEDS_REVIEW")

    def test_frontend_drift_stops_a_role_before_any_compose_mutation(self):
        deployment = vm.Deployment(self.directory)
        deployment.state = {"frontendBefore": {"source": "expected"}}
        deployment.assert_files = Mock()
        with patch.object(vm, "frontend_snapshot", return_value={"source": "changed"}), patch.object(vm, "compose") as command:
            with self.assertRaisesRegex(RuntimeError, "frontend changed"):
                deployment.start_role("api", "candidate-id")
            command.assert_not_called()

    def test_multiple_worker_containers_are_rejected_before_inspection(self):
        with patch.object(vm, "docker", return_value=subprocess.CompletedProcess([], 0, "one\ntwo\n", "")) as command:
            with self.assertRaisesRegex(RuntimeError, "More than one worker"):
                vm.assert_worker_stopped()
            self.assertEqual(command.call_count, 1)


class EnvironmentPreparationTests(unittest.TestCase):
    def snapshot(self):
        shared = {"DATABASE_URL": "postgres://synthetic@db.example/factory", "INGESTION_API_TOKEN": "synthetic-ingest",
                  "DASHBOARD_SERVICE_TOKEN": "s" * 40, "EMAIL_PROVIDER": "resend"}
        api = {**shared, "ALLOWED_ORIGIN": vm.DEFAULT_UI_ORIGIN, "DATABASE_CA_CERT": "first-line\nsecond-line"}
        worker = {**shared, "MqttClientId": "existing-singleton", "RESEND_API_KEY": "re_literal$#\\secret",
                  "RESEND_FROM": "Factory <factory@onesa.eu>", "RESEND_ALLOWED_RECIPIENT_DOMAINS": "onesa.eu"}
        return {role: {"variables": [{"key": key, "value": value} for key, value in values.items()]}
                for role, values in (("api", api), ("worker", worker))}

    def test_default_preparation_retains_credentials_and_existing_origin_policy(self):
        snapshot = self.snapshot()
        original = copy.deepcopy(snapshot)
        result = oracle_env.prepare_environments(snapshot)
        self.assertEqual(snapshot, original)
        self.assertEqual(result["worker"]["DASHBOARD_API_ORIGIN"], vm.DEFAULT_API_ORIGIN)
        self.assertNotIn("PASSWORD_RESET_ORIGIN", result["api"])
        self.assertEqual(result["api"]["ALLOWED_ORIGIN"], vm.DEFAULT_UI_ORIGIN)
        self.assertEqual(result["worker"]["RESEND_API_KEY"], "re_literal$#\\secret")
        self.assertNotIn("RESEND_API_KEY", result["api"])

    def test_explicit_cutover_sets_both_reset_origins_and_retains_the_old_allowed_frontend(self):
        result = oracle_env.prepare_environments(self.snapshot(), "https://api.onesa.eu", "https://factory.onesa.eu")
        self.assertEqual(result["worker"]["DASHBOARD_API_ORIGIN"], "https://api.onesa.eu")
        self.assertEqual(result["api"]["ALLOWED_ORIGIN"], vm.DEFAULT_UI_ORIGIN + ",https://factory.onesa.eu")
        for role in ("api", "worker"):
            self.assertEqual(result[role]["PASSWORD_RESET_ORIGIN"], "https://factory.onesa.eu")
            self.assertEqual(result[role]["DASHBOARD_SERVICE_TOKEN"], "s" * 40)
        self.assertEqual(result["worker"]["MqttClientId"], "existing-singleton")

    def test_multiple_origins_need_an_explicit_reset_target(self):
        snapshot = self.snapshot()
        snapshot["api"]["variables"].append({"key": "ALLOWED_ORIGIN", "value": vm.DEFAULT_UI_ORIGIN + ",https://factory.onesa.eu"})
        with self.assertRaisesRegex(ValueError, "Multiple ALLOWED_ORIGIN"):
            oracle_env.prepare_environments(snapshot)

    def test_prepared_files_remain_private_without_printing_credential_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "snapshot.json"
            snapshot.write_text(json.dumps(self.snapshot()))
            target = root / "prepared"
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                oracle_env.main([str(snapshot), str(target), "--api-origin", "https://api.onesa.eu", "--ui-origin", "https://factory.onesa.eu"])
            self.assertNotIn("re_literal", output.getvalue())
            for role in ("api", "worker"):
                self.assertEqual(stat.S_IMODE((target / (".env." + role)).stat().st_mode), 0o600)
            self.assertIn(b"RESEND_API_KEY=re_literal$#\\secret\n", (target / ".env.worker").read_bytes())
            self.assertIn(b"DATABASE_CA_CERT=first-line\\nsecond-line\n", (target / ".env.api").read_bytes())

    def test_invalid_second_role_or_symlink_does_not_partially_overwrite_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "snapshot.json"
            target = root / "prepared"
            target.mkdir()
            (target / ".env.api").write_text("retained-api")
            values = self.snapshot()
            values["worker"]["variables"].append({"key": "RESEND_API_KEY", "value": "invalid\nsecret"})
            snapshot.write_text(json.dumps(values))
            with self.assertRaisesRegex(ValueError, "Unexpected multiline"):
                oracle_env.main([str(snapshot), str(target)])
            self.assertEqual((target / ".env.api").read_text(), "retained-api")
            snapshot.write_text(json.dumps(self.snapshot()))
            protected = root / "protected"
            protected.write_text("retained-target")
            (target / ".env.worker").symlink_to(protected)
            with self.assertRaisesRegex(ValueError, "regular environment output"):
                oracle_env.main([str(snapshot), str(target)])
            self.assertEqual((target / ".env.api").read_text(), "retained-api")
            self.assertEqual(protected.read_text(), "retained-target")


class DetachedAndTransportTests(unittest.TestCase):
    def setUp(self):
        vm.configure_origins()
        vm.configure_ssh_target()
        self.addCleanup(vm.configure_origins)
        self.addCleanup(vm.configure_ssh_target)
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name) / "release"
        self.directory.mkdir(mode=0o700)
        self.manifest, _, _ = bundle_fixture(self.directory)
        vm.M = vm.validate_manifest(self.manifest)

    def tearDown(self):
        self.temporary.cleanup()

    def test_detached_start_is_idempotent_and_keeps_private_records(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        vm.configure_ssh_target("factory-owner@onesa-oracle")
        helper = self.directory / "deploy-vm.py"
        helper.write_text("# synthetic helper")
        vm.write_json_private(self.directory / "release-manifest.json", vm.M)
        with patch.object(vm.subprocess, "Popen", return_value=Mock(pid=12345)) as popen, patch.object(vm, "process_start_identity", return_value="100"):
            first = vm.remote_start(self.directory, vm.digest_file(helper))
            second = vm.remote_start(self.directory, vm.digest_file(helper))
        self.assertEqual(first["status"], "RUNNING")
        self.assertEqual(second["status"], "RUNNING")
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertTrue(popen.call_args.kwargs["close_fds"])
        self.assertEqual(popen.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(popen.call_args.args[0][-6:], vm.deployment_arguments())
        self.assertEqual(vm.read_private_json(self.directory / "request.json")["origins"], vm.deployment_origins())
        self.assertEqual(vm.read_private_json(self.directory / "request.json")["sshTarget"], vm.HOST)
        self.assertEqual(first["sshTarget"], vm.HOST)
        self.assertEqual(second["sshTarget"], vm.HOST)
        self.assertEqual(stat.S_IMODE((self.directory / "request.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.directory / "private-output.log").stat().st_mode), 0o600)

    def test_stale_or_reused_process_id_does_not_claim_deployment_running(self):
        vm.write_json_private(self.directory / "request.json", {"manifestSha256": vm.manifest_digest()})
        vm.write_json_private(self.directory / "progress.json", {"status": "RUNNING", "phase": "api_starting"})
        vm.write_json_private(self.directory / "process.json", {"pid": 12345, "startIdentity": "old"})
        with patch.object(vm, "process_start_identity", return_value="new"):
            self.assertEqual(vm.remote_status(self.directory)["status"], "NEEDS_REVIEW")

    def test_ssh_passes_selected_target_and_origins_to_the_remote_helper(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        vm.configure_ssh_target("factory-owner@onesa-oracle")
        with patch.object(vm, "ssh_options", return_value=[]), \
             patch.object(vm, "run_command", return_value=subprocess.CompletedProcess([], 0, '{}', '')) as run:
            vm.remote_call("check")
        arguments = shlex.split(run.call_args.args[0][-1])
        self.assertEqual(arguments[-6:], vm.deployment_arguments())
        self.assertEqual(run.call_args.args[0][-2], vm.HOST)

    def test_origin_drift_prevents_detached_execution_and_reconnect(self):
        vm.write_json_private(self.directory / "request.json", {"manifestSha256": vm.manifest_digest(),
                              "origins": {"api": "https://api.onesa.eu", "ui": "https://factory.onesa.eu"}})
        with patch.object(vm, "execute_deployment") as execute:
            with self.assertRaisesRegex(RuntimeError, "different origins"):
                vm.remote_run(self.directory)
            with self.assertRaisesRegex(RuntimeError, "different origins"):
                vm.remote_status(self.directory)
            execute.assert_not_called()

    def test_target_drift_blocks_detached_restart_and_local_status_even_after_completion(self):
        request = {"manifestSha256": vm.manifest_digest(), **vm.deployment_target()}
        vm.write_json_private(self.directory / "request.json", request)
        vm.write_json_private(self.directory / "result.json", {"status": "BACKEND_DEPLOYED", **vm.deployment_target()})
        state = self.directory / "local-receipt.json"
        vm.write_json_private(state, {**request, "directory": str(self.directory)})
        vm.configure_ssh_target("onesa-oracle")
        args = argparse.Namespace(state=str(state), status=True, once=True, bundle=None, deploy=False)
        with patch.object(vm, "execute_deployment") as execute, patch.object(vm.subprocess, "Popen") as popen, \
             patch.object(vm, "monitor") as monitor:
            for action in (lambda: vm.remote_run(self.directory), lambda: vm.remote_status(self.directory),
                           lambda: vm.remote_start(self.directory, "0" * 64), lambda: vm.run_client(args)):
                with self.subTest(action=action), self.assertRaisesRegex(RuntimeError, "different SSH target"):
                    action()
            execute.assert_not_called()
            popen.assert_not_called()
            monitor.assert_not_called()

    def test_client_uploads_to_selected_owner_and_saves_that_same_reconnect_target(self):
        vm.configure_origins("https://api.onesa.eu", "https://factory.onesa.eu")
        vm.configure_ssh_target("factory-owner@onesa-oracle")
        directory = "/home/factory-owner/smart-factory-releases/aaaaaaa-20261103T120000Z-12345678"
        state = self.directory / "receipt.json"
        args = argparse.Namespace(state=str(state), status=False, once=False, bundle="bundle.zip", deploy=True)
        staged = {"status": "STAGED", "directory": directory, "manifestSha256": vm.manifest_digest(), **vm.deployment_target()}
        home = self.directory / "ssh-home"
        (home / ".ssh").mkdir(parents=True)
        (home / ".ssh/id_ed25519").write_text("synthetic")
        with patch.object(vm, "find_bundle", return_value=self.directory / "qualified-arm64-bundle.zip"), \
             patch.object(vm, "remote_call", side_effect=[{"status": "PREFLIGHT_PASSED"}, staged, {"status": "RUNNING"}]) as remote, \
             patch.object(vm.Path, "home", return_value=home), patch.object(vm.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(vm, "run_command") as run, patch.object(vm, "monitor", return_value=0), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vm.run_client(args), 0)
        self.assertEqual([call.args[0] for call in remote.call_args_list], ["check", "allocate", "start"])
        self.assertEqual(run.call_count, 3)
        destinations = []
        for call in run.call_args_list:
            command = call.args[0]
            self.assertEqual(command[0], "scp")
            self.assertIn("StrictHostKeyChecking=yes", command)
            self.assertIn("IdentitiesOnly=yes", command)
            self.assertIn(str(home / ".ssh/id_ed25519"), command)
            destinations.append(command[-1])
        self.assertEqual(destinations, [vm.HOST + ":" + directory + "/" + name
                         for name in ("deploy-vm.py", "release-manifest.json", "qualified-arm64-bundle.zip")])
        receipt = vm.read_private_json(state)
        self.assertEqual(receipt["sshTarget"], vm.HOST)
        self.assertEqual(receipt["origins"], vm.deployment_origins())
        self.assertEqual(receipt["directory"], directory)

    def test_strict_ssh_never_accepts_new_host_keys_or_password_prompt(self):
        home = self.directory / "home"
        (home / ".ssh").mkdir(parents=True)
        (home / ".ssh/id_ed25519").write_text("synthetic")
        with patch.object(vm.Path, "home", return_value=home), patch.object(vm.shutil, "which", return_value="/usr/bin/tool"):
            options = vm.ssh_options()
        self.assertIn("StrictHostKeyChecking=yes", options)
        self.assertIn("BatchMode=yes", options)
        self.assertIn("PasswordAuthentication=no", options)
        self.assertIn("IdentitiesOnly=yes", options)
        self.assertIn("PreferredAuthentications=publickey", options)
        self.assertEqual(options[-2:], ["-i", str(home / ".ssh/id_ed25519")])
        self.assertNotIn("StrictHostKeyChecking=no", options)

    def test_command_failure_and_nonruntime_errors_do_not_echo_secret_content(self):
        secret = "a-secret-that-must-not-appear"
        with patch.object(vm.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, secret, secret)):
            with self.assertRaises(RuntimeError) as caught:
                vm.run_command(["synthetic", secret], "Synthetic check")
        self.assertNotIn(secret, str(caught.exception))
        self.assertNotIn(secret, vm.safe_error(ValueError(secret)))

    def test_default_client_check_does_not_upload_or_allocate(self):
        args = argparse.Namespace(state=str(self.directory / "receipt.json"), status=False, once=False,
                                  bundle="bundle.zip", deploy=False)
        with patch.object(vm, "find_bundle", return_value=self.directory / "qualified-arm64-bundle.zip"), \
             patch.object(vm, "remote_call", return_value={"status": "PREFLIGHT_PASSED"}) as call, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vm.run_client(args), 0)
        call.assert_called_once_with("check")
        self.assertFalse((self.directory / "receipt.json").exists())

    def test_status_reconnect_never_revalidates_or_redeploys_bundle(self):
        state = self.directory / "receipt.json"
        vm.write_json_private(state, {"manifestSha256": vm.manifest_digest(), "directory": "/retained/release"})
        args = argparse.Namespace(state=str(state), status=True, once=True, bundle=None, deploy=False)
        with patch.object(vm, "find_bundle") as bundle, patch.object(vm, "monitor", return_value=1) as monitor:
            self.assertEqual(vm.run_client(args), 1)
        bundle.assert_not_called()
        monitor.assert_called_once_with("/retained/release", follow=False)


if __name__ == "__main__":
    unittest.main()
