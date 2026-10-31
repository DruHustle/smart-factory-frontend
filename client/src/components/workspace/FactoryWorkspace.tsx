import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  X,
  Save,
  Settings2,
  History,
  Download,
  RefreshCw,
  ArrowUpRight,
  Boxes,
  Radio,
  Map,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, StatusBadge } from "./Primitives";
import { FactoryFloor } from "./FactoryFloor";
import { FactorySelector } from "./FactorySelector";
import { useNamedFactory } from "@/lib/named-factory";
import { trpc } from "@/lib/trpc";
import {
  demoSandboxStorageError,
  demoSandboxRecovery,
} from "@/lib/demo-sandbox";
import { sandboxInventory } from "@shared/demo-sandbox";
import { factoryCatalog } from "@shared/factory-catalog";
import {
  newFactoryItem,
  type NamedFactoryDraft,
  type PhysicalDimensions,
  type FactoryActivitySummary,
} from "@shared/named-factory";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { gatewayLinksForFloor } from "@shared/factory-floor";
import { DEMO_ACCOUNTS } from "@shared/demo-accounts";
import { factoryZoneSuggestions } from "./factory-spaces";

type Controller = ReturnType<typeof useNamedFactory>;
type Tab = "equipment" | "floor" | "activity";
const download = (value: unknown, filename: string) => {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This operation could not be completed.";
function NumberField({
  label,
  value,
  onChange,
  min = -1000,
  max = 1000,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block min-w-0 text-xs text-muted-foreground">
      {label}
      <input
        aria-label={label}
        type="number"
        step="0.01"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        className="workspace-control mt-1"
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </label>
  );
}
function TextField({
  label,
  value,
  onChange,
  max = 180,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <input
        aria-label={label}
        maxLength={max}
        className="workspace-control mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function SizeFields({
  value,
  onChange,
}: {
  value: PhysicalDimensions;
  onChange: (value: PhysicalDimensions) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["width", "depth", "height"] as const).map((axis) => (
        <NumberField
          key={axis}
          label={axis[0].toUpperCase() + axis.slice(1) + " (m)"}
          min={0.05}
          value={value[axis]}
          onChange={(v) => onChange({ ...value, [axis]: v })}
        />
      ))}
    </div>
  );
}
export function FactoryWorkspace({
  id,
  mode = "overview",
}: {
  id: string;
  mode?: "overview" | "inventory";
}) {
  const c = useNamedFactory(id),
    { login } = useAuth();
  const [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<Tab | null>(null),
    [search, setSearch] = useState(""),
    [roleBusy, setRoleBusy] = useState(false);
  const draft = c.draft,
    factory = c.factory;
  const items = useMemo(
    () =>
      (factory?.items ?? []).map((item) => {
        const placement = draft?.document.placements.find(
            (p) => p.ref === item.ref,
          ),
          zone = draft?.document.zones.find((z) => z.id === placement?.zoneId);
        return {
          ...item,
          factoryTag: draft?.tags[item.ref] ?? item.factoryTag,
          zone: zone?.name ?? "Unassigned",
          location: zone?.name ?? null,
        };
      }),
    [factory?.items, draft],
  );
  const change = (mutate: (next: NamedFactoryDraft) => void) => {
    if (!draft) return;
    const next = structuredClone(draft);
    mutate(next);
    c.update(next);
  };
  const save = async () => {
    try {
      await c.save();
      toast.success(
        c.demo ? "Demo factory saved" : "Factory saved for your team",
      );
    } catch (error) {
      toast.error(message(error));
    }
  };
  const active = items.find((i) => i.ref === selected);
  const editor =
    tab && draft ? (
      <aside
        aria-label="Factory editor"
        className="absolute inset-y-0 right-0 z-20 flex w-full max-w-96 flex-col border-l bg-background/95 shadow-xl backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b p-2">
          <div
            role="tablist"
            aria-label="Factory editor tabs"
            className="flex gap-1"
          >
            {(["equipment", "floor", "activity"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                role="tab"
                aria-selected={tab === t}
                variant={tab === t ? "secondary" : "ghost"}
                onClick={() => setTab(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close factory editor"
            onClick={() => setTab(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
          {tab === "equipment" && (
            <div className="space-y-5">
              {active && <ItemInspector c={c} item={active} change={change} />}{" "}
              {c.canEdit ? (
                <AddEquipment
                  c={c}
                  onAdded={(ref) => {
                    setSelected(ref);
                    setTab(null);
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Engineer or Admin access is required to add or move equipment.
                  Select an item to inspect its details.
                </p>
              )}
            </div>
          )}
          {tab === "floor" && <FloorEditor c={c} change={change} />}
          {tab === "activity" && <FactoryActivity c={c} />}
        </div>
      </aside>
    ) : undefined;
  return (
    <div
      className="min-w-0 space-y-3"
      data-testid="named-factory-workspace"
      data-factory-id={id}
    >
      <PageHeader
        title={factory?.name ?? "Factory"}
        description={
          c.demo
            ? "Editable browser demo · simulated equipment"
            : "Shared factory · team permissions apply"
        }
        action={<FactorySelector />}
      />
      {c.demo && factory?.name === "Current Pi + DHT11 setup" && (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
          Hardware topology: DHT11 → ESP32 WROVER → Raspberry Pi 5 gateway.
          Board models are enlarged in 3D for inspection; floor positions can be
          moved to match your bench. This browser demo uses simulated records,
          not the private physical readings.
        </p>
      )}
      {c.demo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs">
          <span>
            Changes are saved in this browser.{" "}
            <Link href="/sandbox" className="underline">
              Demo backup & reset
            </Link>
          </span>
          <label className="flex items-center gap-2">
            Demo role
            <select
              aria-label="Factory demo role"
              value={c.role}
              disabled={roleBusy}
              className="workspace-control h-8 w-auto"
              onChange={async (e) => {
                const account = DEMO_ACCOUNTS.find(
                  (a) => a.role === e.target.value,
                );
                if (!account) return;
                setRoleBusy(true);
                try {
                  const result = await login(account.email, account.password);
                  if (!result.success)
                    toast.error(result.error ?? "Role switch failed");
                } finally {
                  setRoleBusy(false);
                }
              }}
            >
              {DEMO_ACCOUNTS.map((a) => (
                <option key={a.role} value={a.role}>
                  {a.role}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {(c.storageError ||
        c.conflict ||
        c.recoveryRaw ||
        (c.demo && demoSandboxStorageError())) && (
        <div
          className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
          role="alert"
        >
          <p>
            {c.conflict
              ? "A teammate saved a newer factory. Your browser draft has been kept. Download it before loading the saved version."
              : c.storageError ||
                "The demo workspace could not be saved in browser storage. Download a backup before leaving."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  c.recoveryRaw ?? (c.demo && demoSandboxRecovery()) ?? c.draft,
                  "factory-draft.json",
                )
              }
            >
              <Download className="mr-2 size-4" />
              Download draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void c.reload().catch((e) => toast.error(message(e)))
              }
            >
              Load saved factory
            </Button>
            {c.demo && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => download(c.state, "demo-workspace.json")}
              >
                Download demo backup
              </Button>
            )}
          </div>
        </div>
      )}
      {c.loadingFactory && (
        <p role="status" className="p-6 text-sm">
          Loading factory…
        </p>
      )}
      {(c.factoryError || (!c.loadingFactory && !factory)) && (
        <div role="alert" className="rounded-lg border p-6">
          <p>
            {c.factoryError?.message ??
              "This factory is unavailable. Choose another factory or the reference installation."}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => c.select(null)}
          >
            View all inventory
          </Button>
        </div>
      )}
      {factory && draft && (
        <>
          <div className="grid grid-cols-3 gap-2" aria-label="Factory totals">
            {[
              [Boxes, "Items", factory.total],
              [
                Radio,
                "Devices",
                items.filter((i) => i.kind === "device").length,
              ],
              [
                Map,
                "Floor",
                `${draft.document.width} × ${draft.document.depth} m`,
              ],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof Boxes;
              return (
                <div
                  key={String(label)}
                  className="min-w-0 rounded-lg border bg-card px-3 py-2"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <I className="size-3.5" />
                    {String(label)}
                  </span>
                  <strong className="mt-1 block break-words text-lg">
                    {String(value)}
                  </strong>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {c.dirty
                ? "Unsaved layout draft"
                : `Saved version ${factory.version}`}{" "}
              · {c.demo ? "Browser sandbox" : "Team factory"}
            </span>
            <div className="flex items-center gap-1">
              {c.canEdit && (
                <Button
                  size="sm"
                  variant={c.dirty ? "default" : "outline"}
                  disabled={
                    !c.dirty || c.busy || !c.validation?.success || c.conflict
                  }
                  onClick={() => void save()}
                >
                  <Save className="mr-2 size-4" />
                  {c.busy ? "Saving…" : "Save layout"}
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Refresh factory"
                disabled={c.busy}
                onClick={() => void c.refresh()}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Download factory layout"
                aria-label="Download factory layout"
                onClick={() =>
                  download(draft, `${draft.document.name}-layout.json`)
                }
              >
                <Download className="size-4" />
              </Button>
            </div>
          </div>
          {c.validation && !c.validation.success && (
            <p role="alert" className="text-sm text-destructive">
              {c.validation.error.issues[0]?.message}
            </p>
          )}
          {factory.unavailableItems > 0 && (
            <p role="alert" className="text-sm text-warning">
              {factory.unavailableItems} inventory records are unavailable in
              this view. Their saved placements are retained.
            </p>
          )}
          <FactoryFloor
            items={items}
            links={gatewayLinksForFloor(items)}
            selected={selected}
            onSelect={(ref) => setSelected(ref || null)}
            returnTo={`/${mode === "inventory" ? "inventory" : ""}?factory=${id}`}
            demo={c.demo}
            measured
            itemDimensions={draft.dimensions}
            layoutDocument={draft.document}
            movable={c.canEdit}
            arrangementKey={`named-factory:${id}`}
            onLayoutMove={(ref, x, z) =>
              change((next) => {
                const p = next.document.placements.find((p) => p.ref === ref);
                if (p) {
                  p.x = x;
                  p.z = z;
                }
              })
            }
            onGrabStart={() => setTab(null)}
            onGrabChange={c.setGrabbing}
            onInventoryDelete={
              c.canDelete
                ? async (ref) => {
                    const warnings = await c.remove(ref);
                    warnings?.forEach((warning) =>
                      toast.warning(warning, { duration: 15000 }),
                    );
                    if (selected === ref) setSelected(null);
                    toast.success("Item removed from factory inventory");
                  }
                : undefined
            }
            headerActions={
              <>
                {c.canEdit && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-9"
                    title="Add equipment"
                    aria-label="Add equipment"
                    onClick={() => setTab("equipment")}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  title="Edit factory floor"
                  aria-label="Edit factory floor"
                  onClick={() => setTab("floor")}
                >
                  <Settings2 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  title="Factory activity"
                  aria-label="Factory activity"
                  onClick={() => setTab("activity")}
                >
                  <History className="size-4" />
                </Button>
              </>
            }
            editor={editor}
          />
          <section
            className="rounded-lg border bg-card p-4"
            aria-label="Factory inventory"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Inventory · {factory.total}</h2>
              <label className="flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  aria-label="Search factory inventory"
                  placeholder="Search this factory…"
                  className="workspace-control max-w-64"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items
                .filter((i) =>
                  `${i.name} ${i.factoryTag} ${i.itemType} ${i.identifier}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <li
                    key={i.ref}
                    className={`min-w-0 rounded-md border p-3 ${selected === i.ref ? "border-info bg-info/5" : ""}`}
                  >
                    <button
                      className="w-full break-words text-left text-sm font-medium hover:underline"
                      aria-label={`Select ${i.name} on floor`}
                      onClick={() => {
                        setSelected(i.ref);
                        if (c.canEdit) setTab("equipment");
                      }}
                    >
                      {i.name}
                    </button>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {i.factoryTag} · {i.itemType.replaceAll("_", " ")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={i.status} />
                      <Link
                        className="inline-flex min-h-8 items-center gap-1 text-xs underline"
                        href={
                          i.sandbox
                            ? `/sandbox?tab=inventory&item=${encodeURIComponent(i.ref)}`
                            : itemHref(i.ref, "overview", `/?factory=${id}`)
                        }
                      >
                        Open item <ArrowUpRight className="size-3" />
                      </Link>
                    </div>
                  </li>
                ))}
            </ul>
            {!factory.total && (
              <p className="py-6 text-sm text-muted-foreground">
                This floor is ready for your equipment. Use the plus icon to
                create an inventory item or place an existing one.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function ItemInspector({
  c,
  item,
  change,
}: {
  c: Controller;
  item: InventoryItem;
  change: (fn: (d: NamedFactoryDraft) => void) => void;
}) {
  const d = c.draft!,
    p = d.document.placements.find((p) => p.ref === item.ref)!;
  return (
    <section
      className="space-y-3 rounded-lg border p-3"
      aria-label="Item placement"
    >
      <h3 className="break-words text-sm font-semibold">{item.name}</h3>
      <fieldset disabled={!c.canEdit} className="space-y-3">
        <TextField
          label="Factory tag"
          value={d.tags[item.ref]}
          onChange={(v) =>
            change((next) => {
              next.tags[item.ref] = v;
            })
          }
        />
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="X (m)"
            value={p.x}
            onChange={(v) =>
              change((n) => {
                n.document.placements.find((p) => p.ref === item.ref)!.x = v;
              })
            }
          />
          <NumberField
            label="Z (m)"
            value={p.z}
            onChange={(v) =>
              change((n) => {
                n.document.placements.find((p) => p.ref === item.ref)!.z = v;
              })
            }
          />
          <NumberField
            label="Rotation (°)"
            min={0}
            max={360}
            value={p.rotation}
            onChange={(v) =>
              change((n) => {
                n.document.placements.find(
                  (p) => p.ref === item.ref,
                )!.rotation = v;
              })
            }
          />
        </div>
        <SizeFields
          value={d.dimensions[item.ref]}
          onChange={(v) =>
            change((n) => {
              n.dimensions[item.ref] = v;
            })
          }
        />
        <label className="block text-xs text-muted-foreground">
          Floor section
          <select
            className="workspace-control mt-1"
            aria-label="Item floor section"
            value={p.zoneId ?? ""}
            onChange={(e) =>
              change((n) => {
                n.document.placements.find((p) => p.ref === item.ref)!.zoneId =
                  e.target.value || null;
              })
            }
          >
            <option value="">Unassigned</option>
            {d.document.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Coordinates are in metres from the floor centre. Save layout to publish
        these changes.
      </p>
    </section>
  );
}
function AddEquipment({
  c,
  onAdded,
}: {
  c: Controller;
  onAdded: (ref: string) => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new"),
    [preset, setPreset] = useState(factoryCatalog[0].id),
    [name, setName] = useState(""),
    [tag, setTag] = useState(""),
    [size, setSize] = useState<PhysicalDimensions>({
      width: 2,
      depth: 1.2,
      height: 1.5,
    }),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [ref, setRef] = useState(""),
    [error, setError] = useState("");
  const catalog = factoryCatalog.find((p) => p.id === preset)!;
  const query = trpc.factories.available.useQuery(
    { search, page },
    { enabled: !c.demo && mode === "existing", retry: false },
  );
  const assigned = new Set(
    c.state?.factories.flatMap((f) =>
      f.draft.document.placements.map((p) => p.ref),
    ) ?? [],
  );
  const demoAvailable = c.state
    ? sandboxInventory(c.state).filter(
        (i) =>
          !assigned.has(i.ref) &&
          `${i.name} ${i.identifier}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
    : [];
  const available = c.demo
    ? demoAvailable.slice(page * 25, page * 25 + 25)
    : (query.data?.items ?? []);
  const total = c.demo ? demoAvailable.length : (query.data?.total ?? 0);
  return (
    <form
      className="space-y-3"
      aria-label="Add factory equipment"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const added =
            mode === "new"
              ? await c.add(
                  newFactoryItem.parse({
                    name,
                    identifier: tag,
                    kind: catalog.kind,
                    itemType: catalog.itemType,
                    dimensions: size,
                  }),
                )
              : await c.attach(ref, size, tag);
          onAdded(added);
          toast.success("Inventory and floor updated");
        } catch (error) {
          setError(message(error));
        }
      }}
    >
      <h3 className="text-sm font-semibold">Add to this factory</h3>
      <div className="flex gap-1" role="group" aria-label="Equipment source">
        <Button
          type="button"
          size="sm"
          variant={mode === "new" ? "secondary" : "ghost"}
          onClick={() => setMode("new")}
        >
          New item
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "existing" ? "secondary" : "ghost"}
          onClick={() => setMode("existing")}
        >
          Existing inventory
        </Button>
      </div>
      {mode === "new" ? (
        <>
          <label className="block text-xs text-muted-foreground">
            Equipment type
            <select
              aria-label="Equipment type"
              value={preset}
              className="workspace-control mt-1"
              onChange={(e) => {
                const p = factoryCatalog.find((p) => p.id === e.target.value)!;
                setPreset(p.id);
                setSize({ width: p.width, depth: p.depth, height: p.height });
              }}
            >
              {factoryCatalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Item name" value={name} onChange={setName} />
        </>
      ) : (
        <>
          <TextField
            label="Search available inventory"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(0);
              setRef("");
            }}
          />
          <select
            aria-label="Available inventory item"
            className="workspace-control"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              const item = available.find((i) => i.ref === e.target.value);
              setTag(item?.factoryTag || item?.name || "");
            }}
          >
            <option value="">Choose an unassigned item…</option>
            {available.map((i) => (
              <option key={i.ref} value={i.ref}>
                {i.name} · {i.identifier}
              </option>
            ))}
          </select>
          <div className="flex items-center justify-between text-xs">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>
              {total} available · page {page + 1}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={(page + 1) * 25 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
          {query.error && (
            <p role="alert" className="text-xs text-destructive">
              {query.error.message}
            </p>
          )}
        </>
      )}
      <TextField
        label={
          mode === "new" && catalog.kind === "device"
            ? "Hardware ID"
            : "Item tag (unique in this factory)"
        }
        value={tag}
        onChange={setTag}
        max={128}
      />
      <SizeFields value={size} onChange={setSize} />
      <p className="text-xs text-muted-foreground">
        {mode === "new"
          ? "Creates a planned inventory record immediately. Connections and physical commissioning are configured separately."
          : "Places the existing inventory record here; an item belongs to one factory."}{" "}
        Reference dimensions are editable to match your equipment.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={
          c.busy ||
          c.conflict ||
          (mode === "new" ? !name.trim() : !ref || !tag.trim())
        }
      >
        <Plus className="mr-2 size-4" />
        {c.busy ? "Adding…" : "Add inventory item"}
      </Button>
    </form>
  );
}
function FloorEditor({
  c,
  change,
}: {
  c: Controller;
  change: (fn: (d: NamedFactoryDraft) => void) => void;
}) {
  const d = c.draft!;
  return (
    <fieldset disabled={!c.canEdit} className="space-y-4">
      <TextField
        label="Saved factory name"
        value={d.document.name}
        max={120}
        onChange={(v) =>
          change((n) => {
            n.document.name = v;
          })
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Saved floor width (m)"
          min={4}
          value={d.document.width}
          onChange={(v) =>
            change((n) => {
              n.document.width = v;
            })
          }
        />
        <NumberField
          label="Saved floor depth (m)"
          min={4}
          value={d.document.depth}
          onChange={(v) =>
            change((n) => {
              n.document.depth = v;
            })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Define receiving, storage, production and dispatch areas to match your
        site. Add doors and warehouse racks as equipment so they can be moved or
        removed.
      </p>
      <h3 className="text-sm font-semibold">Floor sections</h3>
      <datalist id="factory-section-names">
        {factoryZoneSuggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {d.document.zones.map((z, index) => (
        <div key={z.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">
              Section name
              <input
                aria-label={`Section ${index + 1} name`}
                list="factory-section-names"
                className="workspace-control mt-1"
                maxLength={80}
                value={z.name}
                onChange={(e) =>
                  change((n) => {
                    n.document.zones.find((a) => a.id === z.id)!.name =
                      e.target.value;
                  })
                }
              />
            </label>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove section ${z.name}`}
              onClick={() =>
                change((n) => {
                  n.document.zones = n.document.zones.filter(
                    (a) => a.id !== z.id,
                  );
                  n.document.placements.forEach((p) => {
                    if (p.zoneId === z.id) p.zoneId = null;
                  });
                })
              }
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["x", "z", "width", "depth"] as const).map((axis) => (
              <NumberField
                key={axis}
                label={`Section ${index + 1} ${axis} (m)`}
                value={z[axis]}
                min={axis === "width" || axis === "depth" ? 1 : -1000}
                onChange={(v) =>
                  change((n) => {
                    n.document.zones.find((a) => a.id === z.id)![axis] = v;
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}
      {c.canEdit && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={d.document.zones.length >= 100}
          onClick={() =>
            change((n) => {
              n.document.zones.push({
                id: crypto.randomUUID(),
                name: "New section",
                x: -n.document.width / 2 + 0.2,
                z: -n.document.depth / 2 + 0.2,
                width: Math.min(5, n.document.width - 0.4),
                depth: Math.min(5, n.document.depth - 0.4),
              });
            })
          }
        >
          <Plus className="mr-2 size-4" />
          Add floor section
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Section coordinates mark the lower corner. Equipment coordinates mark
        its centre. Save layout to share the floor definition.
      </p>
    </fieldset>
  );
}
const actionNames: Record<string, string> = {
  "factory.created": "Factory created",
  "factory.updated": "Factory definition changed",
  "placement.changed": "Placement or dimensions changed",
  "inventory.created": "Inventory item created",
  "inventory.attached": "Existing inventory placed",
  "inventory.updated": "Inventory record updated",
  "inventory.deleted": "Inventory item deleted",
  "floor.item_removed": "Item removed from floor",
  "alert_thresholds.insert": "Threshold created",
  "alert_thresholds.update": "Threshold changed",
  "alert_thresholds.delete": "Threshold removed",
  "alerts.insert": "Incident recorded",
  "alerts.update": "Incident status or assignment changed",
  "alerts.delete": "Incident removed",
  "equipment_workspaces.insert": "Equipment model created",
  "equipment_workspaces.update": "Equipment model or saved work changed",
  "equipment_scenario_runs.insert": "Equipment scenario recorded",
  "asset_passport_publications.insert": "Passport published",
  "asset_passport_publications.update": "Passport publication changed",
  "asset_passport_publications.delete": "Passport publication removed",
  "ota_deployments.insert": "Firmware rollout recorded",
  "ota_deployments.update": "Firmware rollout state changed",
  "threshold.changed": "Demo threshold changed",
  "incident.changed": "Demo incident changed",
  "decision.changed": "Demo investigation decision changed",
  "deploy.changed": "Demo firmware rollout queued",
  "completeDeployment.changed": "Demo firmware rollout completed",
  "inventory.cleanup_warning": "Gateway configuration needs reconciliation",
  "connection.added": "Connection created",
  "connection.updated": "Connection changed",
  "connection.removed": "Connection removed",
};
function FactoryActivity({ c }: { c: Controller }) {
  const [cursor, setCursor] = useState<string | undefined>(),
    [pages, setPages] = useState<FactoryActivitySummary[]>([]);
  const query = trpc.factories.activity.list.useQuery(
    { factoryId: c.factory!.id, cursor },
    { enabled: !c.demo, staleTime: 0, retry: false },
  );
  const demoAll = [...(c.state?.factoryActivity ?? [])]
    .filter((a) => a.factoryId === c.factory!.id)
    .reverse();
  const offset = cursor ? demoAll.findIndex((a) => a.id === cursor) + 1 : 0;
  const current = c.demo
    ? demoAll.slice(offset, offset + 50)
    : (query.data?.items ?? []);
  const next = c.demo
    ? demoAll.length > offset + 50
      ? current[49]?.id
      : null
    : query.data?.nextCursor;
  const rows: FactoryActivitySummary[] = [...pages, ...current].filter(
    (row, index, array) => array.findIndex((a) => a.id === row.id) === index,
  );
  return (
    <section className="space-y-3" aria-label="Factory change history">
      <h3 className="text-sm font-semibold">Who changed what</h3>
      <p className="text-xs text-muted-foreground">
        {c.demo
          ? "Simulated history in this browser. Resetting the demo clears it."
          : "Published factory and inventory changes are recorded by the server. History remains after an item is deleted."}{" "}
        Unsaved drafts and camera movements are not published changes.
      </p>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      <ol className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border p-3 text-xs">
            <p className="font-medium">
              {actionNames[row.action] ?? row.action.replaceAll(".", " ")}
            </p>
            <p className="mt-1 break-words">
              {row.actorName} · {row.actorRole}
            </p>
            <time dateTime={row.at} className="text-muted-foreground">
              {new Date(row.at).toLocaleString()}
            </time>
            {(row.label ||
              (c.demo &&
                String(
                  c.state?.factoryActivity.find((e) => e.id === row.id)?.after
                    ?.name ??
                    c.state?.factoryActivity.find((e) => e.id === row.id)
                      ?.before?.name ??
                    "",
                ))) && (
              <p className="mt-1 break-words font-medium">
                {row.label ||
                  String(
                    c.state?.factoryActivity.find((e) => e.id === row.id)?.after
                      ?.name ??
                      c.state?.factoryActivity.find((e) => e.id === row.id)
                        ?.before?.name ??
                      "",
                  )}
              </p>
            )}
            {row.targetRef && (
              <p className="mt-1 break-all text-muted-foreground">
                {row.targetRef}
              </p>
            )}
            <ActivityDetail c={c} row={row} />
          </li>
        ))}
      </ol>
      {!rows.length && !query.isLoading && (
        <p className="text-sm text-muted-foreground">No saved changes yet.</p>
      )}
      {next && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPages(rows);
            setCursor(next);
          }}
        >
          Load earlier changes
        </Button>
      )}
    </section>
  );
}
function ActivityDetail({
  c,
  row,
}: {
  c: Controller;
  row: FactoryActivitySummary;
}) {
  const [open, setOpen] = useState(false);
  const query = trpc.factories.activity.get.useQuery(
    { factoryId: row.factoryId, id: row.id },
    { enabled: open && !c.demo, staleTime: Infinity, retry: false },
  );
  const detail = c.demo
    ? c.state?.factoryActivity.find((a) => a.id === row.id)
    : query.data;
  return (
    <details className="mt-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-info">View changes</summary>
      {open && (
        <div className="mt-2 grid gap-2">
          {query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : detail ? (
            (["before", "after"] as const).map((k) => (
              <div key={k}>
                <p className="mb-1 font-medium capitalize">{k}</p>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[10px]">
                  {JSON.stringify(detail[k], null, 2) ?? "—"}
                </pre>
              </div>
            ))
          ) : (
            <p>Loading change…</p>
          )}
        </div>
      )}
    </details>
  );
}
