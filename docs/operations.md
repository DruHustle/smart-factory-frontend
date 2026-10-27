# Operating guide

Maintained 27 October 2026 for the product-experience candidate. This guide describes implemented software; deployment acceptance is recorded separately against exact sources and image digests.

## Observe and investigate

Use Overview attention links, then the affected item. Inspect acquisition time, receipt time, evidence mode, quality, unit and configured freshness before interpreting a value as current. The worker requires MQTT 5 Retain As Published subscriptions to preserve retained-delivery semantics. Messages delivered before the verified subscription is established, and old outbox records without verified transport flags, remain historical. Existing MQTT 3.1.1 publishers remain supported through the broker. The managed broker must independently accept the MQTT 5 worker subscription during release acceptance; no broker configuration is changed by this implementation. See the [OASIS subscription semantics](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html#_Toc3901169).

Missing observations mean unknown or stale; a configured record and a ready API do not prove equipment availability.

Monitoring pause stops periodic requests; Refresh performs a deliberate update. Hidden/offline pages pause unnecessary polling. Arm telemetry normally backs off to 30 seconds when stale; an individual authorized operator may select a one-minute bounded fast mode for an active task. Navigation does not issue commands.

In Administration → Integrations, administrators can inspect the latest authenticated telemetry-worker receipt, pending/quarantined delivery counts, oldest known queue acceptance, ingestion quarantine, security delivery queue, collector receipt times and email failures. Receipts become stale after 90 seconds. A missing receipt means queue depth is unknown. Old legacy queue entries with no acceptance timestamp retain unknown age. Provider acceptance is distinct from recipient delivery. Backup age stays unknown unless independently established; this release does not invent a successful backup receipt.

Process alerts and cybersecurity findings have separate investigation histories. Acknowledge and assign only with an individual authorized identity. Record observations in notes. Confirm downtime explicitly after review; a connectivity loss does not automatically establish factory downtime.

For canonical IDs and broker-safe topic encoding, use the [telemetry contract](telemetry-contract.md). Updating an identity does not update a publisher or broker ACL.

## Recovery and publication

See [access, recovery and publication](access-and-publication.md). Disablement, role changes and revocation invalidate persisted sessions, including sockets and delegated service requests. Verify identity before issuing a single-use expiring temporary password; deliver it through the organization's verified channel, never logs or an API response. The last usable individual administrator is protected.

Private passport preview does not publish. Select reviewed fields and asset-appropriate guidance, publish explicitly, inspect the public snapshot, and revoke it when needed. A numeric asset identifier grants no public passport access.

## Release and rollback

Use the [Oracle runbook](../deploy/oracle/README.md). Build from clean immutable revisions in all three repositories, qualify the ARM64 bundle and preserve the tested image digest and sources. Apply migrations and API first; retain one worker. Check `/api/runtime/contract` and operating evidence. A ready response alone is insufficient.

The UI checks API contract version, required capabilities and applied migration hashes. Deployment verification additionally compares the exact schema digest and current compatible singleton-worker receipt. The Vercel workflow repeats compatibility and current-main checks immediately after the build and before promotion. No branch-protection claim is inferred from workflow configuration; inspect repository settings separately without changing them.

Keep the prior image and static artifact. Additive schema compatibility allows application rollback; never reverse/drop data as part of routine rollback. Stop the candidate worker before starting a prior worker. Recheck the prior application's schema/capability contract, role/session policy, ingest compatibility and queue health before changing the UI.

## Disposable qualification

Use only loopback dependencies and isolated databases. The following outcomes are distinct: software/unit contracts; broker/.NET/Node/SQL delivery; process restart and outage recovery; ARM64 image acceptance; dependency/image audit; backup/restore drill; physical hardware commissioning; external consumer acceptance; hosted production promotion.

A restore drill must dump disposable dashboard/device/telemetry storage, restore into new disposable databases, compare row/evidence identities and restart against restored state. Retain checksums and timing with the exact source/image manifest. Never label a local drill as proof of a recent production backup or physical commissioning.

Dated reviews and manifests are historical evidence, not current runbooks. The immutable candidate manifest is generated from image inspection and clean Git sources; production runtime identity is retrieved from the running service. The portfolio is maintained in its own repository and must not be represented as updated by application changes.
