import { useEffect, useState } from "react";
import type { InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { openReportPreview } from "@/lib/report-preview";
import type { useFactoryDiagram } from "./useFactoryDiagram";
import {
  buildEngineeringDrawing,
  drawingIssues,
  drawingPrintHtml,
  emptyDrawingMetadata,
} from "./engineering-drawing";

export function EngineeringDrawingExport({
  controller,
  items,
}: {
  controller: ReturnType<typeof useFactoryDiagram>;
  items: InventoryItem[];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const document = controller.document;
  const initial = (value: typeof document) => ({
    ...(value.drawing ?? emptyDrawingMetadata()),
    title: value.title,
  });
  const [base, setBase] = useState(document);
  const [draft, setDraft] = useState(() => initial(document));
  const metadata = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial(base));
  const stale = JSON.stringify(base) !== JSON.stringify(document);
  useEffect(() => {
    if (!dirty) {
      setBase(document);
      setDraft(initial(document));
    }
  }, [document]);
  const issues = drawingIssues(document, items),
    fatal = issues.filter((i) => i.severity === "error"),
    missing = issues.filter((i) => i.severity === "missing");
  const save = () => {
    try {
      if (stale)
        throw Error(
          "This drawing changed in another tab. Reload sheet details before saving.",
        );
      const { title, ...drawing } = draft;
      const next = { ...document, title, drawing };
      controller.save(next);
      setBase(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const run = async (kind: "dxf" | "pdf") => {
    setBusy(true);
    setError("");
    try {
      const drawing = buildEngineeringDrawing(document, items);
      if (kind === "pdf")
        await openReportPreview(async () => ({
          html: drawingPrintHtml(drawing),
        }));
      else {
        const { engineeringDxf } = await import("./engineering-dxf");
        const url = URL.createObjectURL(
          new Blob([engineeringDxf(drawing)], { type: "application/dxf" }),
        );
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${(metadata.number || `factory-${document.mode}`).replace(/[^a-zA-Z0-9_-]/g, "-")}-${(metadata.revision || "draft").replace(/[^a-zA-Z0-9_-]/g, "-")}.dxf`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="min-w-0 shrink-0 border-b px-4 py-2"
      data-testid="engineering-drawing-export"
    >
      <summary className="cursor-pointer text-xs font-medium">
        Engineering sheets · DXF &amp; PDF
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Editable CAD and A3 PDF sheets include the full saved drawing, even
          connections outside this zone. Drawing units are millimetres;
          schematic scale is NTS.
        </p>
        <div
          className="max-h-80 space-y-3 overflow-y-auto pr-1"
          aria-label="Drawing sheet details"
        >
          <fieldset
            disabled={controller.blocked || busy}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="text-xs">
              Drawing title
              <input
                aria-label="Drawing title"
                className="workspace-control mt-1 w-full"
                value={draft.title}
                maxLength={160}
                onChange={(e) => {
                  setDraft({ ...draft, title: e.target.value });
                }}
              />
            </label>
            {(
              [
                ["project", "Project", 100],
                ["number", "Drawing number", 60],
                ["revision", "Drawing revision", 24],
                ["preparedBy", "Prepared by", 80],
                ["checkedBy", "Checked by", 80],
                ["sheetPrefix", "Sheet prefix", 16],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="text-xs">
                {label}
                <input
                  aria-label={label}
                  className="workspace-control mt-1 w-full"
                  value={metadata[key]}
                  maxLength={max}
                  placeholder="Not supplied"
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label className="text-xs">
              Drawing date
              <input
                aria-label="Drawing date"
                type="date"
                className="workspace-control mt-1 w-full"
                value={metadata.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Drawing purpose
              <select
                aria-label="Drawing purpose"
                className="workspace-control mt-1 w-full"
                value={metadata.purpose}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    purpose: e.target.value as "draft" | "review",
                  })
                }
              >
                <option value="draft">Draft</option>
                <option value="review">Engineering review</option>
              </select>
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={controller.blocked || busy || !dirty || stale}
              onClick={save}
            >
              Save sheet details
            </Button>
            {(dirty || stale) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBase(document);
                  setDraft(initial(document));
                  setError("");
                }}
              >
                Reload sheet details
              </Button>
            )}
            {stale && dirty && (
              <span role="alert" className="text-xs text-destructive">
                Drawing changed in another tab. Reload sheet details to use the
                latest version.
              </span>
            )}
            {dirty && !stale && (
              <span className="text-xs text-muted-foreground">
                Save sheet details before exporting.
              </span>
            )}
          </div>
          <div
            className="rounded border p-3 text-xs"
            aria-label="Engineering export validation"
          >
            <p className="font-medium">
              {fatal.length
                ? `${fatal.length} issues prevent CAD export`
                : missing.length
                  ? `${missing.length} missing engineering fields · exports marked incomplete draft`
                  : "Drawing fields complete · engineering review remains required"}
            </p>
            {!!issues.length && (
              <ul className="mt-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-4">
                {issues.map((issue, i) => (
                  <li key={i}>
                    {issue.target} · {issue.field}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || controller.blocked || !!fatal.length || dirty || stale
            }
            onClick={() => void run("dxf")}
          >
            Export editable DXF
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || controller.blocked || !!fatal.length || dirty || stale
            }
            onClick={() => void run("pdf")}
          >
            Preview / save PDF
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Missing values remain “Not supplied” in the schedule. Demo equipment
          is explicitly marked illustrative. CAD files contain drawing data
          only; equipment or operational connections are not changed.
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
