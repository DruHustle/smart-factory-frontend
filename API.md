# API Overview

The browser calls the Node/Express API, primarily through tRPC at /api/trpc. Protected procedures reload the current PostgreSQL user and enforce role access.

| Path | Access | Purpose |
|---|---|---|
| auth.login, auth.register | Public | Create a dashboard session or account |
| assistant.ask | Signed-in viewer or higher | Answer how-to and current-state questions from approved guides plus a bounded snapshot visible through the caller's API access; optionally uses server-configured Gemini with Groq fallback |
| devices.* | Procedure-specific roles | Register Raspberry Pi gateways and review connectivity; industrial machines are AAS assets |
| analytics.getAssetTelemetry | Viewer or higher | Query persisted measurements by asset ID for individual or grouped asset analytics |
| assets.* | Procedure-specific roles | Asset summaries, engineering records, lifecycle, and gateway mappings |
| alerts.list, alerts.getStats | Viewer or higher | Read coded incidents, technician assignment, downtime, and resolution metrics |
| alerts.updateStatus | Operator or higher | Acknowledge an active incident |
| devices.pulseIndicator | Operator or higher | Publish a bounded, short-lived GPIO18 pulse to a commissioned WROVER through its Pi gateway |
| alerts.assignees, alerts.assign, alerts.startDowntime, alerts.resolve | Engineer or admin | Assign engineer-role incident responders, record confirmed downtime, and resolve assigned incidents; admins can override |
| POST /api/assets/import | Engineer/admin session + private .NET service token | Multipart AASX import, limited to 50 MB; original package is retained by the AASX File Server |
| users.* | Admin | Create accounts, list users, and provision application roles |
| /api/internal/telemetry | Independent service bearer token | Validated .NET telemetry bridge |
| /api/aas/* | Engineer/admin session plus server-side OAuth | Gateway to a private IDTA AAS Environment API |

The Node AAS route proxies to a separately deployed standards-compliant service. Without that upstream, it returns 503. Dashboard tRPC asset records and JSON export do not replace the standardized repository API. New accounts are viewers; administrators assign roles. API checks enforce permissions.

Quick Create uses the role-checked `assets.create` tRPC procedure, which calls private DeviceService `POST /api/assets`. The AASX path forwards the original multipart request to DeviceService `POST /api/assets/import`, stores imported shell records in PostgreSQL, and calls `POST /api/assets/sync` when a gateway mapping is attached. Upload admission is capped at two concurrent uploads per Node process.

Enabled per-device telemetry thresholds create one active incident per device/metric and escalate that incident in place if a later value crosses the critical band. `errorCode` is a stable platform classification (`SF-*`); it is not a manufacturer diagnostic code unless a vendor code is explicitly supplied. Offline events start downtime when detected. Other incidents require an engineer to confirm when the asset became unavailable. Resolution duration is measured from `downtimeStartedAt` to `resolvedAt`; records without both timestamps are excluded from the average.

The Assistant indexes only the explicitly listed Markdown guides in `server/assistantKnowledge.ts`. It can add a minimal current snapshot of visible asset metadata, connected device status, latest telemetry, and incidents. When provider keys are configured, the current question, recent conversation, matching guide excerpts, and this snapshot are sent to the selected external AI provider. API keys stay on the server. It does not read `.env.local`, arbitrary paths, full AAS packages, or machine-control interfaces. See [Assistant configuration and data boundaries](docs/assistant.md).

See [API flows](docs/api-flows.md), [authorization and AAS](docs/authorization-and-aas.md), and [.NET API contract](https://github.com/DruHustle/smart-factory-backend/blob/main/API-SPEC.md).
