# Unified workspace qualification — 26 October 2026

This release builds on the merged independent equipment and cybersecurity implementation, without dropping their commits or requiring Onesa. The [workspace guide](unified-workspace.md) describes the final navigation, typed inventory, contextual sections, registration, observation policy, permissions and compatible routes. The release is reviewed in [frontend PR 5](https://github.com/DruHustle/smart-factory-frontend/pull/5).

## Qualified sources

- Final UI source: `b4273fdeb1152a3e0cc2bbdf95de5b1a3fec1026`. Application/general/equipment/security regression source is `ea80e18f1c74c3fa16fa066d87c784b99ad50a25`; the final change replaces the misleading capability fallback “Standalone device” with “No AAS / 3D”. Workspace journeys, captures and build were rerun after that copy change. Subsequent evidence-only commits do not change application behavior.
- Node runtime source: `9deb56f2f366ee46ce8849a217a169f5bbba41e1`. Later changes affect only client layout/copy and the mobile browser assertion; `server`, `shared`, `drizzle` and the package contract are identical.
- .NET source: `905ef8ebb9a13090bab9288a8fd8677e1373fe8d`, preserved in backend main merge `b10e6391d239d7f3db534da097362435f6fbd790`.
- Edge source: `b63c2ad351b1da22a1c590dc1df9d9445ddc5afe`, preserved in edge master merge `1722f197c47a46371af76e778267d16ac477abd1`. This redesign requires no physical firmware or collector rollout.

The implementation includes focused fixes found during verification: nullable gateway identity on the actual .NET direct-device wire payload; selected imported-model binding metadata; shared observed connectivity; hash-query preservation and typed-reference decoding; retained selected-result focus; mode-scoped finding details; explicit trusted targets for versioned authored demonstration evidence; and readable mobile search sizing. Existing v1 demonstration evidence stays immutable. New v2 demonstration evidence is explicitly simulated/replayed and is loaded only by an authorized setup action.

## Local acceptance

All browser records, registration writes, imports, demonstrations and collector probes use guarded local fixtures and disposable PostgreSQL/Redis. Production UI records are not used as fixtures. No firmware delivery, gateway configuration publication or physical motion is issued.

| Check | Result |
| --- | --- |
| `pnpm check` | Passed |
| `pnpm test` (also run by `pnpm e2e`) | 38 files, 347 tests passed |
| `pnpm e2e` | 26 general browser tests passed; 22 tests belong to separate optional/focused runners |
| `SECURITY_ENABLED=false pnpm e2e:equipment` | 5 passed; public-demo test intentionally excluded by the private standalone fixture |
| `pnpm e2e:security` with the local edge checkout and Python | 7 passed, including the actual collector outage/reopen probe |
| `pnpm e2e:workspace` | 8 passed |
| `pnpm build` | Passed; emits `release.json` with its source revision |
| Equipment schemas and Onesa contract snapshots | Passed |
| Documentation and deployment checks | Passed |
| `pnpm audit --audit-level=moderate` | No known vulnerabilities |
| Final ARM64 combined-image acceptance | All 9 checks passed |
| Final image vulnerability/secret audit | 0 high/critical vulnerabilities; 0 secret findings |

The focused journeys cover direct registration and ingestion without an AAS/gateway, multiple children and asset links, imported AAS without samples, asset-linked versus independent equipment, configured/offline/stale/never-observed states, viewer API denial, relevant sections, service errors versus valid empty results, legacy deep links, reload, Back/Forward, selected-result focus, evidence-mode summaries/details/exports, mapped 3D navigation and optional-service independence. Existing safe-control tests retain their interlocks and send only to their local mock.

General-suite skips are runner boundaries rather than waived failures: native equipment (5), private optional Onesa journeys (2), security (7), and unified workspace (8). Native and security/workspace runners run separately as shown above. General tests include the public equipment demonstration, public passport, imports, role permissions, notification workflows and existing page accessibility checks. Private external Onesa consumer acceptance and physical-device operation remain separate commissioning activities.

## Rendered evidence

The [evidence directory](evidence/workspace-20261026/) contains actual Chromium renders and a machine-readable qualification manifest. Inventory was inspected in both actual themes at 360, 390, 768 and 1440 CSS pixels. Additional AAS, security and WebGL equipment screens cover 390px dark and 1440px light. Captures wait for loaded records, settled theme and the renderer's ready state. Checks cover page overflow, meaningful search-field width, mobile drawer dismissal/focus, keyboard navigation and controls; raw identifiers remain copyable.

- [360px light inventory](evidence/workspace-20261026/inventory-light-360.png)
- [1440px dark inventory](evidence/workspace-20261026/inventory-dark-1440.png)
- [390px imported AAS](evidence/workspace-20261026/aas-dark-390.png)
- [390px security](evidence/workspace-20261026/security-dark-390.png)
- [1440px equipment](evidence/workspace-20261026/equipment-light-1440.png)
- [Inventory service error](evidence/workspace-20261026/inventory-error.png)

The bundled pump/motor remains illustrative revision 4 (`cb1d547822ae954d698ae330ee6d2083fa966f6af3aec889c4605c1305d29712`, 6,421,020 bytes, 186,236 triangles, 87 selectable entries). No geometry or existing component identity was regenerated. Physical mobile-device performance and externally owned consumer acceptance are not inferred from software-rendered Chromium tests.

## Runtime deployment and hosted identity

The qualified API image is `smart-factory-backend:workspace-9deb56f-905ef8e` (Node 22.23.4, .NET 8.0.33):

- OCI index: `sha256:193b7a8d5b60858b3c45dd14f81f1763f6f2d5af75da11ecb5f4ef577878a772`
- ARM64 manifest: `sha256:7a1ad512e8dd966b1cee9b169434b50d92f877a7b6665b2036192c0de3622309`
- Transferred archive SHA-256: `45c971282e203b7741f98ab666d5c0834ab0145c1281c9102248819ee0b0f1d0`

The archive hash was compared on Oracle before loading. The guarded deployment completed with exit 0 at `/opt/smart-factory-backend/releases/workspace-qualified-20261026`. It stopped the old worker first, replaced only the image selection, waited for API readiness, then started exactly one worker. Existing environment files, managed services, MQTT identity and demo-data-off setting were preserved. All four API processes and both worker processes were RUNNING; API and worker readiness passed. An explicitly read-only transaction confirmed the additive inventory column, `demo_data_enabled=false`, two native security sources, nine active rules and ongoing live Node health evidence. The manifest records the timestamped proof without credentials or production record contents.

The Vercel production UI is released only after successful push CI on the exact current main commit. Both the main quality job and unified-workspace job gate that release. The final hosted source must equal the merged main SHA at [release.json](https://smart-factory-iot-app.vercel.app/release.json); API readiness is checked through both the public API and the Vercel rewrite. The PR's final release note records workflow URLs and the observed hosted SHA after deployment. Local populated screenshots do not claim those records exist in production.

The prior approved baseline remains Vercel main `979113eb336f79352c7b5754c38e62dd79e59a29` plus API image `smart-factory-backend:security-f1aa168-905ef8e`. Its owner-only image-selection backup is `/opt/smart-factory-backend/releases/workspace-20261026/environment.before.env`. Intermediate workspace images are not the approved baseline. Roll back UI/API together using the [Oracle procedure](../deploy/oracle/README.md); retain the additive migration and all evidence. The latest deployment also retains its immediate prior environment selection under its release directory.

Device credentials/topic ACLs still require commissioning; unsupported protocols are not advertised. Unknown cadence remains Unknown. Firmware delivery stays intentionally disabled, missing security coverage remains unassessed, and illustrative 3D does not assert measured physical state. These are preserved capability boundaries, not unfinished redesign work.
