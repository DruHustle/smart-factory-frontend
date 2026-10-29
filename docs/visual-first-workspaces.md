# Graphical workspaces and navigation correction

27 October 2026. This review covers the graphical implementation, not physical commissioning. See the [before/after gallery and recordings](evidence/visual-first/README.md).

## Recovered journeys and distinct representations

Git history at `81bdd2f`, `0524254`, `ce2f5b4`, `26f21df` and the initial implementation retained connectivity summaries, incident severity, an asset portfolio and navigation into detailed tools. The graphical implementation added native item previews and gap-aware observation charts. The system Overview now keeps the whole inventory in view; native 3D belongs to an individual item's workspace.

Overview leads with the complete authorized inventory, a graphical item-type distribution, device/gateway observation states and process incidents. Factory connections shows recorded paths for six gateways per page, with their explicitly linked assets and devices and access to every remaining gateway. Each gateway preview shows up to six recorded links and a link to all of its connections; independent and unconfigured items remain in the inventory. The visible item collection is ordered by name and paginated in groups of twelve; every registered asset, gateway, device and standalone equipment item remains reachable, whether connected, offline or unconfigured. Summary counts come from the API's full-scope groups, not the displayed page. A linked 3D representation remains part of its asset, and standalone equipment appears once. No arbitrary model or gateway is selected as the factory Overview.

Item-type links open filtered inventory; source-state links open Monitoring with the same device/gateway scope; process severity opens the incident queue; timeline events open their investigation. An optional item-telemetry section starts without a selected source. Explicit source, metric, evidence scope, period, item page and return context remain in the URL without narrowing the system totals. Historical windows retain their acquisition dates. Source observation states cover devices and gateways; registered item counts do not imply current physical connectivity.

Each workspace has a purposeful visual: equipment symbols in inventory, one selected source path in Monitoring, investigation timelines, a security collector coverage matrix and severity profile, signed Analytics comparisons, grounded Assistant evidence links, and one integration configuration map. Repeated symbols convey the same equipment kind. No extra charts repeat the same information merely to decorate a page.

An individual item's linked-model preview loads automatically when opened and has a reset action and an accessible component link. The full native workspace retains its detailed component identities, explosion/reassembly, sections, ghost housings, internal inspection, observations, saved views and security-to-component focus. The preview does not project parent readings onto components.

## Brand, motion and access

The sign-in page again uses its original industrial photograph and dark overlay. Theme-aware opaque form surfaces remain readable. The five uppercase sidebar labels share one 12px, medium-weight, normal-spacing, 16px-line-height style. Active colour/background changes preserve that typography; subtopic casing remains unchanged. Actual desktop and mobile drawer checks compare all five computed styles, including after changing the active destination.

Camera fitting, focus and saved-view restoration use a finite 300ms transition, cancelled by user input and completed without background animation when hidden or reduced motion is requested. Existing 360ms explosion choreography respects reduced motion. Charts use a finite transition, preserve missing buckets and show a point for a single populated bucket. Eligible newly received values receive one brief emphasis; workflow-state changes receive a short transition. Stale sources do not acquire looping activity or simulated motor rotation. Controlled render measurement waits for the camera to settle.

Existing authorization, evidence, unit, timestamp, publication and command boundaries remain in force. Demonstration screenshots use isolated fixtures. Configuration lines do not assert active delivery, source coverage does not certify security, illustrative geometry does not establish physical state, and firmware delivery remains disabled without a verified updater.

## Verification

The Overview regression suite covers full-scope mixed-item totals, linked-model deduplication, pagination beyond twelve items, reload/return context, source-filter isolation, loading failures and empty states. Additional synthetic browser contracts cover both directions of Demo/Live switching with a single reload, persistence, removal of legacy equipment filters, restricted-session explanations, explicit account switching, all gateway pages and independent/unconfigured items. Responsive journeys verify no model loads on the system Overview and automatic rendering still works after opening the relevant item. The historical evidence below records the earlier layout.

- Typecheck and production build pass.
- Sixteen inspection and camera unit checks pass, including exact final camera position, interruption, hidden-page completion and reduced motion.
- The complete 18-case rendered suite passed on clean `7410a5d`: five viewport widths (360/390/768/1024/1440), both themes, zoom-layout checks, graphical drill-downs and both native inspection recording paths.
- The final six graphical/inspection cases passed on clean `b865621`, adding actual Chromium touch dispatch, drawer tap, newest-reading fallback and visible single-bucket observations.
- Original native general workflows pass at desktop/tablet/mobile; detailed geometry and restoration pass at desktop and mobile. The new motion exposed a measurement race; disabling measurement until camera settlement fixed it while retaining the exact original draw-call/restoration assertions and deadlines.
- Four Overview before/after pairs, selected workspace screenshots and four short recordings are retained with hashes and source metadata.

The original zoom checks emulate the corresponding CSS layout and device scale, not physical browser-chrome zoom. Browser touch and software WebGL are emulated; physical mobile GPU performance remains a separate qualification. Hidden/reduced-motion behavior is covered by bounded software checks rather than a claim about every deployed browser. An actual Onesa consumer and hardware execution remain separate acceptance outcomes.

All existing quality gates, schema checks, native equipment/security and workspace suites remain required before promotion. The added CI job retains graphical navigation and recording evidence. Source/image/runtime release identity is reported separately by the existing release contract.
