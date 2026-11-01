import { useEffect, useRef, useState } from "react";
import { Cable, Download, Plus, Upload, X } from "lucide-react";
import type { InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import {
  DIAGRAM_KINDS,
  DIAGRAM_KIND_LABELS,
  type DiagramConnection,
} from "./factory-diagrams";
import { MAX_DIAGRAM_BYTES, type useFactoryDiagram } from "./useFactoryDiagram";
import { engineeringFields } from "./engineering-drawing";

type Controller = ReturnType<typeof useFactoryDiagram>;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The drawing could not be updated.";
const blankConnection = (
  mode: Controller["document"]["mode"],
): DiagramConnection => ({
  id: "",
  from: "",
  to: "",
  kind: mode === "process" ? "process" : "power",
  label: "",
  direction: "none",
  fromTerminal: "",
  toTerminal: "",
  designation: "",
  specification: "",
});

export function FactoryDiagramEditor({
  controller,
  items,
  onSelectConnection,
}: {
  controller: Controller;
  items: InventoryItem[];
  onSelectConnection: (id: string | null) => void;
}) {
  const { document, blocked } = controller;
  const [draft, setDraft] = useState(() => blankConnection(document.mode));
  const [editing, setEditing] = useState<string | null>(null);
  const [editOriginal, setEditOriginal] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const latest = useRef(controller);
  latest.current = controller;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reset = () => {
    setDraft(blankConnection(document.mode));
    setEditing(null);
    setEditOriginal("");
  };
  const update = (patch: Partial<DiagramConnection>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setError("");
    setMessage("");
  };
  const names = new Map(items.map((item) => [item.ref, item.name]));
  const exportDiagram = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `factory-${document.mode}-diagram.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details
      className="min-w-0 shrink-0 border-b px-4 py-2"
      data-testid="diagram-configuration"
    >
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
        <Cable className="size-4 shrink-0" aria-hidden="true" />
        Diagram connections · {document.connections.length}
      </summary>
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
        <p className="text-xs text-muted-foreground">
          Saved in this browser for this account and factory.
        </p>
        {blocked && (
          <Button
            size="sm"
            variant="outline"
            onClick={controller.resetUnreadable}
          >
            Reset unreadable diagram
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={exportDiagram}
          >
            <Download className="size-3.5" /> Export diagram JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || importing}
            onClick={() => upload.current?.click()}
          >
            <Upload className="size-3.5" />{" "}
            {importing ? "Reading diagram…" : "Import diagram JSON"}
          </Button>
          <input
            ref={upload}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept="application/json,.json"
            aria-label="Import diagram JSON"
            disabled={blocked || importing}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const previous = JSON.stringify(document);
              setError("");
              setMessage("");
              setImporting(true);
              try {
                if (file.size > MAX_DIAGRAM_BYTES)
                  throw Error("Use a diagram JSON file smaller than 1 MB.");
                const value: unknown = JSON.parse(await file.text());
                if (!alive.current) return;
                if (
                  latest.current.key !== controller.key ||
                  JSON.stringify(latest.current.document) !== previous
                )
                  throw Error(
                    "The drawing changed while the file was being read. Review the current drawing and import again.",
                  );
                latest.current.importDocument(value);
                reset();
                onSelectConnection(null);
                setMessage("Diagram imported.");
              } catch (error) {
                if (alive.current) setError(errorMessage(error));
              } finally {
                if (alive.current) setImporting(false);
              }
            }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Import replaces this drawing. Export first to keep a copy.
        </p>
        {message && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setMessage("");
            try {
              if (!names.has(draft.from) || !names.has(draft.to))
                throw Error("Choose two items in this factory.");
              if (
                editing &&
                !document.connections.some((link) => link.id === editing)
              )
                throw Error(
                  "This connection changed in another tab. Cancel and choose it again.",
                );
              if (
                editing &&
                JSON.stringify(
                  document.connections.find((link) => link.id === editing),
                ) !== editOriginal
              )
                throw Error(
                  "This connection changed in another tab. Cancel and choose it again.",
                );
              const next = { ...draft, id: editing ?? crypto.randomUUID() };
              const connections = editing
                ? document.connections.map((link) =>
                    link.id === editing ? next : link,
                  )
                : [...document.connections, next];
              controller.save({ ...document, connections });
              onSelectConnection(next.id);
              reset();
              setMessage(editing ? "Connection updated." : "Connection added.");
            } catch (error) {
              setError(errorMessage(error));
            }
          }}
        >
          <fieldset
            disabled={blocked || importing}
            className="min-w-0 space-y-3"
          >
            <legend className="mb-2 text-xs font-medium">
              {editing ? "Edit connection" : "Add a connection"}
            </legend>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block min-w-0 text-xs text-muted-foreground">
                Connection type
                <select
                  aria-label="Connection type"
                  className="workspace-control mt-1 w-full"
                  value={draft.kind}
                  onChange={(event) =>
                    update({
                      kind: event.target.value as DiagramConnection["kind"],
                    })
                  }
                >
                  {DIAGRAM_KINDS[document.mode].map((kind) => (
                    <option value={kind} key={kind}>
                      {DIAGRAM_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              {(["from", "to"] as const).map((end) => (
                <label
                  key={end}
                  className="block min-w-0 text-xs text-muted-foreground"
                >
                  {end === "from" ? "From equipment" : "To equipment"}
                  <select
                    aria-label={
                      end === "from" ? "From equipment" : "To equipment"
                    }
                    className="workspace-control mt-1 w-full"
                    required
                    value={draft[end]}
                    onChange={(event) => update({ [end]: event.target.value })}
                  >
                    <option value="">Choose equipment</option>
                    {items.map((item) => (
                      <option key={item.ref} value={item.ref}>
                        {item.factoryTag ? `${item.factoryTag} · ` : ""}
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="block min-w-0 text-xs text-muted-foreground">
                Flow direction
                <select
                  aria-label="Flow direction"
                  className="workspace-control mt-1 w-full"
                  value={draft.direction}
                  onChange={(event) =>
                    update({
                      direction: event.target
                        .value as DiagramConnection["direction"],
                    })
                  }
                >
                  <option value="none">Not specified</option>
                  <option value="forward">From → To</option>
                  <option value="reverse">To → From</option>
                  <option value="both">Both directions</option>
                </select>
              </label>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["label", "Connection label", 160],
                  ["designation", "Line or cable tag", 120],
                  ["specification", "Connection specification", 240],
                  ["fromTerminal", "From terminal", 80],
                  ["toTerminal", "To terminal", 80],
                ] as const
              ).map(([field, label, max]) => (
                <label
                  key={field}
                  className="block min-w-0 text-xs text-muted-foreground"
                >
                  {label}
                  <input
                    aria-label={label}
                    className="workspace-control mt-1 w-full"
                    maxLength={max}
                    required={field === "label"}
                    value={draft[field] ?? ""}
                    onChange={(event) =>
                      update({ [field]: event.target.value })
                    }
                    placeholder={
                      field === "label"
                        ? "e.g. Pump discharge"
                        : "Optional · use drawing data"
                    }
                  />
                </label>
              ))}
            </div>
            <details className="rounded border p-2">
              <summary className="cursor-pointer text-xs font-medium">
                Engineering specifications
              </summary>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Enter values from the source drawing, including units. Missing
                values stay explicit in CAD and PDF exports.
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {engineeringFields
                  .filter(([key]) =>
                    draft.kind === "process"
                      ? [
                          "service",
                          "nominalSize",
                          "material",
                          "designPressure",
                          "designTemperature",
                        ].includes(key)
                      : draft.kind === "instrument"
                        ? ["signal", "service"].includes(key)
                        : [
                            "voltage",
                            "conductor",
                            "protection",
                            "signal",
                          ].includes(key),
                  )
                  .map(([key, label]) => (
                    <label key={key} className="text-xs text-muted-foreground">
                      {label}
                      <input
                        aria-label={label}
                        className="workspace-control mt-1 w-full"
                        maxLength={80}
                        value={draft.engineering?.[key] ?? ""}
                        onChange={(e) =>
                          update({
                            engineering: {
                              ...draft.engineering,
                              [key]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={items.length < 2}>
                <Plus className="size-3.5" />
                {editing ? "Save connection" : "Add connection"}
              </Button>
              {editing && (
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <X className="size-3.5" />
                  Cancel editing
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                Drawing only · {document.connections.length}/500 connections
              </span>
            </div>
          </fieldset>
        </form>
        {!!document.connections.length && (
          <ul
            aria-label="Diagram connection list"
            className="space-y-1 border-t pt-2"
          >
            {document.connections.map((link) => (
              <li
                key={link.id}
                className="flex min-w-0 flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => onSelectConnection(link.id)}
                >
                  <span className="block break-words font-medium">
                    {link.label}
                  </span>
                  <span className="block break-words text-muted-foreground">
                    {names.get(link.from) ?? "Unavailable equipment"}{" "}
                    {link.direction === "forward"
                      ? "→"
                      : link.direction === "reverse"
                        ? "←"
                        : link.direction === "both"
                          ? "↔"
                          : "—"}{" "}
                    {names.get(link.to) ?? "Unavailable equipment"}
                  </span>
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={blocked || importing}
                  aria-label={`Edit ${link.label}`}
                  onClick={() => {
                    setDraft(link);
                    setEditing(link.id);
                    setEditOriginal(JSON.stringify(link));
                    setError("");
                    setMessage("");
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={blocked || importing}
                  aria-label={`Remove ${link.label}`}
                  onClick={() => {
                    try {
                      controller.save({
                        ...document,
                        connections: document.connections.filter(
                          (entry) => entry.id !== link.id,
                        ),
                      });
                      if (editing === link.id) reset();
                      onSelectConnection(null);
                      setError("");
                      setMessage("Connection removed from this drawing.");
                    } catch (error) {
                      setError(errorMessage(error));
                    }
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function DiagramConnectionDetails({
  connection,
  items,
  onSelect,
}: {
  connection: DiagramConnection;
  items: InventoryItem[];
  onSelect: (ref: string) => void;
}) {
  const names = new Map(items.map((item) => [item.ref, item.name]));
  return (
    <section
      aria-label="Selected diagram connection"
      className="floor-secondary space-y-2 border-t bg-info/5 px-4 py-3"
    >
      <h3 className="break-words text-sm font-semibold">{connection.label}</h3>
      <p className="text-xs text-muted-foreground">
        {DIAGRAM_KIND_LABELS[connection.kind]} ·{" "}
        {connection.direction === "none"
          ? "Direction not specified"
          : connection.direction === "both"
            ? "Bidirectional"
            : connection.direction === "forward"
              ? "From → To"
              : "To → From"}
      </p>
      <div className="flex flex-wrap gap-2">
        {(["from", "to"] as const).map((end) => (
          <Button
            key={end}
            size="sm"
            variant="outline"
            className="h-auto min-h-9 max-w-full whitespace-normal text-left"
            onClick={() => onSelect(connection[end])}
          >
            {end === "from" ? "From: " : "To: "}
            {names.get(connection[end]) ?? "Unavailable equipment"}
          </Button>
        ))}
      </div>
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["From terminal", connection.fromTerminal],
            ["To terminal", connection.toTerminal],
            ["Line / cable tag", connection.designation],
            ["Specification", connection.specification],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words">{value || "Not supplied"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
