# Manual VM release from the reviewed source package

For the canonical multi-repository Smart Factory workspace, start with the
[manual deployment commands](../scripts/manual-deployment/README.md). The active
launchers live in `local-tools/manual deployment/`. They keep source preparation, fixture locks,
logs and receipts inside the workspace, support offline plans from any working
directory, and reuse the qualification/deployment engines described below.
They also cover the gated Vercel release, edge packaging and release verification.

The standalone downloadable installer described below remains a supported private
source-delivery option; it is not needed by the workspace launchers.

The downloadable `smart_factory_deploy_vm.py` installer contains the reviewed
source changes for all three repositories. It prepares and qualifies a native
ARM64 candidate and an independent connectivity-aware fallback on your own
machine before an explicit deployment to `ubuntu@152.70.22.84`.

The installer template is [manual-installer.py](../scripts/manual-installer.py).
The source-package plan records immutable commits and Git-bundle checksums; the
downloadable release embeds that plan and those bundles. This is a private source
delivery path: public GitHub publication is not a prerequisite. Downloading public
baseline repositories and container dependencies still requires internet access.

## Requirements

- Native Apple Silicon macOS or Linux ARM64, Python 3.9 or later, and Git.
- A running local ARM64 Docker engine, Buildx, and Docker Compose 2.20 or later.
- Docker's **containerd image store** enabled. On Docker Desktop this is the
  setting named **Use containerd for pulling and storing images**. The verifier
  needs the actual OCI manifest retained by that store.
- At least 4 GiB of memory allocated to Docker, 12 GiB of free local working
  space, and local port 3110 available. Large existing caches or concurrent
  workloads may require more space.
- For deployment: existing OpenSSH access to the VM using
  `~/.ssh/id_ed25519`, an already trusted VM host key, and the existing user's
  noninteractive sudo access. Load an encrypted key into your normal SSH agent
  before starting. The installer keeps strict host-key verification enabled.
- The existing VM deployment at `/opt/smart-factory-backend`, Docker Compose
  2.30 or later, and at least 6 GiB of free VM space. The script checks the
  observed source identities, schema, configuration and singleton worker before
  uploading or replacing the application.

The local engine must be a Unix-socket engine. Remote Docker contexts, TCP/SSH
Docker hosts and x86 emulation are refused. Existing qualification fixture
resources are also refused for separate inspection; the installer does not
remove someone else's stack to free a name or port.

### Correction for an unreadable telemetry migration manifest

The initial private installer could build migration files with permissions that
prevented the application's non-root user from reading them. Its acceptance test
stopped with `UnauthorizedAccessException` for
`/app/telemetry-migrations/manifest.json`, before any VM access.

The corrected installer creates verified build contexts from the exact tracked
Git blobs, with ordinary source-file permissions inside a private work directory.
This also corrects the independently pinned fallback without changing its source.
The candidate image explicitly keeps migration files root-owned and readable,
with no write permission for the application. Both images must pass a migration
readability check as their configured non-root user before the full test suite.

Replace the downloaded installer with the corrected version and run its normal
`--deploy` command. Its changed source package selects a new private work
directory and new image tags, preserving the earlier failed run for inspection.
Both images are rebuilt and all qualification gates run again. Do not point the
corrected installer at the old release's work directory.

## Commands

Save the downloaded installer in Downloads, then run:

```bash
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --inspect
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --check
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --deploy
```

`--inspect` prints the embedded source identities and target without requiring
Docker or contacting the VM. `--check` checks the source package and local
prerequisites only. `--deploy` first completes the local build, acceptance,
rollback and vulnerability gates, then performs the VM preflight and deployment.

To finish all local qualification before starting the deployment, run:

```bash
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --prepare
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --deploy
```

A completed preparation is reusable only after its manifest, source plan, exact
archive bytes and qualification evidence are revalidated. A changed or corrupt
artifact is refused. Work is retained under a private, release-specific directory
inside `~/.smart-factory-manual/`; the installer prints the relevant paths.
`--work-dir /absolute/path` selects a different private release directory. Use
the same option on every later command for that release. A new work directory
must be empty; unrelated files are never overwritten.

## What local preparation proves

[prepare-manual-release.py](../scripts/prepare-manual-release.py) downloads the
canonical public baseline repositories into isolated checkouts, applies the
embedded Git bundles and verifies all three exact commits. It also checks the
candidate's qualification pins and the independent fallback pins. Existing
development checkouts and environment files are not used for the image build.

Preparation builds both native ARM64 images locally with exact source labels and
then runs the actual disposable packaged stack. Its acceptance gates cover
runtime and schema readiness, session and authorization boundaries, AAS and
scoped data, MQTT ingestion, queue recovery, notifications, and the complete
password-reset path through Node, the notification queue, the C# sender,
authenticated STARTTLS delivery and password redemption.

The fallback test ingests distinct industrial observations before fallback,
while fallback is active, and after restoring the candidate. It checks raw
history, acknowledgement and the API representation, including null quality and
64-bit values. It also checks that an active viewer remains active and a revoked
account remains rejected. These are real disposable service tests, not flags
inferred from source compatibility.

The candidate must pass the pinned container vulnerability scanner without
HIGH or CRITICAL findings. Current vulnerability data is downloaded at
preparation time. A newly reported finding stops the release for review.

Only a fully qualified run writes the final manifest. The exported ZIP contains
exactly seven files: both image archives, their checksums, both image inspections,
the acceptance result and the container audit. The deployment verifier binds
actual OCI config and manifest digests, source labels and evidence to those exact
archive bytes. Synthetic unit tests of the installer itself do not substitute
for these actual image tests.

## What the VM deployment does

[deploy-vm.py](../scripts/deploy-vm.py) verifies the qualified artifact again and
checks the existing live deployment. Unexpected source, schema or configuration
drift, an incompatible current frontend, a duplicate worker, or inadequate free
space stops the operation.

The update preserves the existing environment and Compose configuration, records
private configuration backups, retains the installed image under a protected
reference, and loads the tested candidate and fallback images. It keeps provider
credentials and recipient policy unchanged. Where needed, it adds only the
canonical password-reset origin and the email-delivery configuration indicator
derived from the existing provider configuration.

It then stops the existing worker, starts the API, waits for the applied schema
and all four API processes, starts exactly one worker and waits for both worker
processes, MQTT and notification readiness, and a fresh authenticated worker
receipt. The order is API-first; two workers must never share the commissioned
consumer identity.

A failure after replacement starts invokes the independently qualified
connectivity-aware fallback. That fallback is different from the older installed
image retained for forensic recovery. The older image can lose industrial fields
and is never selected automatically once connectivity evidence is present.
Rollback uses the same API-before-worker checks and returns a nonzero result so
the failure cannot be mistaken for a successful upgrade.

The VM job runs independently of the local SSH connection. To reconnect:

```bash
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --status
```

For one status snapshot:

```bash
python3 "$HOME/Downloads/smart_factory_deploy_vm.py" --status --once
```

Status uses the saved receipt; it does not build or redeploy. Repeating
`--deploy` for the same started release also reconnects to that job. Preserve the
local work directory and the protected VM release directory if any step needs
review.

## Read the result

`BACKEND_DEPLOYED` means the tested candidate is serving the existing VM API and
the single worker has passed its live readiness and receipt checks.
`ROLLED_BACK`, `NEEDS_REVIEW`, `STOPPED_BEFORE_CHANGES` and any verification error
are not successful deployments. Read the phase and retained evidence before
retrying. A lost connection is not proof that the detached job stopped.

This operation backs up application configuration and retains images; it does
not create a production database backup or reverse database migrations. It does
not change a user's password, deliver mail to a real inbox, provision hardware,
install Raspberry Pi gateway software or publish the separate Vercel frontend.
The edge source label in an API image is release provenance, not proof that a
gateway has received that code.

After the API and worker are verified, promote the matching reviewed frontend
through the [existing gated release procedure](../deploy/oracle/README.md).
The new connectivity UI must wait for the API's
`industrial-connectivity-v1` capability. The optional Assistant provider chooser
handles a compatible older API without making that capability mandatory for
rollback. Source publication and frontend promotion remain separate explicit
actions. Test the intended real account and mailbox after their operator has
confirmed access; software fixtures cannot establish either.

Retain the qualified image pair and release evidence until the full frontend and
backend release has been verified. Image cleanup follows the separate reviewed
procedure in the VM runbook after successful frontend promotion and live checks.
