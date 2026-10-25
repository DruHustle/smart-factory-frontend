# Independent equipment monitoring

Smart Factory owns the native renderer, local models, component/tag schemas, API validation, storage, auth, fixtures and release workflow. No Onesa repository, service, registry, SDK, tarball or account is required. Optional exchange is separate. Third-party rendering dependencies are pinned to `three@0.186.1` and `@types/three@0.186.0`; the existing React 19/Vite application loads the renderer on demand.

## Install and start

Use the repository's Node 22 / pnpm 10.34.5 lockfile, PostgreSQL and Redis setup. From this frontend repository alone:

```sh
pnpm install --frozen-lockfile
# Configure DATABASE_URL, DATABASE_SSL_MODE, REDIS_URL, JWT_SECRET and PORT
# using .env.local.example and existing auth/deployment instructions.
pnpm db:migrate
pnpm dev
```

Keep every `ONESA_*` variable absent or set only `ONESA_ENABLED=false`. Native equipment setup/rendering never discovers or calls a peer API. For public viewing, use existing explicitly enabled demo accounts and demo data. They can view two read-only locally seeded pump/motor instances. Deployments enabling shared demo accounts expose only demo equipment through these APIs and cannot import, create or mutate private equipment, even through an individually named account. Private setup, imports, scenarios and saved work require an individual engineer/admin account. On a new private installation, use the existing `scripts/bootstrap-admin.ts` with temporary private `BOOTSTRAP_ADMIN_*` variables, then manage individual accounts through User Access. Do not use shared demo accounts for private integration.

Open **Equipment view**. Create a simulated or real instance and select the bundled local template or an imported local model. Real instances start with unavailable readings. To visualize an existing acquisition asset, select its exact immutable asset identity and explicitly declare source/component/metric units. The app reuses `sensor_readings`; it creates no PLC subscriptions or pollers. Geometry replacement does not rewrite acquisition bindings.

## Model formats, identity and storage

The app-owned fixture is `smart-factory-illustrative-pump-motor-3`, with a self-authored GLB, explicit per-revision scene mapping, technical/maintenance reference and MIT provenance in `fixtures/equipment`. Revisions 1 and 2 are retained for already installed equipment. All revisions are bundled into server images. Template component UUIDs are reusable; installed component UUIDs belong to one equipment UUID. An AAS/external asset identifier remains distinct. Renaming an asset, reloading, reconnecting or replacing geometry does not regenerate those identities.

Import uses a self-contained static GLB plus `smart-factory-model-1` JSON mapping manifest. The form provides an app-owned example. Declare rights/provenance, metres, right-handed coordinates and +Y up. GLB transforms preserve model coordinates. Bindings explicitly declare supported metric meaning, source unit, display unit and expected interval. Pa → bar is an explicit recorded conversion; velocity/acceleration substitutions are rejected. No implicit nearest-name matching is used.

The upload envelope contains a four-byte little-endian manifest length, up to 128 KiB UTF-8 manifest JSON, then the GLB (`application/vnd.smart-factory.model+octet-stream`). The legacy small base64 mapping header is also accepted. No archive is unpacked.

Budgets: 20 MiB/file, 2 simultaneous imports, 100 stored packages / 256 MiB, 2,000 scene nodes, 1,000 meshes, 128 materials, 128 mapped components, 250,000 rendered triangles, 1,000,000 admitted vertices and bounded hierarchy depth. External/embedded resource URIs, embedded textures/images, skins, animation and required compression/extensions are unsupported by this static import path. These unsupported inputs fail locally; no URL is fetched. Archive/XML import is not added; existing AASX import protections remain in their current backend.

Imported GLBs and manifests are validated owned copies in PostgreSQL. Package IDs derive from bytes and validated metadata; they are immutable. Replacements require a preview and matching revision token with optimistic concurrency. Every stable template component must map explicitly in the new revision. Ambiguous/remapped component sets fail for engineering review. Installed IDs, source bindings, notes, viewpoints and history survive valid replacement. Documents are authorized app-owned text; imported packages without a document show that state explicitly.

Additive migrations `0018`–`0021` add provenance/outbox and local equipment/model/work tables. Use existing `pnpm db:migrate` before rollout. Back up the application database as usual. No peer database is accessed. Models persist across restarts in bundled files or the application DB; a browser cache is unnecessary.

## Monitoring and interactions

The browser renderer provides GLB progress/errors, orbit/pan/zoom, fit/reset, scene picking synchronized with component buttons, focus/highlight, hide/show/isolate, transparency, source-state markers and annotation markers. Notes, selection, camera and inspection viewpoints persist with optimistic versions. A keyboard-operable component list and textual measurements/history/documents remain available if WebGL is unsupported or lost. Home fits the camera; OrbitControls supply pointer/touch navigation. Pixel ratio is reduced on mobile, rendering occurs on demand, telemetry refreshes at most every five seconds, and navigation/model replacement disposes controls, geometry, materials, textures and the WebGL context.

Quality, freshness and mode are separate. Missing values remain unavailable. Freshness uses observation time, never a retry/receipt timestamp. Legacy source quality/mode remain unknown unless explicitly declared. Live and simulated stream selection is explicit. Local normal/alarm/recovery/stale scenarios use the existing ingestion function and preserve `mode=simulated`; source alarms are identifiable and never become live incidents. Recorded history replay is a local viewing operation that changes neither current/live state nor incidents. A real MQTT transport carrying generated data remains simulated.

Marker colors show declared source alarm, freshness or annotation state; they do not predict failure. Geometry is illustrative, not dimensional CAD, numerical physics, validated robot collision geometry or kinematics. The detailed reference includes authored 0–100% whole/subassembly explosion, reversible transitions, guides, selected-part labels, X/Y/Z sections with reverse/position/reset, housing ghosting and cover hiding. Saved viewpoints include reveal state, selection and camera. Added model components receive new installed identities only after replacement preview; existing component identities and source bindings remain stable. Imported models expose authored explosion and solid-cap capabilities only when declared; missing internals are not generated.

Sections intersect closed geometry and triangulate contours with holes separately for each connected solid. Open/ambiguous contours remain uncapped; the renderer does not fill their empty volume. Caps are rebuilt after motion settles and bounded slider debounce. Explosion offsets/rotations/pivots are illustration choreography, not an approved disassembly procedure. See [the source and BOM audit](equipment-reference.md) for design scope and acceptance limits.

## Verification and operation

```sh
pnpm check
pnpm test
pnpm build
pnpm equipment:schemas:check
pnpm e2e:equipment
```

`e2e:equipment` creates disposable loopback PostgreSQL/Redis, clears all Onesa variables, uses only this repository, provisions a synthetic individual account, and starts the actual app. Fresh browser contexts block every external domain and record attempted requests. Headless Chromium uses explicit software WebGL. Tests cover desktop/tablet/mobile native rendering, controls, simulation, documents, notes/viewpoints after reload, light/dark styling, replay and actual context-loss recovery. Existing optional Vercel analytics attempts are recorded and blocked; they are not required for operation. Real mobile hardware/Safari and real equipment qualification remain separate from emulated viewport/software-WebGL evidence.

Optional exchange configuration/outbox semantics, deterministic MQTT walkthrough and consumer gaps are documented in [the connector runbook](onesa/OPERATIONS.md). Peer failure must affect only that connector. App readiness depends on its own database/Redis, not optional export. To roll back, disable optional export and redeploy the previous reviewed images; additive tables/columns and owned data can remain. Preserve model revisions and database backups. Do not drop new tables or rewrite migration history as a rollback shortcut.
