# Engineering drawings: DXF and PDF

Factory **Process / P&ID** and **Electrical** views can export editable CAD sheets and matching vector PDF sheets. These are schematic engineering drafts for review. Generic symbols do not assert ISA/IEC certification, surveyed dimensions, a verified installation, or approval for construction.

## Create and export

1. Open the intended data workspace and named factory, then choose **Process / P&ID** or **Electrical**.
2. Expand **Diagram connections**. Add or edit the documented connections, including their equipment references, line/cable designation, source and destination terminals, direction and specification. Expand **Engineering specifications** for the applicable process or electrical fields. Inventory alone does not establish wiring or pipework.
3. Expand **Engineering sheets · DXF & PDF**. Enter the drawing title, project, drawing number, revision, preparer, checker, date, sheet prefix and purpose. Choose **Save sheet details**. These fields share the existing drawing's browser-local factory, data-workspace and diagram-mode scope. They do not update operational connectivity or grant additional permissions.
4. Review the validation list. Missing values remain **NOT SUPPLIED** in the drawing schedule and produce an incomplete draft. An unavailable endpoint, duplicate equipment tag, invalid date or ambiguous supplied engineering quantity must be corrected. Supply quantities with units, such as `24V`, `400 V AC`, `0.4kV`, `10 bar(g)` or `80 °C`.
5. Choose **Export editable DXF** to download the file. Choose **Preview / save PDF**, then **Print / save as PDF** in the preview and select the browser's PDF destination. Use A3 landscape, actual size, zero margins, and disable browser headers and footers. The preview specifies these page settings; print-dialog overrides can change them.

Exports include the **full saved drawing**, including connections outside the currently selected zone. Unsaved sheet edits must be saved or reloaded first. If another tab changes the drawing while sheet details are being edited, export and save are blocked until **Reload sheet details** is selected; this prevents silently overwriting the newer document.

## Drawing contents and CAD editing

- The DXF is AutoCAD 2007 format (`AC1021`), with drawing units set to millimetres. Sheets are A3 landscape model-space frames, placed 450 mm apart along X, starting at X=0. Each frame is 420 × 297 mm. Plot a single frame at 1:1 on A3; geometry inside it is schematic and labelled **NTS**.
- Editable `INSERT` equipment blocks contain `TAG`, `REF`, `NAME` and `TYPE` attributes. Linework, terminal markers and text are CAD entities, not embedded screenshots. Separate `SF_*` layers distinguish equipment, tags, terminals, process, instrument, power, control, earth, communication, notes and sheet frames, with plotting weights and line patterns.
- Topology overviews contain at most four connections per sheet. Equipment can repeat on continuation sheets with the same identity. Off-sheet references identify the exact corresponding sheet. Crossing lines do not create a junction. Connection detail sheets contain each supplied connection exactly once with its terminal assignments and direction; shared cable designations remain valid for separately identified conductors.
- Complete equipment and connection schedules retain all supplied values. Display labels ending `...` are abbreviated to keep text at least 2.5 mm high; their full values appear in the schedule. Long schedules continue on additional sheets. PDF and DXF use the same sheet geometry and labels.
- Missing fields, draft/review status, revision, sheet identity and source scope are explicit. Any demo/simulated equipment stamps the output **ILLUSTRATIVE DEMO — NOT FOR CONSTRUCTION**. A complete form is not an engineering approval.

The app does not import CAD edits back from DXF or PDF. Retain the source diagram JSON alongside exported drawings. Engineering review must confirm the actual installation, terminal assignments, protection, ratings, line class, applicable standards and revision approval before operational use.

## Backup and frontend rollback

Use **Export diagram JSON** in the current application's **Diagram connections** section before changing browsers, clearing browser storage or rolling back the frontend. This is the editable source backup, including sheet metadata and engineering specifications. Export process and electrical documents separately for every relevant factory/workspace. Import into the same matching inventory scope using the current version of the app.

The extended documents remain readable by this version but contain fields that older clients' strict version-1 schema rejects. An older frontend retains the raw browser storage and blocks editing; it does **not** transparently display the current engineering document. Its JSON export may serialize its fallback drawing, so it is not a recovery backup. Do not choose **Reset unreadable diagram** or clear storage to resolve that version mismatch. Restore this frontend version and export the preserved document, or restore the JSON backup into a compatible version. A backend rollback with the current frontend does not introduce this local drawing schema mismatch.

## Verification

Run from the frontend repository using its pinned Node version:

```sh
pnpm check
pnpm exec vitest run server/engineering-drawing.test.ts server/factory-diagrams.test.ts
pnpm exec playwright test --config playwright.cad.config.ts
node --import tsx scripts/engineering/export-fixtures.ts test-results/engineering-fixtures
node --import tsx scripts/engineering/export-complex.ts test-results/engineering-complex
node scripts/engineering/qualify-files.mjs test-results/engineering-fixtures
node scripts/engineering/qualify-files.mjs test-results/engineering-complex
```

`scripts/engineering/verify-dxf.py <fixture-directory>` independently audits, re-saves and renders DXF through `ezdxf`, then checks the PDF page sizes, vector content and retained text with `pypdf`. Verification-only dependencies used for the qualification are `ezdxf==1.4.3`, `matplotlib==3.10.8` and `pypdf==6.1.3`; Python is not an application runtime dependency. Render PDFs with Poppler and visually inspect the topology, terminal details, schedules, title blocks and long-label continuation sheets. Browser tests exercise actual DXF downloads, PDF previews, typed multiword metadata, persistence and concurrent-edit protection at desktop and mobile widths.

For a fresh verification environment, install Python 3.11 and Poppler, set the actual canonical workspace path, and run:

```sh
workspace="/absolute/path/to/smart-factory"
python3.11 -m venv "$workspace/locals-tools/release-tools/cad-verification-python311"
cad_python="$workspace/locals-tools/release-tools/cad-verification-python311/bin/python"
"$cad_python" -m pip install 'ezdxf==1.4.3' 'matplotlib==3.10.8' 'pypdf==6.1.3'
"$cad_python" scripts/engineering/verify-dxf.py test-results/engineering-fixtures
"$cad_python" scripts/engineering/verify-dxf.py test-results/engineering-complex
pdftoppm -png -r 120 test-results/engineering-fixtures/process.pdf test-results/engineering-fixtures/process-pdf
pdftoppm -png -r 120 test-results/engineering-fixtures/electrical.pdf test-results/engineering-fixtures/electrical-pdf
```

The workspace qualification reused `locals-tools/release-tools/frontend-review-python311` with these exact package versions. `scripts/engineering/verify-browser-exports.py <CAD_EVIDENCE_DIR>` independently audits the four files downloaded by the browser tests and their PDF previews. Set `CAD_EVIDENCE_DIR` to an absolute evidence directory when invoking Playwright; otherwise the exports are saved to `test-results/cad-exports`.
