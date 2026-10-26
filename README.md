# Smart Factory IoT Dashboard

Full-stack IoT dashboard with React + Express + tRPC + Drizzle ORM.

Production uses Vercel for the React UI and the existing Oracle ARM64 VM for the
API, singleton worker and BaSyx. See [Oracle deployment](deploy/oracle/README.md).
The legacy Render release workflow is disabled; standard quality CI remains active.

## Stack

- Frontend: React, Vite, TailwindCSS
- Backend: Express, tRPC
- Database: PostgreSQL (local for dev, managed for prod)
- Auth: bcrypt password hashes, HttpOnly session cookie, server-side role checks
- Asset model: IDTA template-based AAS 3.x models, lifecycle history, and gateway mappings
- Standard AAS API: authenticated gateway to a private IDTA 3.2.0 AAS Environment service

## Prerequisites

- Node.js 22.12+ (production/CI uses Node 22; Node 20.19+ also meets the build requirements)
- pnpm 10+
- PostgreSQL database (Aiven or local)

## Development Setup (Step by Step)

1. Clone and enter the repo.

```bash
git clone https://github.com/DruHustle/smart-factory-iot-frontend
cd smart-factory-iot-frontend
```

2. Install dependencies.

```bash
pnpm install
```

3. Create `.env.local` from `.env.local.example`.

```bash
cp .env.local.example .env.local
```

Replace every `CHANGE_ME` value before starting the app. Generate a random URL-safe value with `openssl rand -hex 32`; use separate values for the database password, `JWT_SECRET`, and `INGESTION_API_TOKEN`. Do not reuse these local examples in production.

4. Configure PostgreSQL in `.env.local`.

```bash
NODE_ENV=development
PORT=3000
VITE_API_URL=/api
BACKEND_URL=http://localhost:3000
JWT_SECRET=CHANGE_ME_GENERATE_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES

# Development (local PostgreSQL)
DATABASE_URL=postgres://smartfactory_local:CHANGE_ME_DATABASE_PASSWORD@127.0.0.1:5432/smart_factory_iot
DATABASE_SSL_MODE=disable
# Development (local Redis container; logical database 0)
REDIS_URL=redis://:CHANGE_ME_DIFFERENT_LOCAL_REDIS_PASSWORD@127.0.0.1:6379/0

# Production (managed PostgreSQL)
# DATABASE_URL=postgres://<encoded-user>:<encoded-password>@<aiven-host>:<port>/<database>
# DATABASE_SSL_MODE=verify-full
# DATABASE_CA_CERT=-----BEGIN CERTIFICATE-----\n<Aiven-project-CA>\n-----END CERTIFICATE-----
# REDIS_URL=rediss://<user>:<encoded-password>@<redis-cloud-host>:<TLS-port>
```

5. Start local PostgreSQL for development. Replace `CHANGE_ME_DATABASE_PASSWORD` in both the `.env.local` URL and the command below with the same randomly generated password. Keep this local database bound to loopback.

```bash
docker run --name smart-factory-pg \
  -e POSTGRES_USER=smartfactory_local \
  -e POSTGRES_PASSWORD=CHANGE_ME_DATABASE_PASSWORD \
  -e POSTGRES_DB=smart_factory_iot \
  -p 127.0.0.1:5432:5432 -d postgres:16
```

6. Apply schema migrations.

```bash
pnpm db:migrate
```

7. Run the app.

```bash
pnpm dev
```

8. Open the app.

- http://localhost:3000

## Authentication Notes

- Frontend auth now uses tRPC procedures: `auth.login`, `auth.register`, `auth.me`, `auth.logout`.
- The session JWT is set in an `HttpOnly` cookie and is never returned to browser JavaScript or stored in Web Storage.
- Login restores the session from the cookie. Set `ALLOWED_ORIGIN` to the exact frontend origin for a separately hosted UI.
- New registrations receive the `viewer` role. Administrators assign roles from **User Access**.
- `/forgot-password` is a UI placeholder until a password reset service is added.

## Roles, Assets, and AAS

In local development, set `ENABLE_DEMO_ACCOUNTS=true` and `ENABLE_DEMO_DATA=true`. The API creates four demo login buttons on the login page. The shared demo password is returned by the API with those shortcuts when demo accounts are enabled.

| Role | Access |
|---|---|
| Viewer | Dashboard, device and asset summaries, alerts, analytics, and telemetry history |
| Operator | Viewer access plus alert acknowledgement, operational reading actions, and commissioned WROVER indicator LED control |
| Engineer | Operator access plus asset registration, AAS records, lifecycle updates, thresholds, and firmware inventory/history review. OTA delivery is disabled until a verified updater is integrated. |
| Admin | Engineer access plus user role management and destructive device administration |

The demo logins are `admin@dev.local`, `operator@dev.local`, `tech@dev.local`, and `demo@dev.local` for admin, operator, engineer, and viewer respectively. The API does not seed or accept these reserved identities when `ENABLE_DEMO_ACCOUNTS` is disabled. Docker Compose reads the flag from `.env.local` (default `true` for local development), so set it to `false` to hide the shortcuts and reject those accounts without changing the application image. Setting it to `true` in production deliberately exposes the fixed shared password and administrator access; do this only for an isolated public demonstration tenant without sensitive data or connected equipment. Nginx fronts the dashboard containers; scale the stateless API with `docker compose --env-file .env.local up -d --scale dashboard=2`. PostgreSQL-backed sessions, login limits, AAS revisions, and notifications are shared. WebSocket messages use Redis Pub/Sub across dashboard replicas. Use persisted asset metadata for production grouping; the former process-local device-group API has been removed.

Login brute-force counters are hashed and stored in PostgreSQL, so the configured per-IP and per-email windows are shared across replicas. Production deployments should also set ingress/WAF request limits. `TRUST_PROXY` defaults to off; set it to the actual trusted proxy IP/CIDR ranges when deploying behind a reverse proxy.

The **Assets** page has one **Create Asset** entry point with Quick Create (Form) and Import Package (.aasx). Quick Create asks DeviceService to generate and register the IDTA model. AASX import validates the package, registers its models, and retains the original package and attachments in the AASX File Server. Open an asset's AAS to review the shell, submodels, concept descriptions, semantic identifiers, package file references, lifecycle history, version snapshots, and gateway connection. Imported AAS elements are rendered from the stored package model; missing manufacturer fields are not invented. Form edits use revision checks and preserve prior snapshots; imported vendor shells cannot be silently overwritten. Engineers can export the JSON Environment, export a CAEX 3.0 hierarchy as AutomationML, publish a validated gateway profile over MQTT, or download the profile for controlled offline deployment. The AML export contains hierarchy and basic asset metadata; it does not emit machine protocol mappings or claim Formal Description OWL/SHACL validation. Protocol credentials belong on the edge gateway and are never included in AASX mapping headers or edge profiles.

The AAS page exposes bounded ADA031 V4 joint jogs, the calibrated A → B → A repeat, a demonstration profile, operational stop, and the 90° neutral move for engineers and admins when the asset uses the `ada031_v4_serial` profile. DeviceService enforces the role from a short-lived signed token and sends expiring, non-retained MQTT commands; the Pi requires an exact `ADA031_CONTROL_ASSET_IDS` allowlist entry, rate-limits requests, and maps only known actions to the connected firmware's 9600-baud ASCII bytes. WROVER GPIO pulses remain a separate commissioned path. Arbitrary speed or angle setpoints and general industrial machine commands are not implemented. The connected firmware clamps axes 1–4 to 0–180° and the gripper to 35–90°, and reports controller state and commanded targets, but it has no actual-position feedback; opening USB serial can reset it and move all five servos to 90°. The UI does not claim physical movement confirmation. A software command is never an emergency stop; machine safety functions require independent hardware and site-specific validation. See the [ADA031 V4 guide](https://github.com/DruHustle/smart-factory-iot-edge/blob/master/docs/ada031-integration.md).

The API seeds a database-backed compressor, transformer, and Windformer wind turbine generator scenario when `ENABLE_DEMO_DATA=true` and the database has no real assets. Windformer identity and operating readings are synthetic; its generated shell uses the same IDTA Nameplate, Technical Data, and Maintenance Instructions submodel templates as form-created assets. Existing demo rows are kept when the Windformer scenario is added during an upgrade. Demo records are marked simulated and their lifecycle is read-only. Set `ENABLE_DEMO_DATA=false` to disable that scenario. Demo accounts are controlled separately by `ENABLE_DEMO_ACCOUNTS=true`.

The uploaded IDTA-01005 AASX ZIP contains a package-format example (`examples/IDTA-01005_Example.aasx`) with generic example shells, submodels, and embedded PDFs; it is not a Windformer manufacturer twin. Importing it preserves the package's own shell and element content. Windformer demo measurements are separate API-seeded synthetic telemetry.

The **Dashboard** is the fleet summary for AAS asset count, gateway health, maintenance stage, open incidents, and current confirmed downtime, including the longest active incident and average downtime-to-resolution. **Live Monitoring** shows connectivity and latest readings for gateways and edge devices. **Devices** registers gateway or edge-device identities under **Device Connectivity**; industrial equipment belongs under **Assets** and is identified by its AAS. **Alerts** shows platform error codes, technician assignment to engineer-role users, confirmed downtime, resolution time, and searchable/exportable event history. Operators acknowledge; assigned engineers or admins resolve. Threshold alerts are deduplicated per device/asset/metric and escalate in place. **Notifications** retains incident and assignment updates per account, including configured-provider email delivery status. **Analytics** queries stored telemetry attributed to assets and can compare an individual asset or group by type, zone, location, manufacturer, or lifecycle stage. It reports observed metrics and screening trends; predictive maintenance, RUL, OEE, energy/emissions, RCA, TCO, and MTBF remain unavailable until their required validated data is collected. These views use API data; demo measurements are seeded in PostgreSQL and marked simulated.

Firmware inventory and historical deployment records are review-only. The current ESP-WROVER firmware has no network update agent, Raspberry Pi updates use a staged manual deployment, and the ADA031 V4 controller is programmed over USB. The dashboard therefore disables OTA submission and rollback; old database rollout rows are not evidence that a device received or installed firmware. Edge configuration publication is a separate operation: it sends desired telemetry/control mappings to a gateway and requires an application acknowledgement, and it does not replace firmware. See [API flows](docs/api-flows.md#edge-configuration-control-and-firmware) for per-device capabilities and limitations.

The **Assistant** answers operational how-to and what-is questions from approved project guides and a bounded snapshot of records available through the signed-in user's API access: assets, gateway/device status, latest telemetry, and incidents. Gemini is the primary OpenAI-compatible provider and Groq is the fallback. Provider keys are optional and server-only; without them, the Assistant still provides a local documentation and current-data response. Recent turns, matching guide excerpts, and the limited snapshot are sent to a configured external provider. The Assistant is read-only and cannot control equipment. Review the [Assistant configuration and data boundaries](docs/assistant.md) before enabling external providers.

The standardized API is reached at `/api/aas/*`. Configure private AAS Repository, Submodel Repository, Concept Description Repository, AAS Registry, Submodel Registry, and AASX File Server URLs plus OAuth client credentials. Set either `AAS_OIDC_DISCOVERY_URL` or a direct `AAS_OIDC_TOKEN_URL`; optional `AAS_OIDC_SCOPE` is sent with the client-credentials grant. These are server-to-server AAS credentials, not Entra user login. See the [AAS and Entra configuration guide](docs/authorization-and-aas.md#entra-id-for-aas-service-credentials) for the tenant URLs, app permissions, credential locations, and SSO boundary. The optional local `aas` Compose profile starts the official BaSyx Go 1.1.0 service stack on IDTA API 3.2 endpoints, using loopback-only ports and local development auth settings. Set `AAS_PROVISIONING_API_URL` to the private .NET DeviceService `/api/assets` route and `AAS_PROVISIONING_TOKEN` to a separate 32-byte service secret. DeviceService provisions form assets, imports AASX packages through `/api/assets/import`, and publishes edge profiles through `/api/assets/sync`. AASX parsing uses the official generated AAS Core 3.1 C# SDK; the parser preserves original model data and adapts the v3.2 administrative timestamps for v3.1 SDK validation, but does not certify arbitrary v3.2 metamodel payloads. See the [AAS deployment and permissions guide](docs/authorization-and-aas.md).

This platform provides asset lifecycle, telemetry, and gateway configuration functions. It is not a safety-rated control system and must not implement emergency stops, guards, interlocks, or other protective functions. Keep machine safety functions independent and complete a site-specific risk assessment and validation before connecting production equipment.

Supported gateway profile types are MQTT, OPC UA, Modbus TCP, Modbus RTU, serial JSON, and the ADA031 V4 USB serial jog driver. The application stores protocol endpoints and telemetry mappings with the AAS connection; the Pi validates and atomically applies its complete desired profile. ESP32 WROVER telemetry reaches the Pi-local Mosquitto broker and is forwarded upstream by the gateway. General native MQTT devices can publish directly to the cloud broker when provisioned with device-scoped TLS credentials and topic ACLs; the .NET telemetry service accepts records with or without a `gatewayId`. Choose the gateway path for many low-power sensors, mixed protocols, unstable WAN links, local control, or tighter OT boundary enforcement. Choose direct MQTT for a small set of mobile or distant devices with native Wi-Fi/cellular, MQTT/TLS, and managed credentials. The ADA031 V4 uses USB serial and must use the Pi gateway. Broker publication does not prove a desired profile was applied; monitor the gateway `/ack` topic. Protocol credentials, register addresses, units, and scaling must match the equipment documentation.

See [Authorization and AAS guide](docs/authorization-and-aas.md) for API permissions, environment variables, telemetry flow, and limitations.

## Verification Commands

```bash
pnpm check
pnpm test
# Requires Docker; uses disposable PostgreSQL and Redis containers, then runs API + browser tests.
pnpm e2e
pnpm docs:check
# Real cross-repository path; requires sibling repos, live local BaSyx, and edge Python dependencies.
pnpm e2e:system
```

To start the live BaSyx API 3.2 services locally, copy `.env.local.example` to `.env.local`, replace the local credentials, then run `docker compose --env-file .env.local --profile aas up -d --wait`. The Compose profile includes separate repositories, registries, Concept Description Repository, and AASX File Server services; it is for development/integration use and disables upstream authentication only on the private Compose networks. See the AAS deployment guide for secure production settings.

Database/Redis integration tests require explicit TEST_DATABASE_URL/TEST_REDIS_URL; external Assistant providers are disabled in tests. Database-backed integration tests are skipped by `pnpm test` unless `TEST_DATABASE_URL` points at a dedicated test database. The suite never uses `DATABASE_URL` from `.env.local` implicitly. `pnpm e2e` creates an isolated temporary database and tears it down on exit.

## Deployment

Production uses **Vercel for the React UI and one immutable image deployed as two Render services**. The scalable `web` service runs Node API, DeviceService, IdentityService, and AnalyticsService. The singleton `worker` service runs TelemetryService and NotificationService so only one stable MQTT consumer processes physical-device traffic. Aiven PostgreSQL, Redis Cloud, CloudAMQP, and company AAS services remain external. Physical edge gateways stay in the factory.

The protected `main` branch starts one coordinated GitHub Actions release: it validates all three repositories, publishes one immutable backend image to GHCR, deploys that digest to the singleton worker and then the scalable web service, waits for web readiness, and finally deploys the prebuilt static frontend artifact to Vercel. Vercel does not run a frontend Docker image. Independent Render/Vercel auto-deploy paths must remain disabled so production ordering and rollback evidence stay unambiguous.

Use [Vercel/Render and local deployment](RENDER_DEPLOYMENT.md) for required GitHub secrets/variables, provider setup, migrations, push-triggered CI/CD, restart behavior, acceptance and rollback. Kubernetes is not required; its retained manifests are legacy references outside the supported release.

## UI Smoke Test Checklist

1. Open `http://localhost:3000/#/login`.
2. Click `Forgot password?`, verify it opens the reset screen, then click back to login.
3. Register a new user and confirm redirect to dashboard.
4. Logout from sidebar menu and confirm redirect to login.
5. Login again and verify dashboard loads.
6. In local development, use each demo account button and verify viewer, operator, engineer, and admin permissions.
7. Register a compressor or transformer, attach a gateway and tag mappings, then inspect and export its AAS.
8. Check the demo compressor, transformer, and Windformer are labeled simulated and cannot be edited. Asset Analytics includes alert counts, per-asset power/temperature/vibration/pressure/speed readings, asset-specific signals, and early-versus-recent condition changes when there are enough samples. It clearly marks predictive maintenance, RUL, OEE, capacity, kWh, energy intensity, emissions, RCA, TCO, and MTBF as unavailable until their required source data is connected; the displayed telemetry trends are screening indicators, not predictions.

## Deployment Database Policy

- Development uses local PostgreSQL.
- Production dashboard/backend PostgreSQL uses Aiven with provider CA and full certificate/hostname verification. Redis Cloud is accessed with `rediss://`. CloudAMQP uses MQTT TLS/AMQPS. The ESP32 WROVER connects only to the Pi-local MQTT/TLS broker; eligible native MQTT devices may use their own scoped CloudAMQP connection.

## Project Structure

```text
smart-factory-iot-frontend/
├── client/                 # React frontend
├── server/                 # Express backend + tRPC routers
├── drizzle/                # Drizzle schema and migrations
├── shared/                 # Shared constants/types
└── docs/                   # Technical docs
```


## Review evidence

See the [production readiness review](docs/production-readiness-review.md) for verified paths, remaining blockers, and acceptance requirements.

## Local equipment 3D and optional interoperability

[Independent equipment monitoring](docs/equipment-view.md) uses this application's own pinned Three.js renderer, models, auth, persistence, simulator and files. It requires no Onesa application, package or account. [Optional producer integration](docs/onesa/OPERATIONS.md) is disabled by default; its proposed-contract verification is distinct from acceptance by an actual Onesa consumer. Run `pnpm e2e:equipment` for the standalone native-view qualification.

Native equipment validation and remaining premium asset gaps: [implementation evidence](docs/equipment-evidence.md).

## OT cybersecurity workspace

The independently owned [cybersecurity workspace](docs/cybersecurity.md) provides source-scoped evidence, deterministic findings and assigned investigations. See its [strict API/import profile](docs/cybersecurity-api.md) and run `pnpm e2e:security` for the disposable standalone workflow. The detailed native equipment view remains available independently.
