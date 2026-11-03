#!/usr/bin/env python3
"""Bounded recovery of the exact Smart Factory Mosquitto container."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("container_controller", Path(__file__).with_name("container-controller.py"))
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)

IMAGE = "eclipse-mosquitto:2.1.2-alpine@sha256:860aeb5d63ce509508f6dcfb2bc8a1c1dd2bc60555b562b45ce90e52d8dabb0f"


def broker_identity(container, service):
    config = container.get("Config") or {}
    labels = config.get("Labels") or {}
    state = container.get("State") or {}
    host = container.get("HostConfig") or {}
    return (
        service == "broker"
        and container.get("Name") == "/smart-factory-mqtt-broker-1"
        and labels.get("com.docker.compose.project") == "smart-factory-mqtt"
        and labels.get("com.docker.compose.service") == "broker"
        and labels.get("com.docker.compose.container-number") == "1"
        and config.get("User") == "1883:1883"
        and config.get("Image") == IMAGE
        and (host.get("RestartPolicy") or {}).get("Name") == "unless-stopped"
        and host.get("ReadonlyRootfs") is True
        and state.get("Running") is True
        and not state.get("Paused")
        and not state.get("Restarting")
        and (state.get("Health") or {}).get("Status") == "unhealthy"
        and isinstance(container.get("Id"), str)
        and len(container["Id"]) == 64
        and isinstance(state.get("StartedAt"), str)
    )


# This is a separate process and state directory. The existing controller and
# its two-service allowlist are unchanged in their own running process.
controller.PROJECT = "smart-factory-mqtt"
controller.SERVICES = ("broker",)
controller.EXEC_USERS = {"broker": "1883:1883"}
controller.STATE_DIR = Path("/var/lib/smart-factory-mqtt-controller")
controller.identity = broker_identity


if __name__ == "__main__":
    raise SystemExit(controller.main())
