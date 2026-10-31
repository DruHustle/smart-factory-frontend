import { useState } from "react";
import { Factory, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useFactoryDirectory } from "@/lib/named-factory";
import { namedFactoryDraft } from "@shared/named-factory";

export function FactorySelector() {
  const directory = useFactoryDirectory();
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [width, setWidth] = useState(30),
    [depth, setDepth] = useState(20),
    [busy, setBusy] = useState(false),
    [addingBench, setAddingBench] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Factory className="size-4 shrink-0 text-info" aria-hidden />
      <select
        aria-label="Active factory"
        value={directory.id ?? ""}
        className="workspace-control h-9 min-w-0 max-w-60"
        onChange={(e) => directory.select(e.target.value || null)}
      >
        <option value="">
          {directory.demo ? "Reference installation" : "All inventory"}
        </option>
        {directory.id &&
          !directory.factories.some((f) => f.id === directory.id) && (
            <option value={directory.id}>Selected factory</option>
          )}
        {directory.factories.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} · {f.items} items
          </option>
        ))}
      </select>
      {directory.canEdit && (
        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label="Create factory"
          title="Create factory"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      )}
      {directory.demo &&
        directory.canEdit &&
        directory.state &&
        !directory.piBench && (
          <Button
            variant="outline"
            size="sm"
            disabled={addingBench}
            onClick={async () => {
              if (addingBench) return;
              setAddingBench(true);
              try {
                await directory.addPiBench();
                toast.success("Pi bench ready in this browser demo.");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "The Pi bench could not be added.",
                );
              } finally {
                setAddingBench(false);
              }
            }}
          >
            {addingBench ? "Adding Pi bench…" : "Add Pi bench"}
          </Button>
        )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a factory</DialogTitle>
            <DialogDescription>
              {directory.demo
                ? "Build a resettable factory in this browser. Switch demo roles to explore permissions."
                : "Your team can access this factory under the existing roles."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const draft = namedFactoryDraft.parse({
                  document: { name, width, depth, zones: [], placements: [] },
                  dimensions: {},
                  tags: {},
                });
                await directory.createFactory(draft);
                setOpen(false);
                setName("");
                toast.success("Factory created");
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Factory could not be created",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              Factory name
              <input
                required
                maxLength={120}
                aria-label="Factory name"
                className="workspace-control mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Floor width (m)", width, setWidth],
                  ["Floor depth (m)", depth, setDepth],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label} className="text-sm">
                  {label}
                  <input
                    required
                    type="number"
                    min={4}
                    max={1000}
                    step="0.01"
                    aria-label={label}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    className="workspace-control mt-1"
                  />
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create factory"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
