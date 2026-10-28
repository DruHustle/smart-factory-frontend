# Native 3D delivery and loading

A 3D workspace needs authorized item metadata, equipment/component mappings, viewer code, model delivery, geometry preparation, graphics compilation and a first model frame. The pump is 6,421,020 decoded bytes / 186,236 triangles. Its existing geometry, detailed parts and stable IDs are preserved. The additional [Raspberry Pi reference](../fixtures/equipment/raspberry-pi-4b/README.md) is 288,440 bytes / 5,406 triangles.

## Changes

Opening the 3D section starts the equipment and renderer code in parallel with item metadata. Once the item is authorized, equipment metadata is prefetched while code loads. Read-only inspection does not load model import, replacement or mapping form code. Overview previews continue to load 3D only on explicit demand.

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
