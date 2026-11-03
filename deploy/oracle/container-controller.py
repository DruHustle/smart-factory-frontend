#!/usr/bin/env python3
"""Bounded recovery for the two Smart Factory containers; dry-run by default."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import tempfile
import time

PROJECT = "smart-factory-backend"
SERVICES = ("api", "worker")
WAIT_SECONDS = 180
MAX_OBSERVATION_GAP = 90
COOLDOWN_SECONDS = 900
WINDOW_SECONDS = 21600
MAX_RECOVERIES = 3
STATE_DIR = Path("/var/lib/smart-factory-controller")
RELEASE_LOCK = Path("/home/ubuntu/smart-factory-releases/.smart-factory-release.lock")


def log(event, **fields):
    print(json.dumps({"event": event, **fields}, sort_keys=True), flush=True)


def inspect_container(name):
    result = subprocess.run(["docker", "inspect", name], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError("Docker inspection failed for " + name)
    value = json.loads(result.stdout)
    if len(value) != 1:
        raise RuntimeError("Docker inspection returned an unexpected result")
    return value[0]


def identity(container, service):
    config = container.get("Config") or {}
    labels = config.get("Labels") or {}
    state = container.get("State") or {}
    host = container.get("HostConfig") or {}
    return (
        container.get("Name") == f"/{PROJECT}-{service}-1"
        and labels.get("com.docker.compose.project") == PROJECT
        and labels.get("com.docker.compose.service") == service
        and labels.get("com.docker.compose.container-number") == "1"
        and config.get("User") == "app"
        and (host.get("RestartPolicy") or {}).get("Name") == "unless-stopped"
        and host.get("Init") is True
        and state.get("Running") is True
        and not state.get("Paused")
        and not state.get("Restarting")
        and (state.get("Health") or {}).get("Status") == "unhealthy"
        and isinstance(container.get("Id"), str)
        and len(container["Id"]) == 64
        and isinstance(state.get("StartedAt"), str)
    )


def decide(container, service, previous, now):
    history = [value for value in previous.get("recoveries", [])
               if isinstance(value, (float, int)) and 0 <= now - value < WINDOW_SECONDS]
    result = {"recoveries": history}
    if not identity(container, service):
        return result, "not-eligible"
    marker = container["Id"] + ":" + container["State"]["StartedAt"]
    since = previous.get("unhealthy_since") if previous.get("marker") == marker else None
    last_observed = previous.get("last_observed")
    if (not isinstance(since, (float, int)) or since > now
            or not isinstance(last_observed, (float, int))
            or not 0 <= now - last_observed <= MAX_OBSERVATION_GAP):
        since = now
    result.update(marker=marker, unhealthy_since=since, last_observed=now)
    if now - since < WAIT_SECONDS:
        return result, "observing"
    if len(history) >= MAX_RECOVERIES:
        return result, "limit-reached"
    if history and now - max(history) < COOLDOWN_SECONDS:
        return result, "cooldown"
    return result, "recover"


def private_regular(fd, owner):
    info = os.fstat(fd)
    return stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == owner


def save_state(state_dir, state):
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=state_dir)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, state_dir / "state.json")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_state(state_dir):
    path = state_dir / "state.json"
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return {}
    with os.fdopen(fd) as stream:
        if not private_regular(stream.fileno(), os.geteuid()):
            raise RuntimeError("Controller state is not a private owned file")
        state = json.load(stream)
    if not isinstance(state, dict) or any(not isinstance(v, dict) for v in state.values()):
        raise RuntimeError("Invalid controller state")
    return state


def run(apply):
    info = STATE_DIR.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError("Controller state directory must be owned by the controller and mode 0700")
    lock_fd = os.open(STATE_DIR / "controller.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "r+") as lock:
        if not private_regular(lock.fileno(), os.geteuid()):
            raise RuntimeError("Controller lock must be a private owned file")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("already-running")
            return
        state = load_state(STATE_DIR)
        for service in SERVICES:
            name = f"{PROJECT}-{service}-1"
            now = time.time()
            container = inspect_container(name)
            state[service], decision = decide(container, service, state.get(service, {}), now)
            log("inspection", service=service, decision=decision, mode="apply" if apply else "dry-run")
            if decision != "recover" or not apply:
                save_state(STATE_DIR, state)
                continue
            # The release tool owns this lock. Do not create or replace it.
            release_fd = os.open(RELEASE_LOCK, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(release_fd) as release:
                if not private_regular(release.fileno(), pwd.getpwnam("ubuntu").pw_uid):
                    raise RuntimeError("The release lock is not the expected private ubuntu-owned file")
                try:
                    fcntl.flock(release, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    log("release-in-progress", service=service)
                    save_state(STATE_DIR, state)
                    continue
                current = inspect_container(name)
                if not identity(current, service) or current["Id"] != container["Id"] or current["State"]["StartedAt"] != container["State"]["StartedAt"]:
                    log("state-changed", service=service)
                    state[service].pop("unhealthy_since", None)
                    state[service].pop("marker", None)
                    save_state(STATE_DIR, state)
                    continue
                # Record the attempt before acting so failures cannot create a restart loop.
                state[service]["recoveries"].append(now)
                state[service].pop("unhealthy_since", None)
                state[service].pop("marker", None)
                save_state(STATE_DIR, state)
                result = subprocess.run(["docker", "exec", "--user", "app", current["Id"], "/bin/sh", "-c", "kill -TERM 1"], capture_output=True, timeout=20)
                if result.returncode:
                    log("recovery-failed", service=service)
                    raise RuntimeError("Recovery signal failed; inspect the container and journal")
                log("recovery-signalled", service=service, container=current["Id"][:12])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="signal eligible containers; default is dry-run")
    args = parser.parse_args()
    try:
        run(args.apply)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, RuntimeError) as error:
        log("error", message=str(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
