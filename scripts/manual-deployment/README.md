# Smart Factory manual deployment

`local-tools/manual deployment/` is the entry point. The physical `local-tools`
directory also contains release evidence under `local-tools/deployment-evidence`.
All paths below preserve the space.

The maintained target is the existing Oracle ARM64 API and **one** worker,
followed by Vercel. Backend here includes Node API plus Device, Identity,
Analytics, Telemetry and Notification. The edge operation packages a gateway;
it does not install software or actuate hardware.

## Setup and commands

Python 3.9+, Git and the three existing repositories are required for offline
plans. `config.json` selects their parent; `--source-root` overrides it. The
workspace configuration selects the active component checkouts; use
`deploy.py inventory` to confirm the exact paths and revisions. Preserved review
worktrees can be selected explicitly with `--source-root`. Use clean committed sources for
packaging. Frontend qualification pins must match backend and edge commits.

For qualification: native ARM64 Docker with the containerd image store, Buildx,
Compose, 12 GiB free local space and the repository's documented dependencies.
For deployment: existing trusted SSH host/key/agent and noninteractive sudo;
GitHub CLI authentication for frontend dispatch; Vercel credentials stay in the
existing GitHub production environment. Do not put secrets in CLI arguments.
No new environment file is sourced by these launchers.

```bash
SF_ROOT='/Users/andrewgotora/Software Development/GitHub/smart-factory'
MANUAL="$SF_ROOT/local-tools/manual deployment"
SOURCES="$SF_ROOT"
RELEASE="$SF_ROOT/local-tools/deployment-evidence/manual-reviewed-release"

python3 "$MANUAL/deploy.py" inventory
bash "$MANUAL/deploy-all.sh" --dry-run --release-dir "$RELEASE"
```

Every command defaults to an **offline plan**. `--validate` checks local inputs
(including the complete artifact for backend/all); it makes no target changes.
`--execute` performs the named operation. A successful plan is not qualification.
The existing release policy still requires authorization for the exact qualified
candidate before production mutation. Nothing in setup grants that approval.

| Command | Purpose |
|---|---|
| `deploy.py inventory` | Show paths, branches, revisions, dirty state and target |
| `deploy.py package` | Create exact Git bundles and a pinned source plan |
| `deploy.py prepare` | Build/test/scan native candidate and independent fallback |
| `deploy-backend.sh` | Verify artifact, deploy API then singleton worker |
| `deploy-frontend.sh` | Dispatch existing gated main workflow and await its result |
| `package-edge.sh` | Package tracked gateway source, fixtures and offline wheels |
| `deploy-all.sh` | Backend/API/worker → gated frontend → verification |
| `status.sh` | Read public identities, or reconnect to a saved VM job |
| `verify-release.sh` | Check exact frontend, API schema/capabilities and worker |
| `recover.sh` | Read saved status and show established recovery guidance |

Capture the running baseline, package **clean committed** candidate sources,
then qualify. These steps do not deploy:

```bash
bash "$MANUAL/status.sh" --execute --release-dir "$RELEASE"
python3 "$MANUAL/deploy.py" package --execute --release-dir "$RELEASE" \
  --baseline "$RELEASE/observed-baseline.json"
python3 "$MANUAL/deploy.py" prepare --validate --release-dir "$RELEASE"
python3 "$MANUAL/deploy.py" prepare --execute --release-dir "$RELEASE"

MANIFEST="$RELEASE/qualification/release-manifest.json"
BUNDLE="$RELEASE/qualification/qualified-arm64-bundle.zip"
FRONTEND_SHA="$(git -C "$SOURCES/smart-factory-frontend" rev-parse HEAD)"
```

Qualification reuses `scripts/prepare-manual-release.py` and `deploy-vm.py`.
It checks image/source identities, real packaged services, migration idempotence,
authenticated email capture, industrial data preservation during fallback, and
the image vulnerability scan. Work, temporary files and the shared fixture lock
stay inside this workspace. A failed preparation never produces release approval.

After the candidate has met the release policy, deploy components separately:

```bash
bash "$MANUAL/deploy-backend.sh" --validate --release-dir "$RELEASE" \
  --manifest "$MANIFEST" --bundle "$BUNDLE"
bash "$MANUAL/deploy-backend.sh" --execute --release-dir "$RELEASE" \
  --manifest "$MANIFEST" --bundle "$BUNDLE"
bash "$MANUAL/deploy-frontend.sh" --execute --release-dir "$RELEASE" \
  --sha "$FRONTEND_SHA" --manifest "$MANIFEST"
bash "$MANUAL/verify-release.sh" --execute --release-dir "$RELEASE" \
  --sha "$FRONTEND_SHA" --manifest "$MANIFEST"
```

Or use the same qualified inputs for a coordinated deployment:

```bash
bash "$MANUAL/deploy-all.sh" --execute --release-dir "$RELEASE" \
  --manifest "$MANIFEST" --bundle "$BUNDLE" --sha "$FRONTEND_SHA"
```

The frontend SHA must be current remote `main` with successful push CI; merging a
PR may create a new SHA requiring fresh qualification. The existing workflow
rechecks API compatibility and current main after its build. A backend success
does not make a failed frontend release successful. Read the retained step logs.

## Edge packaging

Supply audited wheels built/downloaded for the actual Pi Python/architecture.
The installer enforces the repository's hashed requirements and runs its tests
as the service user before cutover. Packaging uses tracked Git blobs, never local
credentials, virtualenvs, queues, caches or generated files.

```bash
bash "$MANUAL/package-edge.sh" --execute --release-dir "$RELEASE" \
  --wheels "$SF_ROOT/local-tools/release-tools/pi-wheels"
```

The command prints the checksummed bundle path. On the commissioned Pi, after
transferring that exact bundle and authorizing installation, run its root-level
`install-telemetry-release.py` with `sudo python3`. Follow the edge repository's
`raspberry-pi/README.md`; verify applied revision, service health, MQTT receipt and
cloud observations. `rollback.sh` in the installed release restores the prior
managed override. The package does not flash ESP32 firmware. Compile firmware
with the edge repository's pinned PlatformIO configuration; flashing needs a
separately selected physical target. API edge labels alone do not attest a Pi.

## Status, failure and recovery

A local `release-hold.json` records a candidate that must not be promoted after
review findings. Its presence in the release directory, or an ancestor of the
selected manifest/bundle within deployment evidence, blocks `backend`, `frontend`
and `all` in both `--validate` and `--execute` modes before any deployment command.
Even an unreadable or malformed hold blocks promotion. Offline plans list holds;
status, verification and recovery remain available. Preserve the held artifacts
and findings, correct the source, and qualify a new candidate in a new release
directory. This is an operational guard for local records, not tamper protection
or a substitute for exact-revision release approval.

```bash
bash "$MANUAL/status.sh" --execute --release-dir "$RELEASE" --manifest "$MANIFEST"
bash "$MANUAL/recover.sh" --execute --release-dir "$RELEASE" --manifest "$MANIFEST"
```

Reuse the same release directory/manifest. The detached VM job survives SSH
disconnects. Its proven engine automatically selects the independently qualified
fallback when cutover fails. `ROLLED_BACK`, `NEEDS_REVIEW`, interrupted work and
failed checks return nonzero; they are not successful upgrades. Do not start a
second commissioned worker or replay an unknown in-progress release.

For a later rollback, follow `deploy/oracle/README.md` in the selected frontend
checkout: retain/restore a compatible prior UI first when necessary, then use
the qualified API/worker pair with worker-stop/API-first ordering. Never choose
the older retained image that loses industrial fields, reverse migrations or
restore production data as an ordinary application rollback. Data recovery needs
verified backups and its established approval. These tools back up configuration
and retain images; they do not claim a current production database backup.

Each execution writes private `request.json`, logs and `result.json` in an
`invocation-*` directory. The stable `vm-deployment.json` reconnects to the VM.
Historical helpers/evidence remain read-only records, not active entry points.
The workspace's `cleanup-manifest.json` records verified removals and recovery.

The launchers are installed from the selected frontend repository's
`scripts/manual-deployment/`; that directory is the version-controlled source.
Repository-owned Docker/Compose files, migrations, verifier code and runtime
code stay in their repositories. To inspect/reinstall identical launchers:

```bash
python3 "$SOURCES/smart-factory-frontend/scripts/manual-deployment/install.py" \
  --workspace "$SF_ROOT" --source-root "$SOURCES"
# Repeat with --execute to install. Differing existing files are preserved for review.
```
