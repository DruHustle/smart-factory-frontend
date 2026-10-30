# Authorization, Assets, and AAS

This guide describes the dashboard's account roles, industrial asset records, AAS JSON models, API gateway, and deployment requirements. The application API and database live in `smart-factory-frontend`; the optional standardized AAS runtime is a separate service.

## Roles and permissions

Role checks are enforced by the Node API on every protected request. UI visibility is only a convenience. The API reloads the current database user, so an administrator's role change applies on the next request. Existing `user` roles retain viewer access.

| Role | Dashboard | Operations | Engineering | Administration |
|---|---|---|---|---|
| Viewer | Read dashboard, devices, asset summaries, readings, alerts, and reports | — | — | — |
| Operator | Viewer access | Acknowledge alerts, create operational readings, and pulse the commissioned WROVER indicator LED | — | — |
| Engineer | Operator access | — | Assign incidents to engineer/technician accounts, record downtime, resolve assigned incidents, register devices and assets, inspect AAS and connection data, change lifecycle, configure thresholds, and review firmware records. OTA delivery remains disabled until a verified updater is integrated. | — |
| Admin | Engineer access | — | — | Create accounts, provision roles, manage notifications, delete devices |

New registrations receive `viewer`. Only administrators can assign roles. An administrator cannot remove their own admin role. AAS details and machine connection profiles require engineer access; user and notification administration require admin access.

## Demo logins

Set `ENABLE_DEMO_ACCOUNTS=true` to seed and return these login shortcuts to the login page. In production this exposes fixed credentials, including administrator access, so use it only for an isolated demonstration tenant without sensitive data or connected equipment:

| Login button | Email | Role |
|---|---|---|
| Demo Viewer | `demo@dev.local` | viewer |
| Demo Operator | `operator@dev.local` | operator |
| Demo Engineer | `tech@dev.local` | engineer |
| Demo Admin | `admin@dev.local` | admin |

The shared demo credential is served by the API only when the demo-account flag is enabled. Setting the flag to false also rejects these reserved identities at login, including rows left behind in a database. Production defaults the flag off but can explicitly enable it for an isolated demonstration tenant without sensitive data or connected equipment. Use individual accounts with strong unique passwords for a normal deployed system.

`ENABLE_DEMO_DATA=true` separately seeds three simulated gateways, a compressor, transformer, and Windformer wind turbine generator, telemetry, alerts, and lifecycle history when no live asset exists. Data is stored in PostgreSQL and marked simulated; the browser has no hardcoded asset fallback. Demo asset lifecycle actions are read-only.

## Session and API security

The browser receives a signed eight-hour session only in an `HttpOnly` cookie. It does not receive or persist the JWT in local or session storage. Cookies use `SameSite=Lax` on HTTP development requests and always `SameSite=None; Secure` in production (or on trusted HTTPS requests) so separately hosted frontends can call the API. Unsafe `/api` requests with an `Origin` header must match the request origin or an exact origin in `ALLOWED_ORIGIN` (comma-separated for multiple frontends).

Set `JWT_SECRET` to a randomly generated value of at least 32 bytes in production. Set `ALLOWED_ORIGIN` to the exact frontend origin(s). `INGESTION_API_TOKEN` is a separate service-only credential for the .NET telemetry bridge; it is never an application-user credential. Keep database, OAuth client, MQTT, and equipment credentials in a secret manager or protected runtime variables.

Login attempt counters are stored as hashes in PostgreSQL, so the 15-minute per-IP (100 attempts) and per-email (20 attempts) limits are shared between dashboard replicas. Expired rows are periodically removed. Put an additional request limit at the ingress or WAF. `TRUST_PROXY` defaults to disabled; set it to the actual trusted proxy IP/CIDR ranges (or a fixed hop count for a fixed topology) so untrusted clients cannot forge forwarded IP headers.

## Standard AAS Repository API

`/api/aas/*` is an authenticated gateway to a private AAS Environment service. It forwards standard AAS API operations after checking that the current application user has engineer or admin access. The gateway obtains an OAuth 2.0 client-credentials token on the server; the browser never receives that service credential. Writes to AAS records managed by this dashboard are rejected at the gateway and must use the versioned asset workflow below. Other permitted repository operations continue through the proxy.

Configure these server-only variables. The gateway uses the AAS Repository as its base and routes submodels, Concept Descriptions, registries, and AASX packages to their dedicated services when those URLs are set.

| Variable | Purpose |
|---|---|
| `AAS_REPOSITORY_URL` | Private base URL of the AAS Environment service, with no user information, query, or fragment |
| `AAS_REPO_URL` | Backward-compatible alias for `AAS_REPOSITORY_URL` |
| `AAS_SUBMODEL_REPOSITORY_URL` | Private Submodel Repository API base |
| `AAS_CONCEPT_DESCRIPTION_REPOSITORY_URL` | Private Concept Description Repository API base |
| `AAS_REGISTRY_URL` | Private AAS Registry API base |
| `AAS_SUBMODEL_REGISTRY_URL` | Private Submodel Registry API base |
| `AASX_FILE_SERVER_URL` | Private AASX File Server API base |
| `AAS_OIDC_DISCOVERY_URL` | Optional OpenID Connect discovery document URL used to resolve `token_endpoint` |
| `AAS_OIDC_TOKEN_URL` | Optional direct OAuth 2.0 token endpoint; takes precedence over discovery |
| `AAS_OIDC_SCOPE` | Optional scope string for the client-credentials token request |
| `AAS_OIDC_CLIENT_ID` | Confidential client id |
| `AAS_OIDC_CLIENT_SECRET` | Confidential client secret |

### Entra ID for AAS service credentials

The current `AAS_OIDC_*` integration uses OAuth 2.0 **client credentials** so the dashboard API and .NET DeviceService can call a protected AAS repository. It does not authenticate people to the dashboard; application users still sign in through the local account flow described above.

1. In the Microsoft Entra admin center, register a **resource/API application** for the AAS platform (or use the API registration supplied by its operator). Configure an application permission/app role for the required AAS read or write access. The AAS server owner must configure that API to trust the client.
2. Register a confidential **client application** for the dashboard service and another for DeviceService where separate identities are supported. Grant only the required application permissions to the AAS API and have an administrator grant tenant consent. For the v2 token endpoint, request the resource's `/.default` scope, for example `api://<AAS-resource-application-id>/.default`, using the exact Application ID URI configured by the AAS owner.
3. In **App registrations → client app → Certificates & secrets**, create a client credential. Copy its **secret Value** when it is created; Entra will not show that value again. This code currently consumes a client secret, so use a short-lived secret, rotate it, and keep it in a secret manager. Entra also supports certificate and federated credentials, but this AAS token client does not yet implement those methods.
4. Obtain the Directory (tenant) ID and Application (client) ID from the app registration overview. Use the tenant-scoped discovery URL `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`; the API reads its `token_endpoint`. Alternatively use `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` directly.
5. Put the dashboard client values in the root API environment, and the DeviceService values in the backend service environment. Use the same tenant, discovery/token URL, and AAS resource scope; use different client IDs and secrets if the AAS operator can grant separate identities. Restart/redeploy both services after updating secrets.

```dotenv
AAS_OIDC_DISCOVERY_URL=https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration
AAS_OIDC_TOKEN_URL=
AAS_OIDC_SCOPE=api://<aas-resource-application-id>/.default
AAS_OIDC_CLIENT_ID=<dashboard-client-application-id>
AAS_OIDC_CLIENT_SECRET=<dashboard-client-secret-value>
```

Repeat those variables in DeviceService's protected environment using its own client identity. Never put secrets in `VITE_*`, browser code, firmware, a committed `.env.local`, or a public demonstrator. For dashboard **user SSO** with Entra, add a separate OIDC authorization-code flow, callback/session mapping, and Entra-group-to-application-role policy; these service credentials do not provide that feature. Microsoft documents the [tenant-scoped OIDC discovery endpoint](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [client credentials and `/.default` permissions](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow), and [app credential management](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).

## Incident response and downtime

Alerts have a `SF-*` platform error code unless an upstream source supplies a code. These Smart Factory classifications help operators find and route a fault; they are not manufacturer diagnostic codes. Threshold breaches use configured warning and critical limits, are deduplicated while active/acknowledged, and escalate in place when severity increases. Configure limits on the device or gateway detail page.

Operators acknowledge incoming alerts. Engineers assign an alert to an engineer account acting as technician. The assigned technician records downtime when the machine is confirmed unavailable, then resolves the alert after the fault is corrected. A `device_offline` event starts its clock at detection. Admins can reassign or resolve as an override. Resolution is restricted to the assigned engineer or an admin. The UI shows current downtime and the historical mean from downtime start to resolution; it includes only incidents with both timestamps. Alerts without a downtime start do not count toward that mean.

### Public demonstrators and company endpoints

The [IDTA technology page](https://industrialdigitaltwin.org/en/technology?tech=trainings-schulungen) currently lists these shared demonstrators and Swagger pages:

| Purpose | AAS server | Swagger UI | Authentication |
|---|---|---|---|
| Default REST exploration | `https://v3.admin-shell-io.com` | `https://v3.admin-shell-io.com/swagger/index.html` | None; no registry |
| Registry discovery exploration | `https://v3-2.admin-shell-io.com` | `https://v3-2.admin-shell-io.com/swagger/index.html` | None; includes a registry |
| OIDC security exploration | `https://v3security.admin-shell-io.com` | `https://v3security.admin-shell-io.com/swagger/index.html` | OIDC; discovery document: `https://admin-shell-io.com/50001/.well-known/openid-configuration` |

These are public learning and test systems, not production repositories. They may contain shared sample data, change without notice, or be unavailable. The [upstream AASX Server project](https://github.com/eclipse-aaspe/server) also identifies older `v3` demo hosts as outdated, so check the live Swagger document and advertised API profiles before testing. Do not upload proprietary packages, credentials, production records, or safety-related information. The discovery document supplies endpoint metadata; it does not grant a client id or secret. Obtain valid test client credentials from the demonstrator owner before exercising authenticated flows.

For a company deployment, replace the AAS Repository, Submodel Repository, Concept Description Repository, both registries, and AASX File Server URLs with the endpoints provisioned by that company. Configure its OIDC discovery URL or direct token endpoint, API scope if required, and service client credentials. The dashboard gateway and .NET DeviceService already read these values from environment configuration, so moving to an authorized company environment does not require a code change. Keep client secrets in owner-only Oracle runtime configuration or an approved secret manager, use HTTPS, and enable repository-side authentication and authorization for the service identity.

Use a runtime that advertises the required IDTA AAS API **3.2** profiles, such as Eclipse BaSyx Go. Its `/description` response advertises supported profiles; the API uses `application/json` and normal IDTA API status/error responses. The local Compose profile below is for development/integration only: its ports bind to loopback, it disables ABAC, and it permits unauthenticated calls only from local service containers. For a deployed system configure OAuth/OIDC trust, enable the runtime's authorization policy, use TLS, and keep service ports private. The gateway's application role check is the user-facing policy boundary; upstream credentials remain server secrets.

Start the live local BaSyx stack from this repository with `docker compose --env-file .env.local --profile aas up -d --wait` after copying `.env.local.example` and replacing its local passwords. It includes separate AAS and Submodel Repositories, AAS and Submodel Registries, a Concept Description Repository, and an AASX File Server. The repository services use the shared PostgreSQL-backed BaSyx configuration and automatically register shell/submodel descriptors with their respective registries. Configure the Node and DeviceService URLs to the in-network service names (`aas-repository:8081`, `submodel-repository:8083`, `concept-description-repository:8085`, `aas-registry:8082`, `submodel-registry:8084`, `aasx-file-server:8086`). Host ports are bound to `127.0.0.1` for local testing only. Set `AAS_REPOSITORY_REGISTRY_INTEGRATION=true` in DeviceService when the repositories own registration, so the provisioner does not submit duplicate descriptors.

BaSyx Go 1.1.0 currently returns AASX package downloads with `Content-Type: application/aasx+json`, although its own OpenAPI declares the binary `application/asset-administration-shell-package` response. The Node gateway normalizes successful `GET /api/aas/packages/{packageId}` responses to the declared media type and streams the package bytes unchanged. The direct BaSyx URL remains private; consumers should use the authenticated gateway.

With those variables absent, tRPC asset workflows and JSON export continue to use the application database, while `/api/aas/*` returns `503 AAS Repository service is not configured`. This is intentional: the Node app does not pretend its tRPC asset routes are the standardized repository API. See [production deployment](../deploy/oracle/README.md) and [API flow](api-flows.md).

## Submodel templates

New asset records require manufacturer, product designation, manufacturer article number, and manufacturer order code so the mandatory fields are present in the generated instances.

| Submodel | IDTA template | Implementation |
|---|---|---|
| `Nameplate` | Digital Nameplate for Industrial Equipment, IDTA 02006 version 3.0.1 | Includes URI, multilingual manufacturer and product designation, required order code, article number, and serial number where supplied |
| `TechnicalData` | Generic Frame for Technical Data, IDTA 02003 version 2.0.1 | Uses the mandatory general-information collection and the standard extensible technical-property-area structure |
| `MaintenanceInstructions` | IDTA 02018 version 1.0 | Emits the required `MaintenanceFreeAsset` property; lifecycle events remain in the application audit table |

Submodel semantic IDs and template IDs are kept in `server/aasModel.ts`. Application lifecycle history is not represented as an invented IDTA submodel. Add documentation files through an IDTA Handover Documentation model when document upload/storage is implemented; the current shell does not emit a placeholder that falsely claims that template.

The full AAS Repository API is a runtime capability, not a claim made by the JSON builder. The gateway targets IDTA-01002 API 3.2.0, published in July 2026. Validate the deployed service against the official OpenAPI profile and the IDTA test tools before publishing an integration endpoint. The official test engine may target an earlier API/metamodel version, so record the engine version and its profile in deployment evidence.

## Asset and machine workflow

1. Open **Create Asset** and choose Quick Create (Form) or Import Package (.aasx).
2. Quick Create sends required manufacturer identity fields to `POST /api/assets`. Import sends one package as multipart field `file` to `POST /api/assets/import`; the API limit is 50 MB, and a package can contain up to 25 shells.
3. DeviceService reads AASX containers with the official AAS Core package library and validates supported core models through the official generated [AAS Core 3.1 C# SDK](https://github.com/eclipse-aascw/aas-core3.1-csharp). JSON is retained in its original model form. For the two AAS 3.2 administrative timestamps unknown to that v3.1 SDK, validation uses a temporary view with those fields removed while the imported model keeps them. XML namespace/date handling is adapted for the same compatibility boundary. The original package and attachments are stored through the private AASX File Server. The parser does not claim full v3.2 or arbitrary vendor-extension conformance.
4. Optionally assign a live gateway profile during import or form registration using MQTT, OPC UA, Modbus TCP/RTU, or serial mappings supported by that gateway.
5. Keep machine protocol secrets on the gateway. Never place passwords, tokens, or private keys in endpoint URLs, tag maps, AAS properties, or exported configuration.
6. Review the AAS, lifecycle history, and gateway profile. Record valid lifecycle transitions with a work-order or engineering note. Publish the profile or download it for controlled offline installation.
7. Export an AAS JSON Environment for exchange, or use `/api/aas/*` for standard repository operations after configuring the private AAS runtime.

### AAS revision integrity

Form-managed assets have a monotonic application revision. An edit submits the revision it loaded and a change note; the API serializes changes on the PostgreSQL asset row, rejects stale revisions with HTTP 409, and appends an immutable snapshot with a deterministic SHA-256 digest. The AAS shell and generated submodels carry the same application revision in their administration metadata. Restoring an older form-managed snapshot creates a new revision and preserves the current state in history. Direct proxy writes to these managed records are blocked to prevent bypassing this ledger.

AASX imports preserve their vendor model and are immutable in the form editor. Importing a package that reuses an existing shell identifier fails the database uniqueness check instead of replacing that asset. Re-import changed vendor data under a new shell identifier after reviewing the package. Existing installations receive one migration baseline snapshot; the system cannot reconstruct edits made before version history existed, so that baseline has no SHA-256 digest.

The PostgreSQL revision transaction is the concurrency boundary for dashboard-managed edits across replicas. The private repository itself does not provide a cross-service transaction with PostgreSQL. The .NET provisioner reads the current repository revision, applies the shell/submodel/registry updates, and attempts compensating PUTs if a later repository operation fails. A repository outage or failed compensation must be reviewed before an operator retries the change.

The AASX importer uses the official generated AAS Core 3.1 C# SDK because that is the available official C# SDK reference. It preserves the submitted package and model payload, adapts the 3.2 administrative timestamps at the validation boundary, and does not assert full AAS 3.2 metamodel or every vendor template conformance. A vendor corpus can be supplied through `AASX_TEST_CORPUS_DIR` for repeatable parsing checks; vendor packages are intentionally not redistributed in this repository. Verify imported models against the target server's advertised profile and applicable IDTA template validation before production ingestion.

### Required .NET service configuration

Set `AAS_PROVISIONING_API_URL` in the Node service to the private DeviceService root route ending in `/api/assets`. Set the shared `AAS_PROVISIONING_TOKEN` only in the Node and DeviceService runtimes. Configure `AASX_FILE_SERVER_URL` in DeviceService to the private IDTA AASX File Server base. DeviceService also needs AAS repository/registry URLs, OAuth client credentials, and MQTT broker configuration. Do not publish these internal endpoints or secrets to the browser.

| DeviceService variable | Purpose |
|---|---|
| `AAS_REPOSITORY_URL` | Private AAS Repository API base for shell and submodel registration |
| `AAS_SUBMODEL_REPOSITORY_URL` | Private Submodel Repository API base |
| `AAS_CONCEPT_DESCRIPTION_REPOSITORY_URL` | Private Concept Description Repository API base |
| `AAS_REGISTRY_URL` | Private AAS Registry API base for shell descriptors |
| `AAS_SUBMODEL_REGISTRY_URL` | Private Submodel Registry API base |
| `AAS_REPOSITORY_REGISTRY_INTEGRATION` | Set `true` when repositories automatically register descriptors |
| `AAS_ALLOW_UNAUTHENTICATED_LOCAL` | Development-only opt-in, restricted in code to HTTP and approved local service names |
| `AAS_OIDC_DISCOVERY_URL` or `AAS_OIDC_TOKEN_URL` | OIDC discovery document or direct token endpoint for OAuth client credentials |
| `AAS_OIDC_SCOPE` | Optional provider/API scope sent during the client-credentials grant |
| `AAS_OIDC_CLIENT_ID`, `AAS_OIDC_CLIENT_SECRET` | Service-to-service OAuth client credentials for repository and registry calls |
| `AASX_FILE_SERVER_URL` | Private IDTA AASX File Server base for package/attachment storage |
| `AAS_PROVISIONING_TOKEN` | Shared service-only token accepted by the Node-to-.NET provisioning routes |
| `REDIS_URL` | Shared Redis Pub/Sub endpoint used for cross-replica AAS change notifications; required in production |
| `DATABASE_SSL_MODE` / `DATABASE_CA_CERT` | Production Aiven PostgreSQL requires `verify-full` and the provider project CA |
| `MqttBrokerHost`, `MqttBrokerPort`, `MqttUsername`, `MqttPassword`, `MqttUseTls` | CloudAMQP MQTT over TLS for telemetry and gateway desired state; keep backend and Pi identities separate and apply topic ACLs |

Production uses Aiven PostgreSQL with certificate and hostname verification (`DATABASE_SSL_MODE=verify-full` plus `DATABASE_CA_CERT`), Redis Cloud with authenticated `rediss://`, and CloudAMQP MQTT TLS/AMQPS. WROVER and other sensors behind the Pi use the Pi-local TLS broker and receive no CloudAMQP credentials. Eligible native MQTT devices may connect directly with their own scoped identity and topic ACL. The Pi forwards gateway-routed sensor messages, while backend services have separate broker identities for consuming telemetry and publishing gateway desired state. See the edge repository guide for local broker ACLs and firmware setup.

The Pi command handler accepts only the fixed `replace_asset_configuration` action, checks `schemaVersion` and gateway identity, applies a 64 KB profile limit, writes the profile atomically with owner-only permissions, and reloads its running polling loop. DeviceService publishes retained QoS 1 desired state; broker acceptance alone does not prove the Pi applied it. Observe the gateway's `/ack` topic. Configure per-device publish/subscribe ACLs and TLS before deployment.

The application lifecycle graph is `planned → engineered → commissioned → operational ↔ maintenance → decommissioned`; decommissioned is terminal. The server validates every transition and records the actor and note.

## AutomationML and machine mappings

The dashboard can export an asset hierarchy as CAEX 3.0 through `GET /api/assets/export/automationml` for engineer/admin users. It emits stable asset/group IDs and basic asset metadata. It does not import CAEX, export gateway `DataVariable` mappings, or validate the Formal Description OWL/SHACL rules; see [AutomationML interoperability notes](automationml-integration.md).

## Telemetry profile

The gateway and .NET backend normalize readings to a device id, optional asset id, Unix timestamp in milliseconds, and nullable temperature, humidity, vibration, power, pressure, and RPM fields. MQTT topics follow `factory/{site}/{line}/{deviceId}/telemetry`; the Pi gateway forwards allowlisted WROVER topics without giving sensors cloud access. The Node ingestion bridge validates the payload and compares `INGESTION_API_TOKEN` in constant time.

## Verification

```bash
pnpm check
pnpm test
pnpm e2e
```

The E2E script starts disposable PostgreSQL and Redis, applies migrations, runs the unit/database suite (including cross-replica Redis fan-out), and exercises the UI through Chromium against a local upstream stub. The BaSyx Compose profile supplies live API 3.2 repository and registry endpoints for deployment-level smoke/conformance checks. API `/description` profiles and CRUD behavior must be checked against the deployed runtime; passing dashboard tests alone is not certification.

## Normative references

- [IDTA-01002 AAS API specifications, version 3.2.0](https://industrialdigitaltwin.io/aas-specifications/IDTA-01002/v3.2/index.html) — normative profiles, schemas, and operations for AAS and submodel services, repositories, registries, discovery, and related services.
- [IDTA-01001 Part 1 Metamodel, version 3.2](https://industrialdigitaltwin.io/aas-specifications/IDTA-01001/v3.2/index.html) — metamodel aligned with API 3.2.
- [IDTA-01004 Part 4 Security, version 3.1](https://industrialdigitaltwin.io/aas-specifications/IDTA-01004/v3.1/index.html) — AAS access-control and security requirements.
- [IDTA Submodel Templates source repository](https://github.com/admin-shell-io/submodel-templates) — authoritative published template artifacts and semantic identifiers.
- [IDTA AAS test engines](https://github.com/admin-shell-io/aas-test-engines) — record the exact test-engine release and supported profile because its coverage may not match API 3.2 and the template versions listed above.
- [AutomationML standards and specifications](https://www.automationml.org/about-automationml/specifications/) and the [Formal Description recommendation](https://www.automationml.org/wp-content/uploads/2025/09/AR-Formal-Description-for-AutomationML.pdf).

The deployed repository must advertise and pass the exact IDTA-01002 API profile version configured for this gateway. A successful proxy test proves routing, OAuth handling, and role enforcement; it does not certify upstream OpenAPI, metamodel, template, or security conformance. Capture upstream conformance evidence during deployment acceptance.
