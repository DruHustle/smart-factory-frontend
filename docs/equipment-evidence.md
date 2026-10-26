# Independent equipment workspace: final evidence

Recorded 2026-10-26. Tested frontend source **`7f7e3324845ebcae50759681adabb873db9cd087`**, model revision **4**, SHA-256 **`cb1d547822ae954d698ae330ee6d2083fa966f6af3aec889c4605c1305d29712`**. Evidence committed afterward identifies this tested source explicitly. Backend: `fe86aca64aa09f6aca2efa6ad8ee9793f081ab5b`; edge: `700c9a55a211105171a1d58a8a3b3c3ce5832125`. [Machine-readable qualification](evidence/equipment-v4/qualification.json) retains source, model, device and run details. No merge or manual production deployment occurred.

## Acceptance

| Gate | Status | Concrete evidence / boundary |
| --- | --- | --- |
| 1. Standalone operation | Passed | Brand-new frontend-only clone, offline frozen package install, type check/build and 5 native workflows; optional integrations unset; fresh own PostgreSQL/Redis and individual login. |
| 2. Detailed asset / visual quality | Passed, illustrative scope | Reproducible constructive solids; 83 enforced clearance/contact/connectivity/interference checks; external/internal close-ups visually inspected. Manufacturer accuracy and certification are unavailable. |
| 3. Inspection correctness | Passed | Whole/subassembly animation and immediate scrubbing, actual moved picking, hidden/clipped focus, hollow caps, saved opacity/reveal/camera after reload, both themes and exact restoration. |
| 4. Provenance / delivery | Passed | 99 equivalent locally copied cases in each service; permanent quarantine and transient recovery; 20 generated samples through actual Smart Factory MQTT/.NET/Node outage and recovery. |
| 5. Target hardware performance | Pending mobile; desktop target observed | Apple M3 Metal desktop has approximately 60 FPS median across all seven stages; raw p95/settings below. A representative physical phone's 30 FPS target remains unqualified. |
| 6. Actual external consumer | Pending | No accepted actual Onesa twin ingestion endpoint/access was available. Mock/proposed protocol results do not establish consumer compatibility. |
| 7. Physical-device qualification | Pending | No physical phone, field gateway, PLC or factory equipment was exercised. Generated MQTT data remains simulated/replay. |

## Mechanical asset and completed geometry checklist

The MIT app-owned source exports **87 selectable entries**, comprising 15 assembly nodes, 46 individual selections and 26 repeated sets. These describe selection inventory; they do not establish manufacturer completeness. The GLB contains **186,236 triangles / 6,421,020 bytes**, without external textures or peer resources. Every existing revision-3 UUID is retained. Archived revisions stay deliverable; private replacements require the existing engineer mapping review, preserving installed IDs, notes, views and telemetry/document associations.

| Area | Result and check |
| --- | --- |
| Pump / fluid path | Passed: connected spiral collecting void/discharge, actual shell thickness, mating neck/flange faces, drilled bores/bolt circles, gasket, shaped vanes/shrouds and running clearance. |
| Seal / shaft support | Passed: aligned stepped journals, sleeve, stationary/rotating mating faces, spring/bellows on the rotating side, real O-ring recesses, chamber/gland, bored seats and retention. |
| Bearings / coupling | Passed: solid balls, grooved races and connected cages with measured clearance; complementary jaws/spider/keys/retention; one connected open-bottom guard with fitted legs, drilled brackets and seated screws. |
| Motor | Passed: axial tie-bolt passages and washers/nuts, connected cooling fan, actual grille/side ventilation, fitted hollow end shields, rotor/stator air gap and separately placed winding bundles. |
| Winding / terminal | Passed: 24 occupied slots, 12 closed equivalent bundles with separated rounded end turns; no intersection with rotor, teeth, core, housing or shields. Hollow terminal box, saddle, cover bosses, drilled cover and representative board/studs/links. |
| Base / mounting | Passed: chamfered drilled plate, connected feet and saddles, matching mounting openings and seated fasteners. |
| Hidden interference / floating geometry | Passed: all 2,556 part pairs screened; 288 bounding-box candidates tested by solid intersection; no overlap above **0.1 mm³**. Integral-part connected-volume counts detect detached fan/guard/support features. |

The expanded audit corrected genuine hidden overlaps in the seal stack, tie-bolt passages, flange fastening and mounting pads, and detached guard/fan features. [Raw audit](../fixtures/equipment/geometry-audit.json), [BOM/source scope](equipment-reference.md) and [reproducible generation](evidence/equipment-v4/geometry-generation.log) identify exact assumptions. Deliberate simplifications remain: stepped illustrative volute, equivalent conductor bundles, omitted thread helices/insulation films/complete phase-lead routing, approximate materials, and unverified fits/preload, hydraulic, electrical, pressure, thermal and strength behavior. No supplier CAD is represented as verified engineering.

## Visual review and before/after captures

The comparison imports archived v3 geometry and its original mapping through the authorized UI in the final viewer. View direction and inspection controls match; each revision is fitted to its own bounds. Per-view JSON retains camera coordinates. This compares actual geometry rather than counting polygons or BOM rows. Original workspace/UI captures from source `0a76016` are separately retained in `evidence/reference-3-before`; earlier qualification in `evidence/equipment` is explicitly archived.

| Inspection | Archived v3 geometry | Final v4 geometry |
| --- | --- | --- |
| Assembled | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/assembled-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/assembled-1440.png) |
| Whole explosion | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/fully-exploded-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/fully-exploded-1440.png) |
| Seal | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/seal-subassembly-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/seal-subassembly-1440.png) |
| Pump / impeller | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/pump-closeup-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/pump-closeup-1440.png) |
| Coupling | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/coupling-closeup-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/coupling-closeup-1440.png) |
| Bearing internals | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/bearing-closeup-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/bearing-closeup-1440.png) |
| Winding bundles | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/internal-closeup-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/internal-closeup-1440.png) |
| Motor internals | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/motor-closeup-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/motor-closeup-1440.png) |
| Ghosted housing | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/ghost-housings-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/ghost-housings-1440.png) |
| Hollow section | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/sectioned-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/sectioned-1440.png) |
| Exact restoration | [Before](evidence/equipment-v4/revision-3-comparison/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/restored-1440.png) | [After](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/restored-1440.png) |

Complete workspaces, with controls: [desktop assembled](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/assembled-workspace-1440.png), [desktop section](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/sectioned-workspace-1440.png), [narrow assembled](evidence/equipment-v4/software/equipment-standalone-detai-f5751-on-and-measurement-at-390px/assembled-workspace-390.png), [narrow motor](evidence/equipment-v4/software/equipment-standalone-detai-f5751-on-and-measurement-at-390px/motor-closeup-workspace-390.png). Native light/dark screenshots at 1440/768/390 px are retained in the software run directories. The initial Metal PBR frame was visually checked after adding shader precompilation and explicit shadow initialization; marker-only intermediate captures were discarded.

## Sustained interaction performance

**Actual identified GPU:** Apple M3, Mac15,13, 24 GiB RAM; headless Chromium / ANGLE Metal. This is hardware-accelerated desktop-browser evidence, distinct from phone/field qualification. The viewport is 1440×1000; raw JSON records canvas size, DPR, adaptive render ratio, anti-aliasing, shadows/exposure, browser/renderer, calls/triangles, available heap/resource indicators and model load-to-interactive time. The latter measures model request through linked shaders and first model render, not whole-page login/server startup.

Each scripted stage has **1.5 s warm-up + 8 s sustained interaction**, totaling 56 measured seconds. Orbit, explosion/scrubbing and plane motion are active. One nonblocking GPU fence limits queued render work; no idle 30-frame sample is used. Medians / p95 below are milliseconds, including scheduling and application work. No internals or caps were removed for the benchmark. Shadows add geometry submissions during moving hardware stages. Renderer memory counts and optional JS heap are indicators, not a complete GPU-memory measurement; external texture bytes are zero and generated environment texture byte usage is unavailable/null.

| Stage | M3 Metal desktop | SwiftShader desktop viewport | SwiftShader narrow viewport |
| --- | ---: | ---: | ---: |
| assembled orbit | 16.7 / 18.3 | 149.9 / 199 | 33.3 / 34.8 |
| whole assembly explosion and immediate scrub | 16.7 / 18.4 | 233.2 / 300.4 | 16.7 / 67.4 |
| motor subassembly inspection | 16.7 / 18.3 | 98.9 / 184.1 | 16.7 / 33.1 |
| moving hollow section | 16.7 / 33.3 | 498.7 / 584.4 | 66.7 / 216.6 |
| transparent housings | 16.7 / 18.5 | 148.3 / 183.8 | 33.3 / 34.9 |
| focused winding bundles | 16.7 / 18.3 | 66.7 / 83.9 | 16.7 / 18.5 |
| exact restoration | 16.7 / 18.3 | 133.8 / 198.4 | 33.3 / 34.6 |

Approximately 16.7 ms desktop / 33.3 ms mobile are median interaction targets, with p95 reported separately. The M3 run meets the approximate desktop median target under these conditions. Software-renderer timings do not qualify hardware or a physical phone. The narrow 390×844 viewport is emulated on the same host. [Metal raw data](evidence/equipment-v4/metal/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/reference-performance.json), [software desktop](evidence/equipment-v4/software/equipment-standalone-detai-cfe7b-n-and-measurement-at-1440px/reference-performance.json) and [software narrow](evidence/equipment-v4/software/equipment-standalone-detai-f5751-on-and-measurement-at-390px/reference-performance.json) retain intervals, draw counts and settings.

Profiling/inspection drove per-owner material reuse (fixing shared housing ghosting), shader readiness, sparse optional guides in one reused buffer, cached section topology/vertex buffers, early triangle rejection, coalesced cap generation, clipping-aware bounds, adaptive DPR/shadows and on-demand scheduling/disposal. Repeated parts are already combined within their stable selectable sets: the restored assembly has 75 draws, so runtime instancing/LOD was not introduced to hide required detail. Exact restoration error is zero; the final axial section reports zero open or degenerate contours. Unit tests separately verify tangent contact needs no invented cap and an annular bore stays empty.

## Provenance and real acquisition path

The [owned policy](telemetry-provenance-policy.md) defines exact mode/run types, ASCII 128-character IDs, Gregorian UTC receipt validation/canonicalization, sequence limits, enums/nulls/unknown fields, events and payload bounds. Node, .NET and Python each implement it locally with copied fixtures; no shared custom package or peer source is required. Invalid input is rejected before ordinary persistence/forwarding. Legacy absent/null provenance remains unknown. Measurement, gateway receipt and server ingestion time stay distinct.

Focused before-tests reproduced upstream/downstream disagreement and rejected-delivery retries. After alignment, all 99 cases pass in each implementation; edge tests both MQTT and serial. Historical invalid and permanent receiver failures enter bounded diagnostic quarantine without a false acknowledgement; deliberate transient statuses and unconfirmed timeouts retry the same source identity and recover. [Regression evidence](evidence/equipment-v4/provenance-regressions.json) distinguishes those cases.

The committed proof traversed the existing durable edge publisher, real Mosquitto, .NET 8 persistence/bridge and authenticated Node receiver with optional peer export disabled. During receiver outage, all 20 source samples persisted and remained pending (up to three attempts); after recovery, 10 simulated and 10 replay samples across two assets per mode were acknowledged, with canonical UTC metadata and zero quarantine. [Recovery evidence](evidence/equipment-v4/provenance-recovery.json) records exact ingestion-source revisions, which are unchanged in the final asset/renderer revision. This proves the available Smart Factory path, not physical machinery or actual Onesa acceptance.

## Independent startup, tests and rollout boundary

The final-source clone contains only the frontend repository, no sibling checkout, private environment file, peer credentials, cached peer model or custom peer package. Frozen installation uses the ordinary local pnpm cache. The app starts with optional integration variables unset and its own disposable PostgreSQL/Redis. Unrelated existing host services were left untouched. Every browser origin except the exact app origin is blocked: 1440px: 232 attempts, zero peer requests, 2 blocked analytics attempts; 768px: 230 attempts, zero peer requests, 2 blocked analytics attempts; 390px: 230 attempts, zero peer requests, 2 blocked analytics attempts. Blocked attempts are optional Vercel analytics (`va.vercel-scripts.com`), not required peer traffic. Raw [desktop](evidence/equipment-v4/network-audit-1440.json), [tablet](evidence/equipment-v4/network-audit-768.json) and [narrow](evidence/equipment-v4/network-audit-390.json) audits retain sanitized URLs.

Validation: 260 frontend tests across 34 files; 207 backend tests; 61 edge tests; public/auth/dashboard/AAS browser regressions 26 passed / 7 expected opt-in skips; final native suite 5 passed / 1 public-only skip, plus the Metal and archived-comparison workflows. Type checking/build, schema drift checks, AAS 3.0/AASX/hash/BOM validation, documentation/deployment checks and repository CI are recorded with their exact revisions. [Frontend tests](evidence/equipment-v4/unit-tests.log), [backend](evidence/equipment-v4/backend-tests.log), [edge](evidence/equipment-v4/edge-tests.log), [type check](evidence/equipment-v4/typecheck.log) and [build](evidence/equipment-v4/build.log) are retained.

Use the actual [startup/auth/import/view instructions](equipment-view.md), [geometry regeneration](equipment-reference.md) and [quarantine/retry policy](telemetry-provenance-policy.md). Individual engineer/admin authorization is required for edits; shared demonstrations remain read-only and file delivery authenticated. Preserve immutable revisions, installed IDs, backups and additive migrations on rollback. PRs remain drafts; no production merge or manual deployment is part of this qualification.
