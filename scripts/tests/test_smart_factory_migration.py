"""Filesystem migration regression tests; all repositories are disposable fixtures."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "migration", Path(__file__).resolve().parents[1] / "migrate-smart-factory.py"
)
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def git(path, *args):
    return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="migration fixture ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def repo(self, path, component):
        path.mkdir(parents=True)
        git(path, "init", "-q", "--initial-branch=main")
        git(path, "config", "user.email", "fixture@example.invalid")
        git(path, "config", "user.name", "Fixture")
        git(path, "remote", "add", "origin", f"https://github.com/DruHustle/smart-factory-iot-{component}.git")
        (path / ".gitignore").write_text(".env\n")
        (path / "tracked.txt").write_text("committed\n")
        git(path, "add", ".")
        git(path, "commit", "-qm", "fixture")
        return path

    def run_migration(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return migration.migrate(self.base, clone_missing=False, **kwargs)

    def test_flat_frontend_root_retains_dirty_index_secrets_and_ssh_remotes(self):
        frontend = self.repo(self.base / "smart-factory-iot", "frontend")
        self.repo(self.base / "smart-factory-iot-backend", "backend")
        edge = self.repo(self.base / "smart-factory-iot-edge", "edge")
        git(edge, "remote", "set-url", "origin", "git@github.com:DruHustle/smart-factory-iot-edge.git")
        git(edge, "remote", "set-url", "--push", "origin", "git@github.com:DruHustle/smart-factory-iot-edge.git")
        (frontend / "tracked.txt").write_text("staged\n")
        git(frontend, "add", "tracked.txt")
        (frontend / "tracked.txt").write_text("unstaged\n")
        (frontend / "untracked.txt").write_text("local work\n")
        (frontend / ".env").write_text("fixture-only ignored setting\n")
        status, index, head = git(frontend, "status", "--porcelain"), git(frontend, "show", ":tracked.txt"), git(frontend, "rev-parse", "HEAD")
        self.run_migration(apply=False)
        self.assertFalse((self.base / "smart-factory").exists())
        target = self.run_migration(apply=True)
        moved = target / "smart-factory-frontend"
        self.assertEqual(git(moved, "status", "--porcelain"), status)
        self.assertEqual(git(moved, "show", ":tracked.txt"), index)
        self.assertEqual(git(moved, "rev-parse", "HEAD"), head)
        self.assertEqual((moved / "tracked.txt").read_text(), "unstaged\n")
        self.assertEqual((moved / ".env").read_text(), "fixture-only ignored setting\n")
        self.assertEqual((moved / "untracked.txt").read_text(), "local work\n")
        self.assertEqual(git(target / "smart-factory-edge", "remote", "get-url", "--push", "origin"), "git@github.com:DruHustle/smart-factory-edge.git")
        self.run_migration(apply=True)  # Idempotent after the first migration.
        self.assertEqual(git(moved, "status", "--porcelain"), status)

    def test_plain_parent_preserves_extra_files(self):
        parent = self.base / "smart-factory-iot"
        for component in migration.COMPONENTS:
            self.repo(parent / f"smart-factory-iot-{component}", component)
        (parent / "notes.txt").write_text("workspace notes")
        target = self.run_migration(apply=True)
        self.assertEqual((target / "notes.txt").read_text(), "workspace notes")
        self.assertFalse(parent.exists())
        self.assertTrue((target / "smart-factory.code-workspace").is_file())

    def test_backend_folder_is_identified_by_remote_instead_of_directory_name(self):
        frontend = self.repo(self.base / "smart-factory-iot-backend", "frontend")
        target = self.run_migration(apply=True)
        self.assertFalse(frontend.exists())
        self.assertEqual(git(target / "smart-factory-frontend", "remote", "get-url", "origin"), "https://github.com/DruHustle/smart-factory-frontend.git")

    def test_duplicate_checkouts_abort_without_moving(self):
        first = self.repo(self.base / "smart-factory-iot", "frontend")
        second = self.repo(self.base / "smart-factory-iot-frontend", "frontend")
        with self.assertRaisesRegex(RuntimeError, "Multiple frontend"):
            self.run_migration(apply=True)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertFalse((self.base / "smart-factory").exists())

    def test_conflicting_destination_aborts_without_moving(self):
        source = self.repo(self.base / "smart-factory-iot", "frontend")
        occupied = self.base / "smart-factory" / "smart-factory-frontend"
        occupied.mkdir(parents=True)
        (occupied / "local.txt").write_text("keep me")
        with self.assertRaisesRegex(RuntimeError, "Destination is occupied"):
            self.run_migration(apply=True)
        self.assertTrue(source.exists())
        self.assertEqual((occupied / "local.txt").read_text(), "keep me")

    def test_external_worktree_keeps_its_main_checkout_link(self):
        main = self.repo(self.base / "main-checkout", "frontend")
        linked = self.base / "smart-factory-iot"
        git(main, "worktree", "add", "-qb", "local-work", str(linked))
        target = self.run_migration(apply=True)
        moved = target / "smart-factory-frontend"
        self.assertEqual(git(moved, "branch", "--show-current"), "local-work")
        self.assertIn(str(moved), git(main, "worktree", "list", "--porcelain"))
        self.assertEqual(git(moved, "rev-parse", "HEAD"), git(main, "rev-parse", "HEAD"))

    def test_main_checkout_repairs_external_worktree_pointer(self):
        main = self.repo(self.base / "smart-factory-iot", "frontend")
        linked = self.base / "external-worktree"
        git(main, "worktree", "add", "-qb", "local-work", str(linked))
        target = self.run_migration(apply=True)
        self.assertEqual(git(linked, "rev-parse", "HEAD"), git(target / "smart-factory-frontend", "rev-parse", "HEAD"))

    def test_move_failure_rolls_back_all_existing_checkout_paths(self):
        source = self.repo(self.base / "smart-factory-iot", "frontend")
        original_rename = Path.rename

        def fail_final_move(path, destination):
            if Path(destination) == self.base / "smart-factory" / "smart-factory-frontend":
                raise OSError("injected move failure")
            return original_rename(path, destination)

        with patch.object(Path, "rename", fail_final_move), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(OSError, "injected move failure"):
                self.run_migration(apply=True)
        self.assertTrue((source / "tracked.txt").is_file())
        self.assertEqual(git(source, "status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main()
