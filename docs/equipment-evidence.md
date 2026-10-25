# Independent equipment implementation evidence

Recorded 2026-10-25. This is a review branch; no production deployment or merge is claimed.

## Delivery and acceptance

The native app implementation is independent: app-owned React/Three.js code, validators, GLB/source/BOM, model delivery, instance/tag identities, imports, local storage, simulator, history, documents, notes and saved inspection views. No custom shared SDK/viewer/schema dependency was introduced. The earlier proposed shared viewer/release prerequisite was rejected before installation; there was no peer runtime package to remove. Ordinary dependencies are pinned Three.js 0.186.1 / types 0.186.0, existing React 19.2.3, Vite 7 and pnpm 10.34.5. App services are PostgreSQL, Redis and its existing authenticated Node server. The .NET/edge repositories are optional existing acquisition companions, not prerequisites for native template/simulator operation.

**Premium reference asset acceptance remains incomplete.** The original 76-entry assembly includes the required major internals and supports actual interactive explosion, sectioning and isolation. Its reproducible source and MIT rights are included. It still needs a CAD-quality revision: boolean-machined volute/discharge mating and flange holes, properly shaped fasteners/cover ventilation, and more faithful winding routing. Current fastener/vent geometry is simplified, and one tangent winding contour is safely omitted from the Z cap. A detailed inventory is not a substitute for the requested professional asset finish. These gaps are not hidden by renderer tests or a claim of manufacturer accuracy. See [source and BOM audit](equipment-reference.md).

## Verification

- Frontend type check, build, schema drift checks, independent AAS 3.0 metamodel/AASX validation, documentation links/diagrams and deployment topology checks were run locally.
- Frontend regression suite: **144 passed across 33 files**. It covers source time/quality/mode, conversion, two-instance separation, saved work, model integrity/import/replacement, demo/private authorization, durable outbox, delayed HTTP acknowledgment and retry/partial/permanent errors. Existing .NET tests pass 96/96, including an exact .NET 8 container run; existing edge tests pass 58/58 in its supported virtual environment.
- Existing public/auth/dashboard/AAS/navigation browser suite: **26 passed, 7 expected opt-in skips**. Public equipment is read-only and model files require authentication.
- Native cold-start workflow: fresh individual login, local creation, actual WebGL, scene/list selection, simulator/history/replay, document access, notes/viewpoints after reload, themes, responsive layouts and actual context-loss/retry at 1440×1000, 768×1024 and 390×844. All three workflows passed. Every browser request outside the exact app origin is blocked; optional analytics attempts are recorded. No peer call is required.
- Detailed reference workflow: **2 passed**, desktop 1440×1000 and mobile viewport 390×844. The desktop case imports the full 5.1 MB GLB and local mapping through the actual form. Both exercise assembled, fully exploded, isolated selected seal subassembly, section/reverse, ghost/hide covers, isolated winding close-up, saved reveal state after reload, and exact restoration. Tests require restoration error below 1e-12 and the original assembled draw count after restoring all parts.
- Pure geometry checks verify the annular cap area with an empty bore and reject open contours. Repeated explosion/reassembly preserves baseline transforms. Admission checks reject resource URLs, oversized/complex models, repeated graph parents, composed-transform overflow and invalid vertex indexes.

Screenshots and raw measurements are in [the equipment evidence directory](evidence/equipment). Rendering uses ANGLE SwiftShader in Chromium 145.0.7632.6 / Playwright 1.58.2 on Mac15,13, Apple M3, macOS 27.0.1, DPR 1; the mobile configuration is a viewport on the same host, not a physical phone. Each measurement samples 30 animation frames with the canvas scrolled into view. These are frame intervals under test load, including scheduling/compositing, not isolated GPU timings or an FPS service guarantee. The same critical geometry is retained on both sizes. Software rendering disables shadows; hardware shadows and DPR are adaptive. Static views render on demand.

## Clean-checkout and measured render evidence

A fresh clone at `94641b8` installed with `pnpm install --offline --frozen-lockfile` from the ordinary pnpm store, then passed type checking, production build and **5 cold-start browser tests (1 public-only test skipped)**. Its parent directory contained only this frontend checkout; no sibling checkout, environment file or existing node_modules was copied. All peer endpoints/tokens were unset. Fresh browser contexts blocked every non-app origin. The three audited workflows recorded 230/229/228 attempts respectively, **zero peer requests**, and two blocked optional analytics attempts each. Raw [qualification](evidence/equipment/clean-checkout.json) and [network audit](evidence/equipment/network-audit-1.json) are retained. Later commits add evidence, pin the browser CI runner and preserve the active equipment identity in the local URL on reload.

The following clean-run numbers are median / p95 frame intervals in milliseconds. Canvas and critical geometry remain visible during sampling. Lower intervals are better; these software-rendered samples do not establish physical mobile performance.

| State | 1440×1000 desktop viewport | 390×844 mobile viewport |
| --- | ---: | ---: |
| Assembled | 150.6 / 383.4 | 33.3 / 133.3 |
| Fully exploded | 133.2 / 317.4 | 33.3 / 67.1 |
| Selected seal subassembly | 33.2 / 67.2 | 16.8 / 67.1 |
| Z section | 133.3 / 249.8 | 16.7 / 33.5 |
| Ghost housings / hide covers | 149.9 / 250 | 16.7 / 34.3 |
| Isolated winding close-up | 66.6 / 114.6 | 16.7 / 17.6 |
| Restored assembly | 216.6 / 365.9 | 16.7 / 17.5 |

Original/restored assembled draw counts are 66 in both configurations, with 66 geometries and two textures. Fully exploded inspection uses 141 draws including guides. The section has 57 generated caps and one safely omitted tangent contour (Winding phase 1). Restoration error is zero in the measured matrices. Raw [desktop](evidence/equipment/performance-1440.json) and [mobile viewport](evidence/equipment/performance-390.json) measurements include per-state counts. [Assembled](evidence/equipment/assembled-1440.png), [exploded](evidence/equipment/fully-exploded-1440.png), [seal](evidence/equipment/seal-subassembly-1440.png), [section](evidence/equipment/sectioned-1440.png), [ghosted](evidence/equipment/ghost-housings-1440.png) and [winding close-up](evidence/equipment/internal-closeup-1440.png) captures are retained for visual review.

## Optional protocol and outage evidence

Real local MQTT was exercised through the existing edge durable publisher, Mosquitto and .NET 8 subscriber/bridge into the Node store. Ten generated source samples produced 38 acknowledged events for two instances and six source component identities, including four source-alarm transitions and two connection events. All data remained **simulated**, despite using a real protocol stack. No PLC/hardware operation is claimed.

Two receiver-down scenario runs each persisted ten local source samples while export was unavailable. Native equipment/browser workflows remained usable during the outage. Queued retries are bounded and eventually quarantine at the configured limit. On restoring the test receiver and using the authorized retry action, 38 queued deliveries were acknowledged; only three deliberately unmapped local test records remained quarantined. They remain visible as an integration error rather than being reported healthy. Source event IDs/timestamps are unchanged. Receiver history is durable and deduplicated. The test receiver belongs to this app's proposed contract, not Onesa.

The pinned real consumer's synthetic-evidence Pydantic model accepted the separate six-signal synthetic export structure. No actual Onesa twin ingestion/registration API was available. Hosted pairing, real twin rendering/links, consumer assistant retrieval and production/staging acceptance are pending. Existing deployment gates/accounts/protections are preserved; no release gate was bypassed. See [optional consumer API handoff](onesa/CONSUMER_HANDOFF.md) and [operations](onesa/OPERATIONS.md).

## Reproduction and rollout

Use [independent installation/startup](equipment-view.md), apply additive migrations 0018–0021, and keep all `ONESA_*` configuration absent for native operation. `pnpm e2e:equipment` creates and removes only its own disposable database/Redis stack and supported fixture account. `pnpm check`, `pnpm test`, `pnpm build`, `pnpm equipment:schemas:check`, `pnpm docs:check` and `pnpm deployment:check` qualify the repository. Database-backed tests require `TEST_DATABASE_URL` / optional `TEST_REDIS_URL` pointing to isolated test services. Edge tests use its own installed requirements/venv. Optional MQTT/receiver tests are explicitly opt-in.

Back up the application's database before rollout. Disable optional exchange independently when needed. Preserve immutable model revisions, source identities and additive columns/tables on rollback; redeploy the previous reviewed image instead of rewriting migration history. Production and any authorized staging rollout remain subject to repository review/CI/environment controls.


## Review branches

Backend: `af60378`, [draft PR 3](https://github.com/DruHustle/smart-factory-iot-backend/pull/3), [CI passed](https://github.com/DruHustle/smart-factory-iot-backend/actions/runs/40234312487). Edge: `193d4f6`, [draft PR 2](https://github.com/DruHustle/smart-factory-iot-edge/pull/2), [CI passed](https://github.com/DruHustle/smart-factory-iot-edge/actions/runs/40234317970). The frontend branch is `feat/native-equipment-monitoring`. These repositories expose main/main/master review targets; no dev/staging branches or staging environment were added. Nothing was merged or deployed to production.

Frontend CI initially passed install, migrations, schema/AAS validation, type checking and unit tests, then failed because `ubuntu-latest` selected Ubuntu 26.04, unsupported by pinned Playwright 1.58.2. The browser job is explicitly pinned to Ubuntu 24.04 and the complete gate is rerun.

The Ubuntu 24.04 run passed public regressions but exposed desktop creation assertions using a five-second default wait and an advanced reload test relying on catalog sort order. Creation tests now require the actual successful API receipt before checking the selected instance, with a bounded 20-second cold-start expectation. Native URLs preserve the catalog-authorized equipment UUID across reload; advanced tests assert the exact same instance before reopening its saved view.
