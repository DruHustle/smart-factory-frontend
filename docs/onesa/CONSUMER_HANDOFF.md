# Optional consumer API handoff

## Inspected consumer

Repository: DruHustle/onesa-ai-platform. Main `65d9346f297ee8869595b38634fda020bf9607f9`; dev `4e434433b415315ce00b5c2e577492dd605ee7de`; staging `b4a453bdc8dc3c8e95a9253adfe9b5b5d387941b`. Refreshed 2026-10-25. The clean local dev checkout matches. No twin ingestion or asset-registration API was found. Robot inspection was unnecessary for the independent local view.

Existing `onesa-ai-platform-backend/app/industrial_evidence.py` accepts `onesa-industrial-evidence-v1`, synthetic-only evidence bundles. `app/industrial.py` exposes authenticated preview and user-owned investigations. The separately exported `onesa-synthetic-evidence.json` passes its actual pinned Pydantic model; this validates file structure, not hosted import, twin behavior or assistant retrieval.

## Proposed transport

Single source: `server/onesa/contract.ts`. Identifier `urn:smart-factory:onesa-proposed:1.0.0`. Generated JSON Schema/OpenAPI/hash lock live in `contracts/onesa`. Proposed endpoint `/proposed/v1/batches` belongs ONLY to the test receiver. Proposed service bearer authentication is NOT the consumer's session scheme. Never aim this adapter at the synthetic importer.

The consumer must independently bind credential → approved installation/workspace and equipment/component mapping. Reject payload scope changes. Implement immutable per-event deduplication, conflict detection, per-item receipts and durable receiver timestamps. Accepted/duplicate with matching IDs and explicit ingestion time acknowledge; retry/rejected do not. Preserve deduplication longer than the producer's maximum retry/replay horizon. Transport failures retry unchanged events. A lost receipt may cause duplicate delivery. This is at least once.

The test receiver persists all accepted history. It projects live and simulated state separately, segregates scenario runs and excludes replay from current state. Older observations cannot replace newer ones. Source alarm projection keys the logical source-event identity with equipment/component/mode/run; repeats do not open duplicate live incidents, and simulated/replay events cannot open live incidents. Onesa must implement and verify these boundaries; they are not established by this fixture.

Known affected consumer locations: router registration in `onesa-ai-platform-backend/app/main.py`, configuration in `app/config.py`, persistence in `app/models.py` and Alembic migrations, generated `docs/api/openapi.json` and API client, app-owned Industrial navigation at `onesa-ai-platform-frontend/apps/chat/src/app/industrial/page.tsx`, and registered read-only evidence tools in `app/agents.py`. New twin/ingestion modules and route names require consumer design; none are asserted to exist. Preserve current synthetic import authorization and existing tools.

Registration API, authorization/concurrency, source/consumer-owned field ownership, artifact upload/import, AAS versions, target equipment/component IDs and a real deep-link route are absent. No target metadata writes, history deletion or fabricated twin links are attempted. Source-owned registration/mapping preview is reviewable locally; consumer registration acceptance is pending.

## Independent native view

Smart Factory's native viewer, models, schema validators, auth and persistence are app-owned. No viewer/contracts SDK, shared release or Onesa fixture is consumed. Three.js is an ordinary pinned third-party dependency selected locally. Optional compatibility uses app-local translation and explicit external identity mappings only.

Actual Onesa ingestion, asset registration, artifact importer, twin links and assistant retrieval remain independent consumer work. When those documented APIs are available, translate through the optional connector and verify matching equipment/component/document evidence in the real application. Their absence does not block Smart Factory development, installation, rendering, setup, local observations or saved work.
