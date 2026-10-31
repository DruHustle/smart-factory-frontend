# Oracle API and singleton worker

Current maintained target: Vercel serves the React application and proxies the API to `https://api.152-70-22-84.sslip.io`. The existing Oracle ARM64 host runs the API and a separate singleton worker from the same immutable non-root image. The private BaSyx/Caddy stack remains separate. Managed PostgreSQL, Redis and MQTT retain their existing providers.

The API role starts Node, Device, Identity and Analytics. The worker role starts Telemetry and Notification. Compatibility variables retain the historical names `RENDER_SERVICE_ROLE` and `BACKEND_DEPLOYMENT_MODE=render-bundle`; these do not imply Render hosting. API ports remain loopback-bound behind Caddy. Exactly one MQTT worker may use the commissioned consumer identity.

The [16 October manifest](release-manifest.json) is historical evidence. It does not describe the latest hosted image. Read `/api/runtime/contract` for the running candidate's source revisions, migration digest, capability version and recent worker receipt. See [operating evidence and recovery](../../docs/operations.md). Existing deployments predating contract version 2 cannot attest these capabilities and must be qualified API-first before this UI is promoted.

## Prepare a candidate

Use clean pinned revisions of all three repositories. Never package environment files or keys. Set full source SHAs as build arguments; never use branch names as runtime identity.

```bash
python3 scripts/prepare-backend-context.py ../smart-factory-backend /tmp/factory-backend-context
docker buildx build --load --platform linux/arm64 \
  --build-context backend=/tmp/factory-backend-context \
  --build-arg SOURCE_REVISION="$FRONTEND_SHA" \
  --build-arg BACKEND_SOURCE_REVISION="$BACKEND_SHA" \
  --build-arg EDGE_SOURCE_REVISION="$EDGE_SHA" \
  -f deploy/render/Dockerfile -t smart-factory-backend:qualified-candidate .
BUNDLE_IMAGE=smart-factory-backend:qualified-candidate python3 scripts/bundle-smoke.py
python3 scripts/audit-container.py smart-factory-backend:qualified-candidate
```

Run the current trusted MQTT path, outage/restart, units/scope, AAS, session, notification and disposable restore acceptance before promotion. Generate the candidate manifest with `scripts/create-release-manifest.mts` using the tested image reference, image inspection and actual clean source revisions. Retain the image ID, immutable registry digest when pushed, architecture, exact sources and qualification evidence together. A tag alone is insufficient. An image ID from a local build is not a registry digest.

No production mutation is implied by building or qualifying a candidate.

## Approved production update

Backend deployment remains manual and requires explicit approval for the concrete qualified candidate. Retain the prior image and owner-only rollback configuration. Environment files remain mode 0600, using Compose raw env-file mode to preserve literal credentials. Docker Compose 2.30+ is required. Do not replace environment files during ordinary image updates.

Transfer the exact tested ARM64 image into `/opt/smart-factory-backend`, inspect its image ID/digest and source labels, and select it in the existing `.env`. Stop the existing worker before any replacement starts. Start the API role, allow its bounded additive migrations to finish, and verify liveness, readiness, applied-schema identity, current account policy and the four supervised API processes. Start one worker only, then verify its two processes, MQTT subscription, durable outbox and authenticated recent status receipt. Do not run a second worker for a rolling release.

Before the UI changes, run:

```bash
API_ORIGIN=https://api.152-70-22-84.sslip.io node --import tsx scripts/verify-runtime.mts
```

The Vercel workflow requires successful CI for the exact current main SHA. It checks the API contract before building, repeats the contract check after building, and rechecks current main immediately before promotion. It retains the API identity used. Independent Vercel Git deployment for main stays disabled. The legacy Render workflow stays gated off. Do not change repository protection or infrastructure as part of a routine release.

After approved promotion, inspect `/release.json`, `/api/runtime/contract`, login/current-role/session revocation, scoped inventory, gateway routes, AAS reads and operating evidence through the Vercel origin. Software deployment acceptance does not establish hardware, physical movement or external Onesa consumer acceptance.

## Rollback

The qualified rollback sources are pinned in [rollback-sources.json](../rollback-sources.json).
The pinned API rollback records the API source observed in production on 31 October 2026, paired
with its deployed backend and edge revisions. Its frontend repository source identifies the API bundle,
not the separate Vercel UI artifact. The prior UI source observed at that time was
`007340d18e2833acda34c8e3c80002ae9b7ae1d8`; retain that artifact separately. Capture `/release.json` again at cutover and retain the actual current UI artifact if it has advanced. Qualify the pinned API rollback against additive
`0035_industrial_connectivity` and the nullable backend connectivity column in a disposable restore before promoting the candidate. The candidate UI requires `industrial-connectivity-v1` in addition to `account-requests-v1`, `account-role-approval-v1` and `password-reset-v1`; the live API and matching worker must support them before frontend promotion. Set the same non-secret `PASSWORD_RESET_ORIGIN` to the canonical frontend origin on the API and worker. Reuse their existing matching `DASHBOARD_SERVICE_TOKEN` and leave SMTP/Resend/SES credentials on the worker. Verify delivery configuration and recipient policy without broadening allowed recipients.
The pinned backend retains administrator-only infrastructure access, the reduced
connection budget and authenticated worker receipts. ARM64 qualification retains
both tested image archives, image inspection and archive checksums in the same
workflow artifact. Inspect the retained manifest for the exact runtime contract;
do not infer compatibility from a mutable tag or an older deployment record.

Retain the prior Oracle image and Vercel artifact. Stop the candidate worker before starting the prior worker. Validate the prior application's compatibility with the additive database schema and current session/evidence contracts. API-first upgrades remain mandatory. When rollback would remove a capability required by the current frontend, first restore the verified prior frontend while the candidate API still serves it, then restore the qualified API/worker pair. The connectivity frontend requires the new routes and migration; restore the prior frontend before rolling the API back. An API failure before frontend promotion can be recovered directly because the prior frontend is still active. Do not reverse migrations or delete evidence as an application rollback. Restore data only through a separately approved recovery procedure with verified backups.

### Industrial telemetry during rollback

The pinned prior API and worker do not understand `connectivity`. They can strip that field, accept an empty legacy observation and acknowledge it. Additive schema compatibility and a successful HTTP response therefore do not establish industrial-data preservation. The ARM64 rollback smoke qualifies application/schema/session compatibility; it does not qualify the old software to ingest new industrial observations.

If industrial acquisition has been commissioned, use this order:

1. Restore the prior UI while the compatible API remains available. Freeze connectivity edits and probes for the maintenance window.
2. Stop every affected gateway service and prevent its automatic restart. Preserve its saved configuration, revision and SQLite queue. Verify that no other process is publishing under the affected gateway identities. Do not publish a higher empty/disabled revision as the first step: previously unseen reports buffered under the old revision would then fail revision validation.
3. Keep the compatible API and singleton worker running while their commissioned MQTT deliveries and industrial outbox drain at the existing revision. Include future retries and quarantined reports in the review. Reconcile reports delivered in this drain with their gateway/event identities in retained `industrial_observation_history`, or protected acceptance evidence when the bounded history has expired; check configuration receipts against applied revision state. A forwarding timestamp alone is insufficient.
4. Preserve any residual gateway SQLite backlog offline. Record it as held data; the normal gateway runtime has no acquisition-only drain mode. Neither the old nor the new gateway may replay those envelopes into the old consumer. An old gateway version can still forward raw payloads from the shared queue.
5. Stop the new worker before restoring the prior API/worker pair. Keep the affected gateways stopped for the entire period in which the old services run. Preserve broker sessions, additive schema and all evidence. If any cloud industrial backlog cannot be drained or reconciled, leave the incompatible worker stopped instead of consuming that backlog.
6. To resume industrial acquisition, restore and verify the compatible API and singleton worker first, then restart gateways with their preserved revision/configuration. Handle held reports before changing configuration.

The following read-only query on the backend telemetry database includes retry-delayed and quarantined industrial records:

```sql
SELECT
  count(*) FILTER (WHERE "DashboardForwardedAt" IS NULL
    AND "DeliveryQuarantinedAt" IS NULL) AS pending,
  count(*) FILTER (WHERE "DeliveryQuarantinedAt" IS NOT NULL) AS quarantined
FROM public."TelemetryRecords"
WHERE "ConnectivityJson" IS NOT NULL;
```

The broker's relevant delivery backlog must also be reconciled; this SQL query is not a broker-drain check. If an emergency prevents compatible drainage, preserve the queues and hold ingestion. Do not clear forwarding flags or delete dashboard duplicates to force recovery after accidental downgrade delivery: the old API may have stored the original ingestion identity without its industrial content, requiring reviewed reconciliation of both stores.

Historical Render rollback configuration is not an instruction to reactivate Render. A hosting cutover requires its own reviewed plan and approval.

## Discard superseded container images after deployment

Successful release finalization must run `cleanup-images.py` on Oracle after API, singleton worker, frontend promotion and live verification. Supply the current and qualified rollback **Docker image IDs reported by the production engine** (`sha256:` plus 64 hex digits; inspect the current and rollback references with `docker image inspect`), the qualified API source and the deployed frontend source. First review the default plan, then repeat with `--apply`. Retain its JSON report in the protected release evidence.

```bash
python3 cleanup-images.py --current-image "$CURRENT_IMAGE_ID" \
  --rollback-image "$QUALIFIED_ROLLBACK_IMAGE_ID" \
  --api-source "$QUALIFIED_API_SHA" --frontend-source "$DEPLOYED_FRONTEND_SHA"
# After successful live verification, use the same exact arguments with --apply.
```

Cleanup removes superseded, unreferenced Smart Factory images with all three source labels. It always keeps the current release, the verified rollback image, and every image referenced by any running or stopped container. It rechecks the local/proxied API source, schema and worker receipt, the published frontend source, and exactly one current API/worker before removal. No global prune, forced removal, volume deletion, unrelated application cleanup or build-cache purge is used. Retained qualification archives and protected database/configuration recovery evidence remain available. A refused deletion is reported and retained for review.
