# Oracle API and singleton worker

Status on 2026-10-16: ARM64 image built, acceptance suite passed, vulnerability
scan returned zero high/critical findings, and image loaded on the VM. The API
and worker have not been started. Credential transfer, live configuration
reconciliation, worker ownership and Vercel cutover are pending explicit
credential-transfer approval. The existing Render deployment is still active.

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
delivery. Do not run the two production workers together. A blank local
`SMTP_PASSWORD` must be reconciled against the live worker configuration.

Set `API_ORIGIN=https://api.152-70-22-84.sslip.io` and run
`pnpm vercel:configure` before building and deploying the Vercel artifact.
Verify login/session cookies, authorization, queries, AAS access and health
through the actual Vercel domain. Suspend the old Render API only after these
checks pass. Disable the old Render release path before merging this migration;
it otherwise resumes deploying the old host on a main-branch push.

For rollback, stop the Oracle worker first, resume the Render worker, and deploy
the previous Vercel artifact pointing to the old API. Keep the previous image,
Caddyfile and environment files until acceptance is complete. Database migrations
run at container startup; restore database backups separately if a future release
introduces an incompatible schema change.
