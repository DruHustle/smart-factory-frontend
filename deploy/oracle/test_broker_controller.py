import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("broker_controller", Path(__file__).with_name("broker-controller.py"))
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


def container():
    return {"Name": "/smart-factory-mqtt-broker-1", "Id": "a" * 64,
            "Config": {"User": "1883:1883", "Image": broker.IMAGE, "Labels": {
                "com.docker.compose.project": "smart-factory-mqtt",
                "com.docker.compose.service": "broker", "com.docker.compose.container-number": "1"}},
            "HostConfig": {"ReadonlyRootfs": True, "RestartPolicy": {"Name": "unless-stopped"}},
            "State": {"Running": True, "Paused": False, "Restarting": False,
                      "StartedAt": "2026-11-03T00:00:00Z", "Health": {"Status": "unhealthy"}}}


class BrokerControllerTests(unittest.TestCase):
    def test_only_exact_unhealthy_broker_is_eligible(self):
        item = container()
        self.assertTrue(broker.broker_identity(item, "broker"))
        self.assertFalse(broker.broker_identity(item, "worker"))
        for field, bad in (("Name", "/other"), ("Id", "short")):
            changed = container(); changed[field] = bad
            self.assertFalse(broker.broker_identity(changed, "broker"))
        for field, bad in (("User", "root"), ("Image", "other")):
            changed = container(); changed["Config"][field] = bad
            self.assertFalse(broker.broker_identity(changed, "broker"))
        changed = container(); changed["State"]["Health"]["Status"] = "healthy"
        self.assertFalse(broker.broker_identity(changed, "broker"))
        changed = container(); changed["State"]["Running"] = False
        self.assertFalse(broker.broker_identity(changed, "broker"))

    def test_unhealthy_broker_requires_observation_and_obeys_cooldown(self):
        item = container(); state = {}
        for now in (1000, 1060, 1120):
            state, decision = broker.controller.decide(item, "broker", state, now)
            self.assertEqual(decision, "observing")
        state, decision = broker.controller.decide(item, "broker", state, 1180)
        self.assertEqual(decision, "recover")
        state["recoveries"] = [1170]
        self.assertEqual(broker.controller.decide(item, "broker", state, 1181)[1], "cooldown")

    def test_apply_signals_only_broker_as_nonroot_after_recheck(self):
        core = broker.controller; item = container(); state = {}
        for now in (1000, 1060, 1120):
            state, _ = core.decide(item, "broker", state, now)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); root.chmod(0o700)
            release = root / "release.lock"; release.touch(mode=0o600)
            core.save_state(root, {"broker": state})
            with patch.object(core, "STATE_DIR", root), patch.object(core, "RELEASE_LOCK", release), \
                 patch.object(core.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=os.getuid())), \
                 patch.object(core.time, "time", return_value=1180), \
                 patch.object(core, "inspect_container", return_value=item), \
                 patch.object(core.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                core.run(True)
            self.assertEqual(run.call_args.args[0], ["docker", "exec", "--user", "1883:1883", "a" * 64,
                                                       "/bin/sh", "-c", "kill -TERM 1"])


if __name__ == "__main__":
    unittest.main()
