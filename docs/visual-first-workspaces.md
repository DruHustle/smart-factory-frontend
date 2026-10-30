# Graphical workspaces and navigation correction

27 October 2026. This review covers the graphical implementation, not physical commissioning. See the [before/after gallery and recordings](evidence/visual-first/README.md).

## Recovered journeys and distinct representations

Git history at `81bdd2f`, `0524254`, `ce2f5b4`, `26f21df` and the initial implementation retained connectivity summaries, incident severity, an asset portfolio and navigation into detailed tools. The graphical implementation added native item previews and gap-aware observation charts. The system Overview now presents the whole factory as a native 3D floor, alongside summary graphs and indicators; detailed inspection remains in each item's workspace.

Overview loads the complete authorized inventory in one bounded query, rather than showing one list page or one selected compressor. Assets, standalone equipment, sensors, controllers and gateways each appear once. All items have immediate labelled 3D representations; seven bundled illustrative model families load asynchronously. An accessible floor plan and searchable item list remain available. Zone filtering is explicit. Selecting an item highlights it and opens a short summary without narrowing factory totals or the factory trend. Its Open item and Inspect 3D links lead into the existing detailed menus and preserve return context.

The summary includes item types, device observation states, incident severity, a gap-aware factory trend across assets/equipment, recent incidents and FX/TSN health. FX connection overlays only join explicit reported device identifiers. Missing diagnostics stay unknown; stale collector evidence is labelled stale. A recorded connection does not establish current delivery. Automatic layout is illustrative, not surveyed floor geometry. The floor remains usable with proxy geometry if model downloads fail and falls back to the plan if WebGL is unavailable.

Each workspace has a purposeful visual: equipment symbols in inventory, one selected source path in Monitoring, investigation timelines, a security collector coverage matrix and severity profile, signed Analytics comparisons, grounded Assistant evidence links, and one integration configuration map. Repeated symbols convey the same equipment kind. No extra charts repeat the same information merely to decorate a page.

An individual item's linked-model preview loads automatically when opened and has a reset action and an accessible component link. The full native workspace retains its detailed component identities, explosion/reassembly, sections, ghost housings, internal inspection, observations, saved views and security-to-component focus. The preview does not project parent readings onto components.

## Released interaction and graphics update - 30 October 2026

The floor now uses direct hand grabbing for items and empty-floor panning, with compact labelled icon controls and fullscreen. Original GLB material groups retain steel, painted surfaces, glass and rubber; environment reflections, floor finishes and adaptive shadows ground the equipment. The supported plan remains available when WebGL cannot render. See [factory layout gestures](factory-layouts.md) and the [current production gallery](evidence/release-20261030/README.md). The older screenshots below record their original revisions.

## Brand, motion and access

The sign-in page again uses its original industrial photograph and dark overlay. Theme-aware opaque form surfaces remain readable. The five uppercase sidebar labels share one 12px, medium-weight, normal-spacing, 16px-line-height style. Active colour/background changes preserve that typography; subtopic casing remains unchanged. Actual desktop and mobile drawer checks compare all five computed styles, including after changing the active destination.

Camera fitting, focus and saved-view restoration use a finite 300ms transition, cancelled by user input and completed without background animation when hidden or reduced motion is requested. Existing 360ms explosion choreography respects reduced motion. Charts use a finite transition, preserve missing buckets and show a point for a single populated bucket. Eligible newly received values receive one brief emphasis; workflow-state changes receive a short transition. Stale sources do not acquire looping activity or simulated motor rotation. Controlled render measurement waits for the camera to settle.

Existing authorization, evidence, unit, timestamp, publication and command boundaries remain in force. Demonstration screenshots use isolated fixtures. Configuration lines do not assert active delivery, source coverage does not certify security, illustrative geometry does not establish physical state, and firmware delivery remains disabled without a verified updater.

## Verification

The current Overview tests cover a complete mixed floor beyond fifty items, recorded link visibility, native multi-model rendering, all-item selection, explicit zone filtering and reset, whole-factory graph scope, model-download fallback, Demo/Live switching, account restrictions, and mobile/desktop drill-downs in both themes. The native inspection, date recovery and lazy-page recovery checks remain. The historical evidence below records the earlier layout.

- Typecheck and production build pass.
- Sixteen inspection and camera unit checks pass, including exact final camera position, interruption, hidden-page completion and reduced motion.
- The complete 18-case rendered suite passed on clean `7410a5d`: five viewport widths (360/390/768/1024/1440), both themes, zoom-layout checks, graphical drill-downs and both native inspection recording paths.
- The final six graphical/inspection cases passed on clean `b865621`, adding actual Chromium touch dispatch, drawer tap, newest-reading fallback and visible single-bucket observations.
- Original native general workflows pass at desktop/tablet/mobile; detailed geometry and restoration pass at desktop and mobile. The new motion exposed a measurement race; disabling measurement until camera settlement fixed it while retaining the exact original draw-call/restoration assertions and deadlines.
- Four Overview before/after pairs, selected workspace screenshots and four short recordings are retained with hashes and source metadata.

The original zoom checks emulate the corresponding CSS layout and device scale, not physical browser-chrome zoom. Browser touch and software WebGL are emulated; physical mobile GPU performance remains a separate qualification. Hidden/reduced-motion behavior is covered by bounded software checks rather than a claim about every deployed browser. An actual Onesa consumer and hardware execution remain separate acceptance outcomes.

All existing quality gates, schema checks, native equipment/security and workspace suites remain required before promotion. The added CI job retains graphical navigation and recording evidence. Source/image/runtime release identity is reported separately by the existing release contract.
