import { useRef, useState } from "react";
import { Factory, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useFactoryDirectory } from "@/lib/named-factory";
import { namedFactoryDraft } from "@shared/named-factory";

export function FactorySelector({ compact = false }: { compact?: boolean }) {
  const directory = useFactoryDirectory();
  const mobileActions = useRef<HTMLButtonElement>(null),
    createAction = useRef<HTMLButtonElement>(null),
    openedFromMenu = useRef(false);
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [width, setWidth] = useState(30),
    [depth, setDepth] = useState(20),
    [busy, setBusy] = useState(false),
    [addingBench, setAddingBench] = useState(false),
    [error, setError] = useState("");
  const canAddBench =
    directory.demo &&
    directory.canEdit &&
    directory.state &&
    !directory.piBench;
  const addPiBench = async () => {
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
  };
  return (
    <div
      className={`factory-selector flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto ${compact ? "factory-selector-compact" : ""}`}
    >
      <div className="factory-selector-field flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <Factory
          className="factory-selector-icon size-4 shrink-0 text-info"
          aria-hidden
        />
        <select
          aria-label="Active factory"
          value={directory.id ?? ""}
          className="workspace-control h-9 w-48 min-w-0 flex-1 sm:w-60 sm:flex-initial"
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
            ref={createAction}
            variant="outline"
            size="icon"
            className="factory-selector-inline-action size-9 shrink-0"
            aria-label="Create factory"
            title="Create factory"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      {canAddBench && (
        <Button
          variant="outline"
          size="sm"
          className="factory-selector-inline-action"
          disabled={addingBench}
          onClick={() => void addPiBench()}
        >
          {addingBench ? "Adding Pi bench…" : "Add Pi bench"}
        </Button>
      )}
      {compact && directory.canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={mobileActions}
              className="factory-selector-mobile-actions hidden"
              variant="outline"
              size="icon"
              aria-label="Factory actions"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (open) event.preventDefault();
            }}
          >
            <DropdownMenuItem
              className="min-h-11"
              onSelect={() => {
                openedFromMenu.current = true;
                setOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden />
              Create factory
            </DropdownMenuItem>
            {canAddBench && (
              <DropdownMenuItem
                className="min-h-11"
                disabled={addingBench}
                onSelect={() => void addPiBench()}
              >
                {addingBench ? "Adding Pi bench…" : "Add Pi bench"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (!openedFromMenu.current) return;
            event.preventDefault();
            openedFromMenu.current = false;
            const target = mobileActions.current?.getClientRects().length
              ? mobileActions.current
              : createAction.current;
            target?.focus();
          }}
        >
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
