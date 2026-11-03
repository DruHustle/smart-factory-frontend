import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("controller", Path(__file__).with_name("container-controller.py"))
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


def container(service="api"):
    return {
        "Id": "a" * 64,
        "Name": f"/smart-factory-backend-{service}-1",
        "Config": {"User": "app", "Labels": {
            "com.docker.compose.project": "smart-factory-backend",
            "com.docker.compose.service": service,
            "com.docker.compose.container-number": "1",
        }},
        "HostConfig": {"Init": True, "RestartPolicy": {"Name": "unless-stopped"}},
        "State": {"Running": True, "Paused": False, "Restarting": False,
                  "StartedAt": "2026-11-03T00:00:00Z", "Health": {"Status": "unhealthy"}},
    }


class ControllerPolicyTests(unittest.TestCase):
    def test_waits_and_only_recovers_the_same_unhealthy_container(self):
        item = container()
        state, decision = controller.decide(item, "api", {}, 1000)
        self.assertEqual(decision, "observing")
        state, _ = controller.decide(item, "api", state, 1060)
        state, _ = controller.decide(item, "api", state, 1120)
        state, decision = controller.decide(item, "api", state, 1179)
        self.assertEqual(decision, "observing")
        state, decision = controller.decide(item, "api", state, 1180)
        self.assertEqual(decision, "recover")
        item["State"]["StartedAt"] = "different-start"
        self.assertEqual(controller.decide(item, "api", state, 1181)[1], "observing")

    def test_never_targets_other_projects_or_stopped_paused_or_healthy(self):
        for alteration in ("project", "service", "replica", "name", "stopped", "paused", "restarting", "healthy", "starting", "restart-policy", "user", "init"):
            with self.subTest(alteration=alteration):
                item = container()
                if alteration == "project": item["Config"]["Labels"]["com.docker.compose.project"] = "another-project"
                if alteration == "service": item["Config"]["Labels"]["com.docker.compose.service"] = "worker"
                if alteration == "replica": item["Config"]["Labels"]["com.docker.compose.container-number"] = "2"
                if alteration == "name": item["Name"] = "/unrelated"
                if alteration == "stopped": item["State"]["Running"] = False
                if alteration == "paused": item["State"]["Paused"] = True
                if alteration == "restarting": item["State"]["Restarting"] = True
                if alteration == "healthy": item["State"]["Health"]["Status"] = "healthy"
                if alteration == "starting": item["State"]["Health"]["Status"] = "starting"
                if alteration == "restart-policy": item["HostConfig"]["RestartPolicy"]["Name"] = "always"
                if alteration == "user": item["Config"]["User"] = "root"
                if alteration == "init": item["HostConfig"]["Init"] = False
                self.assertEqual(controller.decide(item, "api", {}, 1000)[1], "not-eligible")

    def test_rate_limits_and_resets_observation_when_healthy(self):
        item = container("worker")
        previous, _ = controller.decide(item, "worker", {"recoveries": [900]}, 1000)
        previous, _ = controller.decide(item, "worker", previous, 1060)
        previous, _ = controller.decide(item, "worker", previous, 1120)
        self.assertEqual(controller.decide(item, "worker", previous, 1180)[1], "cooldown")
        previous["recoveries"] = [100, 200, 300]
        self.assertEqual(controller.decide(item, "worker", previous, 1180)[1], "limit-reached")
        item["State"]["Health"]["Status"] = "healthy"
        result, decision = controller.decide(item, "worker", previous, 1180)
        self.assertEqual(decision, "not-eligible")
        self.assertNotIn("unhealthy_since", result)
        item["State"]["Health"]["Status"] = "unhealthy"
        self.assertEqual(controller.decide(item, "worker", result, 1181)[1], "observing")

    def test_future_timestamps_do_not_bypass_observation(self):
        item = container()
        state, _ = controller.decide(item, "api", {}, 1000)
        self.assertEqual(controller.decide(item, "api", state, 900)[1], "observing")

    def test_clock_correction_cannot_erase_cooldown(self):
        item = container()
        state, _ = controller.decide(item, "api", {"recoveries": [1100]}, 900)
        state, _ = controller.decide(item, "api", state, 960)
        state, _ = controller.decide(item, "api", state, 1020)
        self.assertEqual(controller.decide(item, "api", state, 1080)[1], "cooldown")

    def test_gap_in_observation_restarts_wait(self):
        item = container()
        state, _ = controller.decide(item, "api", {}, 1000)
        state, decision = controller.decide(item, "api", state, 1180)
        self.assertEqual(decision, "observing")
        self.assertEqual(state["unhealthy_since"], 1180)

    def test_dry_run_never_signals_even_when_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            eligible, _ = controller.decide(container(), "api", {}, 1000)
            eligible["last_observed"] = 1150
            (root / "state.json").write_text(json.dumps({"api": eligible}))
            os.chmod(root / "state.json", 0o600)
            with patch.object(controller, "STATE_DIR", root), \
                 patch.object(controller.time, "time", return_value=1180), \
                 patch.object(controller, "inspect_container", side_effect=[container(), container("worker")]), \
                 patch.object(controller.subprocess, "run") as run:
                controller.run(False)
                run.assert_not_called()

    def test_apply_rechecks_identity_under_release_lock_before_signalling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            eligible, _ = controller.decide(container(), "api", {}, 1000)
            eligible["last_observed"] = 1150
            (root / "state.json").write_text(json.dumps({"api": eligible}))
            os.chmod(root / "state.json", 0o600)
            release = root / "release.lock"
            release.touch(mode=0o600)
            with patch.object(controller, "STATE_DIR", root), \
                 patch.object(controller, "RELEASE_LOCK", release), \
                 patch.object(controller.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=os.getuid())), \
                 patch.object(controller.time, "time", return_value=1180), \
                 patch.object(controller, "inspect_container", side_effect=[container(), container(), container("worker")]), \
                 patch.object(controller.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                controller.run(True)
                run.assert_called_once_with(["docker", "exec", "--user", "app", "a" * 64, "/bin/sh", "-c", "kill -TERM 1"], capture_output=True, timeout=20)
            state = json.loads((root / "state.json").read_text())
            self.assertEqual(state["api"]["recoveries"], [1180])

    def test_changed_container_is_not_signalled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            os.chmod(root, 0o700)
            eligible, _ = controller.decide(container(), "api", {}, 1000)
            eligible["last_observed"] = 1150
            (root / "state.json").write_text(json.dumps({"api": eligible}))
            os.chmod(root / "state.json", 0o600)
            release = root / "release.lock"
            release.touch(mode=0o600)
            stopped = container()
            stopped["State"]["Running"] = False
            with patch.object(controller, "STATE_DIR", root), \
                 patch.object(controller, "RELEASE_LOCK", release), \
                 patch.object(controller.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=os.getuid())), \
                 patch.object(controller.time, "time", return_value=1180), \
                 patch.object(controller, "inspect_container", side_effect=[container(), stopped, container("worker")]), \
                 patch.object(controller.subprocess, "run") as run:
                controller.run(True)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
