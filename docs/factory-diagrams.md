# Factory floor, process and electrical views

The factory viewer offers **3D**, **Floor plan**, **Process / P&ID**, and **Electrical** representations of the same inventory. Select a view above the canvas. An equipment selection stays attached to its inventory reference when switching views, so its details, observations and item links remain consistent.

| View               | What it displays                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3D**             | The existing factory scene, equipment models and visual wire/pipe routes. Its held-drag pan and opt-in rotation controls are unchanged.                                                        |
| **Floor plan**     | A top-down drawing using the same factory placements, zones and equipment identities as the 3D floor. Existing equipment placement controls remain available when the user can edit the floor. |
| **Process / P&ID** | Process equipment, supplied process connections and instrument connections. Arrows appear only for a supplied direction.                                                                       |
| **Electrical**     | Supplied power circuits, control signals, protective-earth connections and communication cables, with terminal and cable information when provided.                                            |

Process and electrical drawings are schematics, not scaled floor layouts. They use selectable SVG symbols and paths and remain available without WebGL. They do not change equipment positions or the visual routing preferences of the 3D scene.

## Inspect a drawing

Select equipment to inspect the existing item details. Select a connection to see its type, source, destination, direction, terminal references, line or cable tag, and specification. Missing optional details are displayed as **Not supplied**.

Hold and drag the schematic to pan. Use its zoom controls or scroll to zoom, and **Fit whole factory floor** to return to the complete view. The zone selector filters the equipment shown. Connections whose endpoints are outside the current selection are omitted from the canvas, and their count is shown above it. The saved drawing is retained.

The same equipment can participate in both process and electrical drawings. A selected item without connections in the active drawing remains the selected inventory item; switching views does not invent a corresponding connection.

## Define connections

Open **Diagram connections** in the process or electrical view. Choose the connection type and both equipment endpoints, then supply a label. Optional fields are:

- **Flow direction**: not specified, from → to, to → from, or both directions.
- **From terminal** and **To terminal**: the endpoint references from the source drawing.
- **Line or cable tag**: the supplied designation.
- **Connection specification**: additional supplied drawing information.

Choose **Add connection**. Existing entries have **Edit** and **Remove** controls. These actions modify this local drawing only. They do not create operational connections, configure a PLC or device, change inventory, or write to the factory API.

Process drawings accept **Process pipe** and **Instrument connection**. Electrical drawings accept **Power circuit**, **Control signal**, **Protective earth**, and **Communication cable**. An acquisition record, MQTT subscription, gateway relationship or FX connection does not establish an electrical conductor or process pipe and is not converted into one.

## Import and export

**Export diagram JSON** downloads the active drawing as `factory-process-diagram.json` or `factory-electrical-diagram.json`. It includes the complete local drawing, including connections currently omitted by a zone filter or unavailable endpoint. The export contains inventory references, not a copy of the inventory or its live observations.

**Import diagram JSON** replaces the active view's drawing after validating the entire file. Export the current drawing first when you want to retain it. Import into the matching process or electrical view. Every connection must reference equipment currently available in that factory and data workspace. Unknown equipment, malformed files, duplicate identities and incompatible connection types are rejected without partially applying the file.

The import format is structured JSON. CAD files, PDFs, image files and raw SVG are not accepted by this importer.

### Version 1 format

This is a valid electrical document. The example references must be replaced with actual equipment references from the intended factory before import.

```json
{
  "version": 1,
  "mode": "electrical",
  "title": "Cabinet and motor wiring",
  "connections": [
    {
      "id": "cable-w12",
      "from": "asset:1",
      "to": "device:2",
      "kind": "power",
      "label": "Motor supply",
      "direction": "none",
      "fromTerminal": "X1:2",
      "toTerminal": "M1:U1",
      "designation": "W-12",
      "specification": "Use the specification supplied with the source drawing"
    }
  ]
}
```

| Field                        | Contract                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                    | Required; currently `1`.                                                                                                                                                                              |
| `mode`                       | Required; `process` or `electrical`, matching the open view.                                                                                                                                          |
| `title`                      | Required, nonempty single-line text, up to 160 characters.                                                                                                                                            |
| `connections`                | Required array, up to 500 entries. An empty array represents an intentionally empty drawing.                                                                                                          |
| `id`                         | Required unique connection ID, up to 128 characters. Starts with a letter or digit; remaining characters may also include `:`, `.`, `_`, and `-`.                                                     |
| `from`, `to`                 | Required distinct inventory references: `asset:<positive decimal ID>`, `device:<positive decimal ID>`, or `equipment:<UUID>`. Existing sandbox asset/device references also use positive decimal IDs. |
| `kind`                       | `process` or `instrument` for process drawings; `power`, `control`, `earth`, or `communication` for electrical drawings.                                                                              |
| `label`                      | Required, nonempty single-line text, up to 160 characters.                                                                                                                                            |
| `direction`                  | Required; `none`, `forward`, `reverse`, or `both`. Endpoint order alone does not establish direction.                                                                                                 |
| `fromTerminal`, `toTerminal` | Optional single-line text, up to 80 characters each.                                                                                                                                                  |
| `designation`                | Optional single-line text, up to 120 characters.                                                                                                                                                      |
| `specification`              | Optional single-line text, up to 240 characters.                                                                                                                                                      |

Files must be smaller than 1 MB. Unknown fields, unsupported versions and control characters are rejected. A repeated connection with the same type and terminal pair is rejected even if its endpoint order is reversed. Distinct terminal pairs permit multiple connections between the same equipment.

For a process document, set `mode` to `process` and use `process` or `instrument` connections. Include instrument details supplied by the drawing; a process-only document remains a process-flow representation.

## Data source and demo behavior

Without a saved local drawing, process views can show existing explicit process links whose endpoints are present in the current inventory. The current `FloorLink` contract has no commissioned direction or terminal fields, so those links receive no inferred arrows or terminal assignments. Electrical views start empty until electrical connections are supplied.

The authored factory demonstration includes illustrative process and electrical examples for known showcase equipment. It uses the exact showcase identifiers and requires demo evidence for each endpoint. It does not connect arbitrary equipment based on its name, mix live equipment into an example, or fabricate additional inventory records. The drawing is visibly labelled **Illustrative demo diagram**.

Changing a demo drawing creates a local drawing for that demo scope. It has the same editing and export behavior as other local studies and does not modify the shared demonstration backend.

## Persistence and scope

Local drawings are stored separately for each account, data workspace, factory/layout and drawing mode. Process and electrical changes do not overwrite one another. Named factories use their stable factory identity; personal layout studies use their stable study identity. Renaming a study retains its diagrams, and studies with the same name remain separate. This drawing scope does not change the existing scope of 3D routing preferences.

Drawings are not part of team-shared factory saves, factory layout JSON exports, or backend backups. Export the diagram separately to transfer it to another browser or retain a copy. Clearing browser site data removes these local drawings.

Unreadable stored drawings are retained, and the UI reports the problem. **Reset unreadable diagram** explicitly removes that unreadable entry and returns to the current source drawing. When browser storage is unavailable or full, the current drawing remains usable in memory and the UI reports that it could not be saved; export it before leaving the page.

Changes saved by another tab are observed by the drawing controller. If a connection changes while its edit form is open, the stale edit is rejected. An import also checks whether the drawing changed while the file was being read. Choose the latest connection or retry the import after inspecting the current drawing. Import/export and editing continue to use the account and factory scope in which the editor is open.

## Implementation and verification

`factory-diagrams.ts` defines the bounded document contract, source filtering and authored demo examples. `useFactoryDiagram.ts` owns local storage and imports. `FactoryDiagramEditor.tsx` supplies editing, import/export and connection details. `FactorySchematic.tsx` draws the 2D schematic in the existing `FactoryFloor` viewer.

`server/factory-diagrams.test.ts` verifies document validation, metadata round trips, duplicate handling, stable registered identities, source boundaries and endpoint filtering. Browser contracts exercise the shared viewer, local edits/imports, selection, view switching, persistence and responsive interaction.

See also [factory layouts](factory-layouts.md) and [3D wire and pipe routing](physical-connections-and-theme.md).
