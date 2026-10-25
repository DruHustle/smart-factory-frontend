# Onesa producer implementation plan

1. Inspect the three clean Smart Factory repositories and Onesa main/dev/staging contracts. Preserve existing MQTT acquisition, dashboard persistence, alerts and public demonstration.
2. Pin inspected consumer revisions. Since no twin ingestion, asset registration, AAS importer or component route exists, publish one explicitly proposed v1 contract with generated JSON Schema/OpenAPI, fixtures and a deduplicating receiver. Never send live data to Onesa's synthetic-only evidence importer.
3. Add persisted installation/instance/component identities, explicit versioned mappings and metric bindings. Preview mapping changes before applying; preserve external AAS identifiers and source/target ownership boundaries.
4. Carry provenance through the existing MQTT → .NET → Node bridge. Capture into a bounded PostgreSQL outbox within the existing telemetry transaction. Deliver asynchronously with scoped credentials, validated receipts, retry classification, quarantine and recovery.
5. Add a private operator view, protected artifact exports, reproducible pump/motor models/documents and standards-validated AAS JSON/AASX. Keep twin links unavailable until an actual consumer route exists. Implement the app-owned native Three.js view, local equipment/model/work persistence and independent simulator; no shared package or peer release is required.
6. Author a detailed illustrative pump/TEFC motor with a reproducible source/BOM. Preserve root IDs and archived model revisions; implement authored whole/subassembly explosion, geometric sections preserving bores, housing reveal and saved inspection state. Record visual and performance evidence separately from geometry counts.
7. Exercise real local MQTT, restart/outage/receipt behavior, authorization, schema drift, artifact validation, desktop/mobile UI and existing regressions. Commit focused changes and open review PRs; preserve production release gates.

Verification must distinguish producer/protocol/contract from actual consumer, hosted and real equipment acceptance.
