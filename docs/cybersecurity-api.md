# Security evidence API and exchange profile

The application owns this validator, documentation and fixtures. `ot-security-evidence/v1` is optional interchange, not a shared package or runtime dependency. Each receiver configures its own source and reviews its own identity mapping. No external consumer acceptance is implied.

## Ingestion

`POST /api/security/evidence` accepts JSON `{"events":[EVENT,...]}` or `application/x-ndjson` with one event per line. Supply `Authorization: Bearer <one-time scoped source credential>`. Maximum raw body 1,048,576 bytes, 1–100 events, 8,192 UTF-8 bytes per event before/after normalization. UTF-8 must be valid. No compressed uploads. Invalid/unsupported fields or types fail the complete batch before persistence; conflicting retries roll back the complete transaction.

202 returns `{"accepted":[{"sourceEventId":"immutable-id","status":"accepted"}]}`; an identical normalized retry returns `status:"duplicate"`. Deduplication key is source identity + immutable sourceEventId. Reuse with different normalized content returns 409 `event_identity_conflict`. Authority mismatch is 403, invalid source credential 401, invalid event/batch 422, size 413, capacity/backpressure 429 with Retry-After, disabled/unavailable 503. Receipt means durable normalized evidence; it does not mean a finding was derived, a producer was attested or a control is secure. Preserve the full original envelope/ID through retries. Permanent failures require correction/review; transient failures must not be acknowledged as delivered.

| Required field | Semantics |
| --- | --- |
| schemaVersion | Exactly `ot-security-evidence/v1` |
| producerNamespace | Nonblank, max 64; must equal configured source namespace |
| sourceEventId | Immutable nonblank symbolic identifier, max 128 |
| occurredAt | Valid real UTC RFC3339 calendar/time, Z or +00:00; 1–9 fraction digits normalized to milliseconds |
| mode | live, simulated or replay; never inferred from absence |
| eventType | One of the strict profiles below |
| assetRef | null or exact `{namespace,assetId,componentId}`; first two symbolic strings ≤128, component string ≤128 or null; resolved only by reviewed mappings |
| summary | Nonblank sanitized text ≤512 |
| quality | good, uncertain, bad or unknown; not authenticity proof |
| producerVersion | Nonblank version string ≤64 |
| attributes | Exact typed object for the event type |

Optional: scenarioRunId (required for simulated), replayRunId (required for replay and rejected outside replay), producerReceivedAt (same UTC rule), sessionId, sequence, correlationId. IDs are ≤128, ASCII letters/digits/underscore/dot/colon/slash/hyphen, no URL schemes or userinfo. Sequence is a nonnegative safe integer, optional producer ordering context only; sourceEventId remains deduplication authority. Session/correlation are producer labels, not user/physical identity or permission. SourceId, ingestedAt, user/tenant/site IDs, local targets and extra fields are rejected. Receiver ingestion/expiry/skew/late metadata is stored separately.

| Event type | Strict attributes |
| --- | --- |
| auth.authentication_failed, auth.authorization_denied | service, outcome exactly denied, reasonCode; optional principalRef exactly `sha256:` plus 64 lowercase hex |
| tls.certificate_observed | endpointRef symbolic already-configured connection; notBefore/notAfter valid ordered UTC; fingerprintSha256 64 hex normalized lowercase |
| config.changed, config.drift_observed | configRevision; optional baselineRevision; changedKeys 1–32 symbolic strings; no raw values |
| identity.unrecognized | inputRef, observedIdentityRef; derive only with reviewed input allowlist |
| collector.health | state online/offline/degraded/paused; optional expectedIntervalSeconds integer 1–86400 |
| software.inventory_observed | inventoryRef, sha256 (64 hex) referring to a separately validated report |
| integrity.change_observed | previousSha256/currentSha256; evidenceBasis self_reported/collector_observed/verified_artifact; each remains a source claim |

The owned `/api/security/observations` endpoint also accepts explicit `smart-factory-ot-observation/v1` extensions: `transport.connection_observed` with `{connectionRef,protocol:"mqtt"|"http",tlsActive:BOOLEAN,evidenceBasis:"runtime_socket"|"declared_config"}` and `input.rejected` with `{inputRef,reasonCode}`. These extensions are omitted from neutral v1 exports with an explicit omission count; arbitrary attribute blobs are never admitted.

Versioned examples: [simulation JSON](../fixtures/security/v1/simulated.json), [simulation NDJSON](../fixtures/security/v1/simulated.ndjson), [historical replay JSON](../fixtures/security/v1/replay.json), [historical replay NDJSON](../fixtures/security/v1/replay.ndjson). Configure the matching namespace/mode and scope first. Synthetic findings do not establish physical incidents.

## User APIs and reviewed imports

`/api/trpc/security.*` uses the existing authenticated cookie session and roles. Queries: availability, overview, posture, events, findings, finding, sources, report, equipmentOverlay, equipmentForFinding. Filters: source, mode, scoped registered target, received/last-seen since, search, severity/status for findings and bounded page. Operator export supports json, ndjson or formula-safe CSV. Viewer event/snapshot/report content is redacted. Source bearer credentials never grant access to these queries.

Engineer APIs: importEvidence (strict file JSON/NDJSON under a selected configured non-system source), certificate (public PEM, configured connection, explicit mode/run), proposeBaseline, reviewPosture, seedDemo, simulateRecurrence, and assigned investigation actions. Admin APIs: createSource, credential rotate/revoke, mapIdentity, approveBaseline, activateRule, retention, purgeExpired, audit, outbox, retryOutbox and retryReport. Lifecycle action requires expectedVersion, bounded reason and owned evidence IDs for resolution; stale versions return conflict. Risk acceptance requires finite expiry within 30 days. See [the permission and lifecycle matrix](cybersecurity.md).

`POST /api/security/reports?sourceId=UUID&targetKind=application&mode=unknown&producerVersion=SCANNER_VERSION` requires an individual engineer/admin session. For asset/device scope include targetId; it must already be authorized by the source. Include runId for simulated/replay. Origin protections remain in force for browser mutations. The body is a separate max-4-MiB strict Trivy schema-2 JSON subset:

- SchemaVersion exactly 2; CreatedAt UTC; ArtifactName ≤128; ArtifactType container_image or filesystem.
- Results ≤20; each exact Target ≤256, optional Class os-pkgs/lang-pkgs, Type ≤64, Vulnerabilities ≤500; total ≤2,000.
- Each vulnerability: CVE-pattern VulnerabilityID; PkgName and InstalledVersion ≤128; optional FixedVersion ≤128; Severity UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL; optional Title ≤512; optional CVSS exact `{nvd?:{V3Score:0..10,V3Vector?:STRING≤256}}`.
- Unknown fields/versions are rejected. Full native Trivy output must be projected to this documented subset before upload. This is a strict supported subset, not a claim to parse all scanner output or an SBOM with no vulnerability records.

[The synthetic report](../fixtures/security/trivy-schema2.json) demonstrates the subset. Scanner version is explicit import metadata because schema-2 reports do not inherently carry a reliable scanner version. Omit no unknown fact by inventing it: default producer version and local mode are `unknown`. Original uploaded-byte SHA-256, normalized subset, scanner version, report and ingestion times, selected scope, mode/run, matching method, rule version and processing cursor persist. Identical report hash/context is idempotent; changing reviewed context for that same source/hash is a 409 review conflict. Known modes must match the source's scope. Unknown evidence remains an owned local import and is not silently exported as neutral live evidence.

201 accepts the report durably; background rule work advances in chunks of 20. Sources and policies shows processing state, cursor, bounded failure code and report inspection. Failed chunk transactions preserve the cursor and retry with exponential backoff capped at 300 seconds, at most 12 consecutive attempts before quarantine. Admins can authorize a report retry with an audit reason after resolving capacity or data problems. Candidate findings cite exact package/version reported by the scanner with advisory severity/CVSS separate from local priority, and explicitly require applicability review. Missing fixed version, unsupported scanner metadata or no finding never proves safety. No feed fetch occurs.
