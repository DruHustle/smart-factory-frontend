# Complete demonstration and data workspace selector

The v4 expansion adds 20 model-backed assets and 20 gateways, controllers, sensors and network devices across process utilities, assembly, packaging and network zones. Every native reference family is represented; existing evidence and original timestamps are retained.

The [editable demo](editable-demo.md) lets each visitor create and reset simulated equipment, telemetry, incidents and administrative workflows in their own browser. [Factory layouts](factory-layouts.md) can be designed, saved and reopened. The shared reference dataset remains protected.

The explicit showcase provides fifteen linked chapters through **Demo guide**. It uses authored simulation and historical replay; it never asserts that physical equipment is receiving or moving. The acquisition window stays fixed and is displayed on charts, so the demonstration remains useful without rewriting timestamps as time passes.

| Area                         | Demonstration                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole factory overview       | Every authorized item on a shared 3D floor or accessible plan, grouped by zone, with a complete inventory distribution and factory trend                 |
| FX / TSN                     | AutomationComponents and PubSub connections; clock offsets, jitter, latency, deadline misses; normal, late-delivery, clock-loss and recovery scenarios   |
| Inventory / connectivity     | Pump, motor, compressor, direct sensors, gateway children and a disconnected commissioning example; relationships are explicit                           |
| Telemetry / analytics        | Six canonical measurement types, original units and conversions, quality differences, replay and intentional missing buckets                             |
| Engineering                  | Authored AAS identities/submodels, recorded connections and a synthetic published passport with an explicit field allowlist                              |
| 3D                           | Linked and standalone workspaces, unchanged 87-component geometry, compatible measurement bindings, an inspection note and two saved viewpoints          |
| Raspberry Pi gateway         | Original 61-entry Pi 4 Model B reference, explicit demo gateway association, selectable parts, explosion, sections and two saved views                   |
| Process incidents            | Active, acknowledged and resolved examples, preserved evidence and readable history                                                                      |
| Cybersecurity                | Authored evidence streams and a finding explicitly mapped to an installed component; simulated coverage remains distinct from live collector health      |
| Notifications                | Owner-scoped demo inbox rows with `demo_only` delivery state; no external email request                                                                  |
| Firmware                     | Approved synthetic catalog and unconfirmed rollout example; binaries and OTA delivery remain unavailable                                                 |
| Administration               | Read-only role descriptions, integration examples, workspace policy and authored audit history; private accounts/settings remain protected               |
| Assistant / external actions | Grounded local guidance and evidence links; external consumer acceptance, physical controls and remote delivery retain their commissioning prerequisites |

## Demo / Live data switch

The shell exposes one compact selector on desktop and mobile. An individual account can select **Demo data** for approved fixtures or **Live data** for operational records. Changing the view first verifies that the browser saved the preference, removes previous item/3D filters, then performs one full reload to clear the previous view's in-memory cache and item context. A rejected cookie produces an actionable error. The non-sensitive cookie is a view preference; it grants no authority. The server enforces the selected data scope, and demo viewing denies mutations and private administration/file routes. Shared demo identities and public-demo deployments always remain in the demonstration scope, even if a client forges a `live` preference. The Overview visibly explains their restricted session. **About demo and live data** beside the selector explains the individual-account requirement and offers an explicit sign-out action for switching accounts.

Before an individual chooses a scope, “Workspace data” retains the existing deployment visibility policy. Selecting Demo or Live establishes an explicit scope for that browser.

The selector never changes the persisted deployment-wide visibility setting, seeds records, commands equipment or requests email. An existing private administrator's separate deployment setting remains available for compatibility.

## Explicit installation

The ordinary test seeder retains its disposable localhost `_e2e` guard. Full catalog tests opt in with `SHOWCASE_COMPLETE=true`. Application startup and viewing do not install or refresh the scenario.

The runtime image includes `scripts/showcase/install.mjs`. A deployment operator first runs it with `--plan` and, after reviewing the output, uses `--apply`, supplying `SHOWCASE_INSTALL_APPROVED=read-only-showcase-v4` only to that invocation. It requires an explicitly public-demo deployment, an existing demonstration owner and the notification isolation migration. It refuses reserved identities that collide with operational records, retains an install claim for review after partial failure, and preserves the original scenario time and evidence on repeat runs. It does not alter account passwords/roles or the global demo visibility setting. Production backup and rollout records remain in the protected operator evidence.

Migration `0029_demo_notification_isolation` prevents demo and simulated/replay process incidents from entering the normal email queue. Read-only demo inbox records are explicitly authored for their owners, scoped to demo sources, and never eligible for retry. Private-source notifications stay hidden even when a row belongs to a shared identity and carries a demonstration label.

## Acceptance

The focused fixture verifier checks idempotence, the fifteen chapters, exact component count, bound measurements, incident states, security association, zero current-connectivity claims, zero queued demo email and rejection of a colliding operational identity. Browser acceptance checks all four shared roles, forged Live preference, mobile/desktop journeys, private-source inbox isolation, recorded windows, the public synthetic passport and disabled OTA. Existing individual editing, registration, incident and publication workflows continue to run in the disposable private acceptance suite. The packaged ARM64 acceptance also checks repeat installation against the real runtime image.

Hardware execution, actual email delivery, firmware installation and an external Onesa consumer remain separate commissioning outcomes. The demonstration explains those boundaries instead of fabricating success.
