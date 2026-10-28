# Repository feature review and AI provider selection

Scope: `smart-factory-frontend`, including its React application, Express/tRPC API, shared contracts, database migrations, bundled model/artifact fixtures, operating scripts and CI. Cross-service checks use the existing immutable backend and edge qualification sources. No factory connection, credential, broker policy or production data is changed by this review.

## Corrected findings

| Finding | Correction and regression |
| --- | --- |
| Oversized searches and obsolete URL filters could make Inventory/Monitoring send inputs rejected by their APIs. Inventory accepted 200 characters while its API accepted 100. | Normalize saved/bookmarked filter values, retain valid filters, and match the existing 100-character search contract. `server/list-filters.test.ts` checks the actual API schemas; `e2e/list-filters.spec.ts` verifies successful real API responses and usable controls. |
| Non-finite, fractional or excessive page parameters could strand Inventory, Monitoring, Alerts and Notifications on rejected requests. | Shared bounded integer parsing resets invalid pages to zero. All four real browser/API paths are exercised. |
| Cold page assertions had a different deadline from the existing public-demo suite and intermittently blocked otherwise completed releases. Failed baseline captures showed the expected Inventory/Analytics page loaded. | Workspace, full experience and resource suites use the existing bounded 15-second cold-render assertion allowance. Explicit model-loading, request-budget and whole-test deadlines remain unchanged; assertions still require the actual authorized UI. |
| Routine CI ran only selected visual scenarios, leaving the complete responsive journey and observation workload budgets outside the main gate. Private integration UI and native rendering qualification also needed explicit complete-suite coverage. | The main quality workflow now runs full experience, resource-budget, private integration and native rendering jobs and retains evidence. The private integration runner uses owned disposable records with external exchange disabled. |
| The Assistant was restricted to server-configured Gemini/Groq routing and had no user provider/model controls. | Authenticated provider catalog and per-question provider/model selection; Gemini/Groq compatibility retained; OpenAI Responses, Anthropic Messages and approved compatible Chat/Responses services added. See [AI configuration and user workflow](assistant.md). |
| A selected model could be mistaken for an automatic fallback preference, and a newer client could send a choice to an API that ignored it. | Explicit model choices are pinned, unsupported choices are rejected before evidence retrieval, actual execution is labelled, and `assistant-provider-selection-v1` gates UI/API compatibility. |
| Provider response parsing did not bound the response body. | Bound response bytes, exclude reasoning-only output, cancel stalled response streams, retain the shared request deadline and redact raw provider failures. Contract regressions use recording transports, including failure and oversize cases. |
| AI setup guidance referenced a deleted Docker Compose entrypoint. | Document the actual local `pnpm dev` restart and existing Oracle API environment/release procedure. |

## Feature verification map

The PR's [quality checks](https://github.com/DruHustle/smart-factory-frontend/pull/19/checks) and retained workflow artifacts identify the tested source and per-suite outcomes. Suites run against isolated synthetic storage, with recording transports where an external provider would otherwise be required.

| Area | Verification |
| --- | --- |
| Identity, roles, sessions, password recovery and shared demo isolation | Unit/database authorization suites; main system/browser audit; workspace/public-demo journeys; ARM64 session/revocation/rollback qualification. |
| Inventory, registration, devices, gateways and saved navigation | Inventory/commissioning contracts, full workspace journeys, malformed-link regressions, role-filtered sidebar checks and responsive full experience. |
| Monitoring, analytics, units, quality, mode and historical evidence | Observation/trend/report regressions; full selected-range aggregation; active/stale/disconnected/offline/visibility request budgets; responsive browser journeys. |
| Process alerts, investigations, notifications and exports | Incident and notification database suites; assignment/note/downtime/resolution journeys; owner-scoped inbox, publication/download/revocation and recovery workflows. |
| AAS/AASX, AutomationML, attachments and edge routes | Artifact/schema validation, authorization contracts and actual disposable cross-service AAS/provisioning/serial-stub/broker traversal. |
| Native 3D and factory references | Native equipment/browser suite; Raspberry Pi walkthrough; seven-model rendering matrix at desktop/mobile in both themes; hierarchy, picking, explosion, sectioning, ghosting, saved views and BOM fallback regressions. |
| Cybersecurity | Standalone security workflows, native evidence and investigation contracts, source failure/recovery and mapped equipment focus; no compliance or physical-security claim. |
| Assistant and AI connectors | Grounded evidence/visual/source/session regressions; provider wire contracts; real API local/invalid-selection tests; desktop/mobile selector journeys using clearly synthetic adapter responses. |
| Administration and Service health | Private administrator and denied-role workflows, actual scoped resource evidence, synthetic demonstration scenarios and bounded infrastructure history/collector contracts. |
| Firmware/update catalog | Read-only catalog/history and role/input bounds. Actual updater/firmware delivery remains subject to its documented commissioning requirement. |
| Optional Onesa exchange | Producer contract/delivery/artifact tests, private disabled-exchange UI/artifact runner, shared-role denial and local cross-service fixtures. No actual external consumer acceptance is inferred. |
| Delivery, supply chain and documentation | TypeScript/production build, dependency audit, schema/contract snapshots, Markdown links/Mermaid/PDF-manifest checks, deployment policy and ARM64 image/rollback qualification. |

## AI selection behavior

Users select **AI provider** and **AI model** inside the Assistant. Choices are identity-scoped, retained during internal navigation, captured per request and locked while pending. Retrying a failed turn uses the current choice. The answer label records the actual provider/model or local knowledge.

Only operator-configured providers and models are available. Credentials and endpoints remain server-side. Explicit model failure returns local grounded guidance rather than silently transmitting to another provider. Automatic routing retains the configured installation fallback order. Shared demonstrations and globally disabled installations never make remote provider calls.

The AI connector serves model-provider APIs. MCP is a separate client interface for external tools/databases; this change does not publish Smart Factory tools to other AI applications.

## Qualification limits

Local non-database tests, type checking, build, schema/deployment contracts, Python migration checks and dependency audit complement the full database/browser/broker/image suites in CI. Missing local container/browser dependencies are environment limitations and are not counted as passing tests or hidden by product changes.

Real paid AI-provider credentials, model/account availability and response quality are not claimed from recording-transport tests. A deployment operator must enable permitted keys/models and verify them for the installation. Physical machinery, firmware flashing, real recipient email delivery, production backup/restore, actual Onesa consumer acceptance and new MCP tool/database connections are separate operating acceptance. Existing unavailable advanced metrics remain explicitly unavailable without their required engineering inputs.

This work is delivered as a reviewable PR. API changes require the existing qualified API-first rollout before the new UI is promoted.
