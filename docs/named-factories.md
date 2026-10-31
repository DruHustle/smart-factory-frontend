# Create and maintain a named factory

Use the **Active factory** picker on Overview or Assets & devices. The plus icon beside the picker creates a factory with a name, width and depth in metres. Individual accounts share named factories with the installation's team. Viewer and Operator can inspect; Engineer and Admin can create factories, add inventory and save layout changes. Deleting canonical inventory requires Admin.

The default **All inventory** view remains available. In the demo it is called **Reference installation**. Each named factory has its own floor, sections, inventory and activity. An item belongs to one factory, while its existing platform identity and detailed workspace remain authoritative.

## Build the physical floor

1. Create a factory with the actual floor width and depth.
2. Open the floor's plus icon. Choose a pump, conveyor, robot, tank, cabinet, valve, warehouse rack, loading door, exit door, sensor, gateway or another item. Enter its name, factory tag and physical width, depth and height. A new item creates a planned, unconfigured inventory record immediately. Alternatively choose **Existing inventory** and search its paged unassigned records.
3. Grab an item's visible geometry to position it. Nearby empty space pans the view. Move the mouse without pressing to rotate; right-drag or Shift-drag also rotates, and scrolling/pinching zooms. Space pans over equipment. Escape cancels a grab. Arrow keys make small adjustments to selected equipment.
4. Select an item from the inventory list to enter precise X/Z coordinates, rotation, dimensions and section in the editor. Coordinates are measured from the floor centre. The full rotated footprint must stay inside the floor. Factory tags must be unique within their factory; a different factory may use the same local tag.
5. Use the settings icon to rename the factory, resize it or define receiving, warehouse, production and dispatch sections. Section coordinates mark their lower corner. Doors and racks are movable inventory items, rather than automatically fixed props in a custom floor.
6. **Save layout** publishes the draft to the team. A stale version is rejected and the browser draft is retained. Download the draft before explicitly loading a teammate's newer save. Inventory additions and confirmed deletions take effect immediately; layout placement edits use Save.

Use the fullscreen icon to expand the live floor and its editor. Escape or Exit fullscreen returns. When WebGL is unavailable, the accessible floor plan retains selection, dragging, panning, keyboard placement and the same inventory actions. The model geometry is a type reference scaled to the entered dimensions; it is not a surveyed CAD model, verified plant condition or a command that physically moves machinery.

## Remove equipment

Grab equipment and drop it on the bin, or select it and use the bin icon. Review the item and factory in the confirmation dialog. **Keep item** preserves its inventory and original placement. **Delete inventory item** removes its canonical record and its factory placement; inventory lists update together. A connected device must first be disconnected from its linked assets. Registered assets follow the existing AAS and gateway configuration cleanup. Historical activity remains available.

## See who changed what

The clock/history icon opens **Activity** for the current factory. It records factory creation/renaming, floor dimensions and sections, inventory creation/attachment/update/deletion, measured placement/tag changes, connections, thresholds, incident status/assignment, equipment model revisions/scenarios, and passport publication/revocation. Each entry shows the server timestamp and authenticated actor's name, role and identity. Background changes are labelled System. Expand **View changes** for the safe before/after projection; load earlier entries to browse beyond the first fifty.

The database records these events in the transaction that changes the rows. Existing entries cannot be edited or deleted through the application, and database triggers reject ordinary row updates/deletions. Database owner administration is not a cryptographically tamper-proof archive. No retention purge is configured in this release. Connection values, credentials, full AAS/passport documents, model payloads and free-text secrets are excluded. Unchanged acquisition timestamps, camera movements and unsaved browser drafts are not published factory changes. Other platform domains retain their existing incident/security/account histories.

## Editable demonstration

Shared demo identities use the same factory controls in a browser-local, resettable sandbox. Switch **Factory demo role** to experience the actual role boundaries. History identifies the simulated role and is clearly labelled as browser simulation. No factory/inventory API writes are made to shared demo records. Demo backup and reset are available from the banner's link.

The v2 demo storage format preserves and imports existing v1 demo data without replacing its old storage key. JSON backup/import and reset include named factories, inventory and history. Reset clears the demo factories/history and starts a new isolated workspace. An invalid stored workspace is retained for recovery; a browser storage failure offers download rather than silently discarding in-memory changes. A different browser has a separate demo. Individual account factories remain server-persisted and team-shared.
