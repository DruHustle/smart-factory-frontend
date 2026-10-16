# Oracle API and singleton worker

Status on 2026-10-16: API and worker run on Oracle and pass readiness.
Vercel proxies the production UI to `https://api.152-70-22-84.sslip.io`.
Both Render services remain suspended. The legacy Render production release
workflow is disabled, with an additional `RENDER_ROLLBACK_ENABLED=true` gate;
standard quality CI stays enabled. After a successful push-triggered main CI run,
`deploy-vercel-oracle.yml` builds and deploys that exact current main revision to
Vercel with the Oracle API rewrite. It also supports manual dispatch from main,
requiring successful main CI for the same revision. The committed Vercel Git
configuration disables independent Git deployments for main so production waits
for this checked workflow; other branches retain preview deployments. Production backend image
updates currently use the manual procedure below; Oracle backend image deployment
automation has not been configured.
The ARM64 image passed the six-service acceptance suite and a vulnerability
scan with zero high/critical findings. Live acceptance verified login, secure
session cookies, identity delegation, protected dashboard reads, logout and all
six authenticated BaSyx description endpoints.

The worker recovered its persistent MQTT session after initial acknowledgement
errors during backlog replay. Mixed QoS 0/1 persistence passed local acceptance.
Physical Pi and WROVER checks subsequently passed: fresh DHT11 readings reached
the application through Oracle, both devices stayed online, and the Pi delivery
queue drained. The telemetry-efficiency release measured 75.3% fewer forwarded
sensor payload bytes over four minutes while preserving every value/status/button
change. Five-second sensor sampling remains local; repeated live readings are
coalesced with roughly one-minute snapshots and Pi heartbeats. No numeric deadband
is enabled. Outage, queue-full redelivery and durable-reopen probes passed on the Pi.

The existing Oracle ARM64 VM at `152.70.22.84` hosts BaSyx and Caddy in
`/opt/smart-factory-basyx`. This stack adds the existing combined backend image
as separate API and worker containers in `/opt/smart-factory-backend`.
PostgreSQL, Redis and MQTT retain their current managed providers and data.
The React UI stays on Vercel.

Build from the frontend checkout with the prepared backend context:

```bash
python3 scripts/prepare-backend-context.py ../smart-factory-iot-backend /tmp/factory-backend-context
docker buildx build --load --platform linux/arm64 --build-context backend=/tmp/factory-backend-context -f deploy/render/Dockerfile -t smart-factory-backend:oracle-20261016 .
BUNDLE_IMAGE=smart-factory-backend:oracle-20261016 python3 scripts/bundle-smoke.py
python3 scripts/audit-container.py smart-factory-backend:oracle-20261016
```

Copy `compose.yaml` and a `.env` selecting the image to the backend directory.
Install the API and worker environment exports as `.env.api` and `.env.worker`
with mode 0600. Compose's raw env-file mode preserves literal credentials,
including dollar signs, quotes, and the escaped PEM newlines used by the
entrypoint. Docker Compose 2.30 or newer is required. The role variable keeps its
existing `RENDER_SERVICE_ROLE` name for image compatibility.

Start `docker compose up -d api`, then verify both `/health/live` and
`/health/ready` on `http://127.0.0.1:10000`. Confirm the four API processes through
Supervisor. Append `Caddyfile.api` to the existing BaSyx Caddyfile, validate it
with `docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile`,
then reload it with `docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile`
from the BaSyx directory. The external Docker network connects Caddy directly to
`factory-api`; port 10000 stays bound to loopback. Verify the public HTTPS
readiness URL before changing Vercel.

For cutover, suspend the Render worker and confirm its state before starting
`docker compose --profile worker up -d worker`. Retain the exact MQTT client ID,
tokens, verified database connections and email settings. Check worker readiness
at `http://127.0.0.1:10001/health/ready`, both Supervisor processes, and MQTT
delivery. Do not run the two production workers together. Use the live worker configuration; the initial local export lacked the SMTP
password. The completed migration preserved the live SMTP credential.

Set `API_ORIGIN=https://api.152-70-22-84.sslip.io` and run
`pnpm vercel:configure` before building and deploying the Vercel artifact.
Verify login/session cookies, authorization, queries, AAS access and health
through the actual Vercel domain. Suspend the old Render API only after these
checks pass. The old Render release workflow is disabled in GitHub and additionally requires
`RENDER_ROLLBACK_ENABLED=true` before its verification/release jobs can run.
Keep it disabled while Oracle image updates use the manual deployment procedure.

For rollback, stop the Oracle worker first, resume the Render worker, and deploy
the previous Vercel artifact pointing to the old API. Keep the previous image,
Caddyfile and environment files until acceptance is complete. Database migrations
run at container startup; restore database backups separately if a future release
introduces an incompatible schema change.

## Updating the Oracle image

Transfer the tested ARM64 image with `docker save`, compression and `scp`, then
load it with `docker load -i <archive>` in `/opt/smart-factory-backend`. Keep the
old image and save the current `.env` as an owner-only rollback file. Stop the
worker with `docker compose --profile worker stop worker`, update `BACKEND_IMAGE`
in `.env`, and run `docker compose up -d api`. Wait for API readiness, then run
`docker compose --profile worker up -d worker` and check its readiness and MQTT
session. The worker container must remain single-instance throughout. Do not
replace the environment files during routine image updates.
