# Native 3D delivery and loading

## Released factory floor graphics and interaction

The whole-factory floor preserves the bundled GLBs' original material groups rather than flattening all parts to one material. Steel, painted surfaces, glass and rubber use their corresponding finishes; studio reflections, floor texture, contact shadows and adaptive shadow quality improve depth and equipment separation. Reference footprints and the surrounding warehouse remain illustrative. The [30 October production gallery](evidence/release-20261030/README.md) shows the released light/dark/mobile floor and an equipment close view.

Items and empty floor use direct hand grabbing. Compact labelled icons fit the scene, switch 3D/plan and enter fullscreen; the scene and placement stay mounted across fullscreen changes. Model downloads begin automatically and immediate proxies keep the complete inventory represented while loading. A usable plan replaces unavailable WebGL. See [layout controls and persistence](factory-layouts.md) and [visual workspace boundaries](visual-first-workspaces.md).

## Studio rendering and first image

The viewer uses a prefiltered HDR studio atlas rather than rebuilding reflection lighting for every viewer. The 396,143-byte public asset contains the pinned Three.js CubeUV roughness levels as linear RGBA16F data. Its decoded public pixels can be reused across viewers; each viewer owns and disposes its GPU texture. Failed asset delivery or an unsupported native gzip decoder uses direct lighting so inspection can continue without runtime environment generation. Private model delivery still uses the authorized same-origin route with no-store responses.

Native reference paint now behaves as an opaque dielectric coating. Warm key and cool fill lighting separate metal surfaces, and shadow framing follows model size, including small boards. A small ambient contact patch provides grounding on mobile and software renderers. Uploaded materials keep their authored PBR properties. These changes preserve the original geometry, component IDs, sections and explosion choreography.

All seven bundled reference revisions have small light/dark WebP previews rendered from the actual models. They appear during renderer-code and GLB preparation and are explicitly labelled as previews. The interactive canvas takes over after its first model draw. Unknown or uploaded revisions receive no unrelated reference image. Hover or keyboard focus on a 3D inspection entry begins code, public lighting and authorized metadata preparation; it does not download a private GLB or create a graphics context.

Run `node scripts/equipment/qualify-rendering.mjs` after installing the project's Chromium to check all seven models on desktop/mobile in both themes, explosion/restoration, hollow sections, gallery switching and component selection with one active canvas, a preview with deliberately held GLB delivery and a missing-lighting fallback. The isolated fixture binds loopback and uses only checked-in public models; it does not require a database or an account. Gallery checks use local fixture responses; authenticated reference-file authorization has a separate HTTP test. `CHROMIUM_EXECUTABLE_PATH` can select an installed test browser. `node scripts/equipment/bake-studio.mjs` reproduces the HDR asset with the pinned Three version.

The preview stays visible until a model draw has completed on the GPU and reached its following presentation frame. `firstDrawSubmitted` records command submission separately from interactive-ready `firstFrame`. In the final local software-GPU run, the pump completed in roughly 0.35–0.75 seconds from viewer mount and the other references in 0.25–0.38 seconds. These fixture timings exclude application navigation and remote API/network time. They are not a hosted load-time guarantee; a hosted comparison remains pending release. See the [screenshots and bounded qualification record](evidence/factory-models/README.md).

A 3D workspace needs authorized item metadata, equipment/component mappings, viewer code, model delivery, geometry preparation, graphics compilation and a first model frame. The pump is 6,421,020 decoded bytes / 186,236 triangles. Its existing geometry, detailed parts and stable IDs are preserved. The additional [Raspberry Pi reference](../fixtures/equipment/raspberry-pi-4b/README.md) is 288,440 bytes / 5,406 triangles.

## Changes

Opening the 3D section starts the equipment and renderer code in parallel with item metadata. Once the item is authorized, equipment metadata is prefetched while code loads. Read-only inspection does not load model import, replacement or mapping form code. Linked previews in item details and the Assistant load automatically when shown, starting authorized equipment metadata and shared renderer code in parallel. The system Overview summarizes the complete inventory and does not select or load an individual model. Loading indicators remain visible until the actual model is ready; no separate load button is required. The factory model catalogue and full inspection also load their selected models automatically.

File delivery checks the authenticated session, current visibility, workspace identity and parent asset scope directly. It no longer computes telemetry/history a second time for a model request. The model hash, scene/resource budgets, external-URI rejection and private/no-store response policy remain in force. No browser cache of private GLB bytes or reduced-detail mesh replaces the original model.

The viewer starts authenticated delivery alongside lighting setup and avoids drawing an empty scene before the model is prepared. Its loading status distinguishes download, geometry preparation, graphics preparation and drawing. A compressed Content-Length is never used as the decoded-byte percentage. Ready is reported after a real model render. Per-load phase timestamps are available on the renderer element for bounded diagnostics.

Small models use a suitable initial view and proportionate observation markers. The Raspberry Pi example has no default sensor data, active LEDs, maintenance text or generic pump simulation. Models without configured measurements reject the stock simulation workflow.

## Verification

The equipment suite verifies mappings, bounded GLB bytes, closed section geometry, separate component identities, scope checks and refusal of invented observations. Browser checks exercise four Raspberry Pi desktop/mobile and light/dark combinations, keyboard explosion/reassembly, ghost housings, sections and a real first frame. A gated item response verifies that viewer code loads in parallel while GLB delivery still waits for authorization. The original detailed pump inspection and rendering benchmark remains a separate regression gate.

The version-3 showcase adds the Pi as a thirteenth chapter. Installation is additive, retains the existing acquisition anchor/evidence and gateway identity, remains read-only to shared accounts and does not queue email or assert physical connectivity. See the [demo installation procedure](complete-demonstration.md).

A [hosted baseline](evidence/raspberry-pi/loading-baseline.json) measured the existing pump workspace at 6,012 ms on a cold visit and 2,513 ms on a repeat visit using Chromium SwiftShader. The GLB download itself took 985 ms and 852 ms in those two observations. These are separate from graphics preparation and navigation/code/API time; network conditions vary. A new hosted comparison remains a release acceptance step.

Linux headless Chromium also exposed an overdue software-renderer fence query after drawing. Normal waits remain nonblocking and explicitly flush status-query commands. For a detected software driver whose query is still pending after 500 ms, the viewer drains its single outstanding GPU frame before drawing again. This exceptional recovery may block until actual completion; it does not discard geometry or pretend that the frame completed. Hardware and unidentified drivers retain nonblocking polling. Context loss and failed synchronization produce an error rather than a successful frame.

On-demand drawing normally uses animation-frame callbacks and has a 100 ms watchdog for a visible viewer when the compositor delays a callback. Both paths coalesce into one actual draw. Hidden pages submit no GPU work, visibility restoration requests a redraw, and pending callbacks are cancelled on disposal. There is no idle drawing timer. Active-orbit measurements stop if the page becomes hidden and count actual rendered frames, including scheduling and synchronization time.

Renderer diagnostics include software synchronization duration. Renderer diagnostics and the active-orbit benchmark report the number of exceptional drains. Benchmark elapsed time includes every wait and drain; existing completed-frame, duration and interaction acceptance checks remain unchanged.

See the [actual application screenshots and recordings](evidence/raspberry-pi/README.md).
