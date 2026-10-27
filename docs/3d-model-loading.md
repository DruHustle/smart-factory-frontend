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

See the [actual application screenshots and recordings](evidence/raspberry-pi/README.md).
