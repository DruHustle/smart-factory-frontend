"""Workspace orchestration tests. No deployment, cloud dispatch or credentials."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / "manual-deployment/cli.py"
spec = importlib.util.spec_from_file_location("manual_cli", SOURCE)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
PREPARE = SOURCE.parent.parent / "prepare-manual-release.py"
prep_spec = importlib.util.spec_from_file_location("manual_prepare_workspace", PREPARE)
prepare = importlib.util.module_from_spec(prep_spec)
prep_spec.loader.exec_module(prepare)


class WorkspaceCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="manual-cli-test-", dir=cli.EVIDENCE if cli.EVIDENCE.is_dir() else None)
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        evidence = patch.object(cli, "EVIDENCE", self.path)
        evidence.start()
        self.addCleanup(evidence.stop)
        self.sources = {name: {"path": str(cli.ROOT / ("smart-factory-" + name)),
                              "revision": letter * 40, "branch": "review", "dirty": False,
                              "remote": f"https://github.com/DruHustle/smart-factory-{name}.git"}
                        for name, letter in zip(cli.COMPONENTS, "abc")}

    def run_main(self, *arguments):
        with patch.object(cli, "source_root", return_value=cli.ROOT), patch.object(cli, "repositories", return_value=self.sources), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return cli.main(list(arguments))

    def test_all_offline_plans_never_import_engines_or_touch_network(self):
        for operation in ("package", "prepare", "backend", "frontend", "edge", "all", "status", "verify", "recover"):
            output = self.path / operation
            with patch.object(cli, "get_json", side_effect=AssertionError("network")), patch.object(cli, "load_module", side_effect=AssertionError("engine")):
                self.assertEqual(self.run_main(operation, "--dry-run", "--release-dir", str(output)), 0)
            self.assertFalse(output.exists())

    def test_coordinated_release_validates_all_inputs_before_ordered_mutations(self):
        events = []
        core = Mock(M={"candidate": {"sources": {name: value["revision"] for name, value in self.sources.items()}}})
        with patch.object(cli.Session, "manifest", side_effect=lambda **kw: events.append(("manifest", kw)) or core), \
             patch.object(cli.Session, "frontend_source_gate", side_effect=lambda: events.append("main-ci")), \
             patch.object(cli.Session, "backend", side_effect=lambda: events.append("backend")), \
             patch.object(cli.Session, "frontend", side_effect=lambda: events.append("frontend")):
            self.assertEqual(self.run_main("all", "--execute", "--release-dir", str(self.path / "all"), "--sha", "a" * 40), 0)
        self.assertEqual(events, [("manifest", {"verify_bundle": True}), "main-ci", "backend", "frontend"])

    def test_failed_backend_never_promotes_frontend_and_records_failure(self):
        core = Mock(M={"candidate": {"sources": {name: value["revision"] for name, value in self.sources.items()}}})
        output = self.path / "failure"
        with patch.object(cli.Session, "manifest", return_value=core), patch.object(cli.Session, "frontend_source_gate"), \
             patch.object(cli.Session, "backend", side_effect=cli.ReleaseError("worker failed")), patch.object(cli.Session, "frontend") as frontend:
            self.assertEqual(self.run_main("all", "--execute", "--release-dir", str(output), "--sha", "a" * 40), 1)
            frontend.assert_not_called()
        report = json.loads(next(output.glob("invocation-*/result.json")).read_text())
        self.assertEqual(report["status"], "FAILED")
        self.assertIn("worker failed", report["message"])

    def test_invalid_candidate_prevents_all_mutation(self):
        with patch.object(cli.Session, "manifest", side_effect=cli.ReleaseError("artifact mismatch")), \
             patch.object(cli.Session, "backend") as backend, patch.object(cli.Session, "frontend") as frontend:
            self.assertEqual(self.run_main("all", "--execute", "--release-dir", str(self.path / "bad"), "--sha", "a" * 40), 1)
            backend.assert_not_called()
            frontend.assert_not_called()

    def test_dirty_sources_prevent_qualification_package(self):
        self.sources["edge"]["dirty"] = True
        with patch.object(cli, "load_module") as load:
            self.assertEqual(self.run_main("package", "--execute", "--release-dir", str(self.path / "dirty")), 1)
            load.assert_not_called()

    def test_validation_checks_bundle_without_running_remote_commands(self):
        with patch.object(cli.Session, "manifest") as manifest, patch.object(cli.Session, "run") as run:
            self.assertEqual(self.run_main("backend", "--validate", "--release-dir", str(self.path / "validation")), 0)
            manifest.assert_called_once_with(verify_bundle=True)
            run.assert_not_called()

    def test_all_validation_rejects_wrong_checkout_before_artifact_verification(self):
        with patch.object(cli.Session, "manifest") as manifest:
            self.assertEqual(self.run_main("all", "--validate", "--release-dir", str(self.path / "wrong-head"), "--sha", "f" * 40), 1)
            manifest.assert_not_called()

    def test_frontend_does_not_dispatch_when_qualified_api_identity_is_wrong(self):
        args = cli.parser().parse_args(["frontend", "--execute", "--release-dir", str(self.path / "frontend"),
                                       "--sha", "a" * 40, "--manifest", "release.json"])
        session = cli.Session(args, self.sources)
        core = Mock(M={"candidate": {"sources": {"frontend": "a" * 40}}})
        core.runtime_matches.return_value = False
        with patch.object(session, "frontend_source_gate"), patch.object(session, "manifest", return_value=core), \
             patch.object(cli, "get_json", return_value={}), patch.object(session, "run") as run:
            with self.assertRaisesRegex(cli.ReleaseError, "frontend was not dispatched"):
                session.frontend()
            run.assert_not_called()

    def test_frontend_does_not_dispatch_for_wrong_manifest_revision(self):
        args = cli.parser().parse_args(["frontend", "--execute", "--release-dir", str(self.path / "frontend"),
                                       "--sha", "a" * 40, "--manifest", "release.json"])
        session = cli.Session(args, self.sources)
        core = Mock(M={"candidate": {"sources": {"frontend": "d" * 40}}})
        with patch.object(session, "frontend_source_gate"), patch.object(session, "manifest", return_value=core), \
             patch.object(cli, "get_json") as network, patch.object(session, "run") as run:
            with self.assertRaisesRegex(cli.ReleaseError, "SHA differ"):
                session.frontend()
            network.assert_not_called()
            run.assert_not_called()

    def test_frontend_dispatch_and_receipt_bind_sha_and_unique_request(self):
        args = cli.parser().parse_args(["frontend", "--execute", "--release-dir", str(self.path / "bound"), "--sha", "a" * 40])
        session = cli.Session(args, self.sources)
        with contextlib.redirect_stdout(io.StringIO()):
            session.begin()
        request = "b" * 32
        rows = [{"databaseId": 9, "headSha": "a" * 40, "displayTitle": "UI " + "a" * 40 + " previous"},
                {"databaseId": 10, "headSha": "a" * 40, "displayTitle": "UI " + "a" * 40 + " " + request}]
        with patch.object(session, "frontend_source_gate"), patch.object(session, "run") as run, \
             patch.object(session, "verify"), patch.object(cli.uuid, "uuid4", return_value=Mock(hex=request)), \
             patch.object(cli, "capture", return_value=json.dumps(rows)):
            session.frontend()
        dispatch = next(call.args[0] for call in run.call_args_list if call.args[1] == "dispatch-frontend")
        self.assertIn("expected_sha=" + "a" * 40, dispatch)
        self.assertIn("request_id=" + request, dispatch)
        receipt = json.loads((session.output / "frontend-run.json").read_text())
        self.assertEqual(receipt["id"], "10")

    def test_recovery_guidance_is_printed_even_for_failed_upgrade(self):
        args = cli.parser().parse_args(["recover"])
        session = cli.Session(args, self.sources)
        output = io.StringIO()
        with patch.object(session, "status", side_effect=cli.ReleaseError("ROLLED_BACK")), contextlib.redirect_stdout(output):
            with self.assertRaises(cli.ReleaseError):
                session.recover()
        self.assertIn("qualified", output.getvalue())
        self.assertIn("Do not restart a second worker", output.getvalue())

    def test_edge_validation_rejects_empty_wheel_directory(self):
        wheels = self.path / "empty-wheels"
        wheels.mkdir()
        with patch.object(cli, "load_module") as load:
            self.assertEqual(self.run_main("edge", "--validate", "--release-dir", str(self.path / "edge"), "--wheels", str(wheels)), 1)
            load.assert_not_called()

    def test_edge_exports_captured_revision_even_when_head_moves(self):
        args = cli.parser().parse_args(["edge", "--execute", "--release-dir", str(self.path / "package")])
        session = cli.Session(args, self.sources)
        with contextlib.redirect_stdout(io.StringIO()):
            session.begin()
        source = self.sources["edge"]
        wheels = self.path / "wheels"
        wheels.mkdir()
        (wheels / "sample-1-py3-none-any.whl").write_bytes(b"fixture")
        installer = Mock()
        installer.verify_bundle.return_value = (source["revision"], {})
        entry = "100644 blob " + "f" * 40 + "\traspberry-pi/scripts/install-telemetry-release.py\0"
        with patch.object(session, "edge_inputs", return_value=(source, Path(source["path"]), wheels, installer)), \
             patch.object(cli, "git", return_value=entry) as git, patch.object(cli.subprocess, "check_output", return_value=b"# fixture\n"), contextlib.redirect_stdout(io.StringIO()):
            session.edge()
        git.assert_called_once_with(Path(source["path"]), "ls-tree", "-rz", source["revision"])

    def test_failure_report_redacts_unknown_exception_text(self):
        output = self.path / "redaction"
        with patch.object(cli.Session, "status", side_effect=ValueError("secret-password-and-reset-link")):
            self.assertEqual(self.run_main("status", "--execute", "--release-dir", str(output)), 1)
        contents = next(output.glob("invocation-*/result.json")).read_text()
        self.assertNotIn("secret-password", contents)
        self.assertIn("ValueError", contents)

    def test_evidence_cannot_escape_workspace_by_symlink(self):
        link = self.path / "redirect"
        link.symlink_to("/private/tmp", target_is_directory=True)
        with self.assertRaises(cli.ReleaseError):
            cli.within(link / "output", cli.EVIDENCE)

    def test_subprocess_failure_preserves_nonzero_stage_and_private_log(self):
        args = cli.parser().parse_args(["status", "--execute", "--release-dir", str(self.path / "child")])
        session = cli.Session(args, self.sources)
        with contextlib.redirect_stdout(io.StringIO()):
            session.begin()
            with self.assertRaisesRegex(cli.ReleaseError, "exit 7"):
                session.run([sys.executable, "-c", "raise SystemExit(7)"], "controlled-failure", cwd=self.path)
        self.assertEqual(session.steps[0]["exitCode"], 7)
        self.assertEqual(Path(session.steps[0]["log"]).stat().st_mode & 0o777, 0o600)

    def test_failure_guidance_distinguishes_local_work_from_remote_jobs(self):
        for label, expected, forbidden in (
            ("qualify-arm64", "before retrying", "detached VM"),
            ("deploy-api-worker", "detached VM", "GitHub Actions"),
            ("dispatch-frontend", "GitHub Actions", "detached VM"),
            ("await-frontend", "GitHub Actions", "detached VM"),
        ):
            args = cli.parser().parse_args(["prepare", "--release-dir", str(self.path / label)])
            session = cli.Session(args, self.sources)
            with contextlib.redirect_stdout(io.StringIO()):
                session.begin()
                with self.assertRaises(cli.ReleaseError) as failure:
                    session.run([sys.executable, "-c", "raise SystemExit(7)"], label, cwd=self.path)
            self.assertIn(expected, str(failure.exception))
            self.assertNotIn(forbidden, str(failure.exception))

    def test_launcher_and_installer_reject_recovered_root_before_executing_copies(self):
        root = self.path / "workspace with spaces"
        for name in ("locals-tools", "smart-factory-frontend", "smart-factory-backend", "smart-factory-edge"):
            (root / name).mkdir(parents=True)
        home = root / "locals-tools/manual deployment"
        home.mkdir()
        launcher = home / "deploy.py"
        launcher.write_bytes((SOURCE.parent / "launcher.py").read_bytes())
        for suffix in ("recovered", "recovered/legacy"):
            recovered = root / "locals-tools" / suffix
            core = recovered / "smart-factory-frontend/scripts/manual-deployment/cli.py"
            core.parent.mkdir(parents=True)
            marker = self.path / (suffix.replace("/", "-") + ".executed")
            core.write_text("from pathlib import Path\nPath(" + repr(str(marker)) + ").touch()\n")
            for command in (
                [launcher, "inventory", "--source-root", recovered],
                [SOURCE.parent / "install.py", "--workspace", root, "--source-root", recovered, "--execute"],
            ):
                result = subprocess.run([sys.executable, *map(str, command)], capture_output=True, text=True, cwd=self.path)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("active", result.stderr)
                self.assertFalse(marker.exists())
                self.assertFalse((home / "config.json").exists())

    def test_explicit_workspace_lock_never_uses_home(self):
        package = self.path / "source-package"
        work, locks = self.path / "qualification", self.path / "locks"
        with patch.object(prepare, "load_source_package", return_value=({}, "a" * 64)), \
             patch.object(prepare, "prepare", return_value={"status": "PREREQUISITES_PASSED"}), \
             patch.object(Path, "home", side_effect=AssertionError("outside workspace")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(prepare.main(["--source-package", str(package), "--work-dir", str(work), "--lock-dir", str(locks), "--check"]), 0)
        self.assertTrue((locks / "fixture.lock").is_file())
        self.assertTrue((work / "prepare.lock").is_file())

    def test_actual_launchers_work_from_unrelated_directory_with_spaces(self):
        launchers = cli.HERE
        if not (launchers / "deploy.py").is_file():
            self.skipTest("Workspace installation integration runs locally; unit orchestration still runs in standalone CI.")
        for script in launchers.glob("*.sh"):
            output = self.path / (script.stem + " evidence with spaces")
            result = subprocess.run(["bash", str(script), "--dry-run", "--release-dir", str(output)],
                                    cwd="/", capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            self.assertEqual(plan["mode"], "offline-plan")
            self.assertEqual(plan["releaseDirectory"], str(output))
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
