# Expanded OT workflow qualification

## Scope and release status

This continuation builds on PR #47's incremental candidate `ff299a33d0e3c5f335ca47eb0615a29c84870657`. The user approved building and promoting **Smart Factory: improve operational value and UI for OT engineers**. This document records implementation scope and qualification boundaries; a successful local check is not a production release receipt.

At the continuation baseline, both hosted UI aliases and the Oracle API reported frontend `b5e148b3f14c92ab3bde48ea05c6bcfb025d2eda`, with backend `e5634a58276dfacbc1e117db2f5a72b44b2228be`, edge `1deb53c43e25c08e7bedbb9f51583844e1a051b0` and schema `0035_industrial_connectivity`. Those companion pins and the retained rollback source remain unchanged.

The expanded candidate must be built and qualified at its own exact revision. The prior ff299a3 artifact does not qualify these new changes. Current hosted check results belong to the commit shown by [PR #47](https://github.com/DruHustle/smart-factory-frontend/pull/47).

## Implemented outcomes

| Area | Implementation | Meaningful verification |
| --- | --- | --- |
| Physical alarm evidence | Additive condition evidence, frozen evaluated threshold, independent acknowledgement/review, clearance only from eligible in-range observations, explicit unknown validity | PostgreSQL lifecycle cases include active/cleared and acknowledgement, bad/retained/replayed/out-of-order data, expired values, configuration changes, disconnect/reconnect and legacy writers. |
| Source validity | Cyclic/on-change policy and explicit maximum held-value age; communication receipts never rewrite sample timestamps | Tests cover held-value expiry, inventory/latest-reading projection, observed connection interruption and a subsequent fresh measurement. |
| Factory attention | Backend-scoped list/page/action/export queries plus named-factory attention panel | Regression includes a shared source across factories, asset-attributed events, unknown factory denial and list/page/export parity. |
| Shift handover | Persisted timezone/shift schedule, append-only attributed notes, previous/current shift navigation, equipment/incident links and outstanding actions | Real database tests include optimistic conflicts, cross-factory link denial, role/demo restrictions and preserved historical boundaries after schedule edits. |
| Production/utilities | Explicit manual input periods, product/cycle data, OEE, unioned downtime, reason breakdown and aligned meter deltas | Pure and PostgreSQL cases cover partial windows, missing counts, resets, overlaps, impossible performance, concurrent inserts and DST boundaries. |
| Assistant context | Server-validated source/asset/incident/window, source-and-asset intersection, cited snapshot and scoped conversation generation | A two-source/two-asset fixture reproduces and prevents evidence widening; decoys outside the window, in another evidence mode and with poor quality cannot change the selected statistics. |
| Recorded demonstration | Six named scenarios with one deterministic signal/calculation model and context links | Browser journey covers all scenarios, outage gaps, threshold visibility, mobile equipment→Assistant handoff, Analytics inputs and recovery handover links. |
| Floor interaction | Selectable local geometry before optional HDR delivery, in-place detailed model upgrade, faster partial batch display and balanced lighting | Actual Chrome/SwiftShader tests deliberately hold lighting delivery, select a proxy, release HDR/models and verify unchanged identity and controls. |

The [operations guide](ot-operations.md) explains what users can do and how the calculations are bounded.

[Desktop/mobile application screenshots and progressive 3D evidence](evidence/ot-operations-20261102/README.md) show the implemented workflow and its visible evidence labels.

## Local validation

The local test environment uses disposable PostgreSQL 16 databases, Redis and synthetic accounts. The UI fixture database is separate from the database used by unit suites. Its final seed applies the frozen migrations from scratch; no migration journal hashes are rewritten to manufacture compatibility.

Focused results recorded during implementation:

- Final complete repository run: **1,039 tests passed, zero failed, zero skipped** across 121 test files. The account-access suite ran all twelve tests using the locked local migration CLI, and the AutomationML schema validator was installed so its schema test ran. A [machine-readable local summary](evidence/ot-operations-20261102/validation-summary.json) records the file results.

- Alarm/source/factory/action regression: 8 files, 48 tests passed. Subsequent clearance-quality and indexed-query changes received focused reruns, including all 7 alarm tests against a freshly migrated database.
- Operations calculations, persistence and factory alignment: 24 tests passed, including a terminal maintenance signal that remains consistent with the displayed maintenance state.
- Assistant authority: 8 PostgreSQL integration tests plus 3 shared handoff tests passed. The existing history/knowledge suites also passed during integration.
- 3D preparation/batching/environment: 43 unit tests passed. The complete relevant stage/fallback/batching/NVIDIA browser run passed 29 tests; the final lighting adjustment received a 13-test actual-renderer rerun.
- Real application OT browser journeys cover six scenarios; 390 px equipment→Assistant navigation; desktop/mobile Analytics; and live engineer configuration/production, operator handover, persisted reload and viewer write denial. The suite is included in the maintained public-demo runner.
- All four OT browser journeys passed. All 37 existing data-workspace browser regressions also passed after extending their fixture with valid operations evidence; capability advertising and older-API assertions remain intact.
- TypeScript, frontend production build and Oracle/Vercel topology/source checks passed during integration. Final whole-repository results are attached to the candidate's checks; focused counts above are not added together as an inflated total.

Local browser rendering used installed Chrome 156 with SwiftShader because the pinned Playwright Chromium archive could not be downloaded in this environment. Hosted qualification retains the repository's pinned Playwright browser and normal CI configuration. The local executable override is temporary and untracked.

### 3D timing interpretation

The controlled single-conveyor fixture recorded the first submitted 3D frame **390 ms after viewer mount**. HDR shader readiness was **3,251 ms** because the test deliberately withheld its atlas until after proxy selection and screenshot capture. These are local fixture timings; they exclude application navigation, initial renderer code and API time. They establish that optional lighting no longer blocks the first selectable scene. They do not establish instantaneous full-model download or a hosted page-load service level.

All three NVIDIA conveyor/rack/cart references received desktop/mobile checks. Their source geometry, material groups and provenance remain intact. This is an incremental rendering/loading improvement, not a claim of new photorealistic artwork or a replacement graphics engine.

## Migration and rollback qualification

The candidate includes the earlier `0036_incident_actions` plus:

- `0037_ot_alarm_conditions`: additive condition fields, existing activity kinds retained, three new source-evidence activity kinds, and a bounded latest-rule lookup index. Its frozen SHA-256 is `9f253b28da7f87fb19f8f5b562f4233ae32c6132946c48369df9edb03f19d972`.
- `0038_ot_operations`: configuration, production periods, handover with historical shift identity, and actor audit records. Its frozen SHA-256 is `57806d770c4f93f790c4e6225480f128d9ab42655428d80af7e8e8459fa40f61`.

`scripts/bundle-smoke.py` extends the existing native six-process qualification. It seeds complete alarm evidence and each added activity kind, operations configuration/production/handover/audits, and preserves exact record fingerprints. It exercises the existing fallback's acknowledgement, requires the new data to survive rollback and roll-forward, and verifies restored candidate capabilities and calculation outputs. Fallback compatibility excludes only capabilities that the retained old API did not advertise; schema/companion/worker checks remain enforced.

The helper fixtures were executed locally against migrated PostgreSQL and real current RPC handlers, including a deliberately corrupted handover rejected by fingerprint validation. That helper exercise explicitly records `actualFallbackImageTested: false`. Actual prior-image cutover and singleton-worker recovery require the native ARM64 job; the helper exercise does not replace it.

Rollback retains additive data. It must not drop operations records or reinterpret a resolved investigation as a cleared source. A legacy API does not update the new condition assertions; newer legacy evidence therefore invalidates a current claim after roll-forward until verified measurements restore it.

## Promotion boundary

Use the existing [manual deployment commands](../scripts/manual-deployment/README.md) and [Oracle runbook](../deploy/oracle/README.md). The order remains:

1. Qualify and retain the exact immutable candidate and compatible fallback, including native ARM64 rollback tests.
2. Deploy the Oracle API and singleton worker, applying additive migrations.
3. Verify the actual schema digest, frontend/backend/edge identities, required capabilities and recent compatible worker receipt.
4. Promote the UI through current-main CI, then verify both UI release identity and proxied runtime contract.

The continuation workspace does not contain the established trusted SSH identity or agent for `ubuntu@152.70.22.84`. The maintained host installer requires that connection. User authorization is already granted; the missing connection is an execution prerequisite. Do not merge the API-dependent UI ahead of that deployment or describe a PR/preview as production.

## Practical limits

Production counts and meter values in this release are explicitly manual records. Automatic PLC/MES/meter bindings, calibrated utility savings, pricing/carbon factors and predictive diagnoses require additional configured evidence. The six scenario series are labelled simulations separate from stored baseline telemetry. Shared demos cannot mutate operational work. No physical device, firmware, credentials, control command or external recipient is changed by these local checks.

Source health, worker readiness and an attractive 3D view remain different claims. The UI exposes the evidence available for each rather than making one stand in for another.
