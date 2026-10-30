import { FactorySelector } from "@/components/workspace/FactorySelector";
import { FactoryWorkspace } from "@/components/workspace/FactoryWorkspace";
import { useFactorySelection } from "@/lib/factory-selection";
import { currentSample } from "@shared/measurements";
import { EquipmentSymbol } from "@/components/workspace/VisualEvidence";
import { loadEquipmentRenderer } from "@/components/equipment/loadRenderer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  metrics,
  measurementValue,
  measurementUnit,
} from "@shared/measurements";
import { Measurement } from "@/components/workspace/Primitives";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { safeLocalStorage } from "@/lib/storage";
import {
  PageHeader,
  SectionNav,
  EmptyState,
  FilterToolbar,
  StatusBadge,
  SampleTime,
} from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  X,
  Box,
} from "lucide-react";
import CreateDeviceDialog from "@/components/CreateDeviceDialog";
import { CreateAssetDialog } from "@/components/CreateAssetDialog";
import type { InventoryItem } from "@shared/inventory";
import { itemHref } from "@shared/inventory";
const views = [
  { id: "all", label: "All items" },
  { id: "assets", label: "Assets" },
  { id: "devices", label: "IoT devices" },
  { id: "gateways", label: "Gateways" },
  { id: "equipment", label: "3D equipment" },
];
export default function Inventory() {
  const { id } = useFactorySelection();
  return id ? (
    <FactoryWorkspace key={id} id={id} mode="inventory" />
  ) : (
    <LegacyInventory />
  );
}
function LegacyInventory() {
  const { user } = useAuth();
  const active = useDocumentActive();
  const [location, navigate] = useHashLocation();
  const restoredSelection = useRef<string | null>(null);
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const key = `inventory:${user?.id}`;
  const [add, setAdd] = useState(false);
  const [deviceType, setDeviceType] = useState<"gateway" | "sensor" | null>(
    null,
  );
  const [assetOpen, setAssetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({
    zone: "",
    status: "all",
    mode: "all",
    capability: "all",
    sort: "name",
  });
  const filter = {
    search: params.get("search") ?? "",
    view: (params.get("view") ?? "all") as "all",
    zone: params.get("zone") ?? "",
    status: (params.get("status") ?? "all") as "all",
    mode: (params.get("mode") ?? "all") as "all",
    capability: (params.get("capability") ?? "all") as "all",
    sort: (params.get("sort") ?? "name") as "name",
    page: Math.max(0, Number(params.get("page")) || 0),
    pageSize: 25,
  };
  useEffect(() => {
    if (location === "/inventory") {
      const saved = safeLocalStorage.getItem(key);
      if (saved?.startsWith("/inventory?")) navigate(saved, { replace: true });
    }
  }, []);
  const settledSearch = useDebouncedValue(filter.search);
  const result = trpc.inventory.list.useQuery(
    { ...filter, search: settledSearch },
    {
      retry: false,
      placeholderData: (previous) => previous,
      refetchInterval: active ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const utils = trpc.useUtils();
  function update(values: Record<string, string | number>) {
    const p = new URLSearchParams(params);
    p.delete("page");
    p.delete("selected");
    for (const [k, v] of Object.entries(values)) {
      if (v === "all" || v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    const next = "/inventory" + (p.size ? "?" + p : "");
    safeLocalStorage.setItem(key, next);
    navigate(next);
  }
  const filterLabels: Record<string, string> = {
    zone: "Zone",
    status: "Status",
    mode: "Mode",
    capability: "Capability",
    sort: "Sort",
  };
  const activeFilters = Object.entries({
    zone: filter.zone,
    status: filter.status,
    mode: filter.mode,
    capability: filter.capability,
    sort: filter.sort,
  }).filter(
    ([field, value]) =>
      value !== "" &&
      value !== "all" &&
      !(field === "sort" && value === "name"),
  );
  const clear = () => {
    safeLocalStorage.removeItem(key);
    navigate("/inventory");
  };
  const selected = params.get("selected");
  const returnUrl = (item: InventoryItem) => {
    const p = new URLSearchParams(params);
    p.set("selected", item.ref);
    return "/inventory?" + p;
  };
  const href = (item: InventoryItem) =>
    itemHref(item.ref, "overview", returnUrl(item));
  const remember = (item: InventoryItem) => {
    const u = new URL(window.location.href);
    u.hash = returnUrl(item);
    window.history.replaceState(window.history.state, "", u);
  };
  useEffect(() => {
    if (!selected || restoredSelection.current === selected || !result.data)
      return;
    const frame = requestAnimationFrame(() => {
      const desktop = document.getElementById("inventory-desktop-" + selected),
        mobile = document.getElementById("inventory-mobile-" + selected);
      const link = desktop?.getClientRects().length ? desktop : mobile;
      if (link?.getClientRects().length) {
        link.focus();
        restoredSelection.current = selected;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, result.data]);
  const count = (id: string) =>
    result.data?.groups.reduce(
      (n, g) =>
        n +
        (id === "all" ||
        (id === "assets" && g.kind === "asset") ||
        (id === "devices" && g.kind === "device" && g.itemType !== "gateway") ||
        (id === "gateways" &&
          g.kind === "device" &&
          g.itemType === "gateway") ||
        (id === "equipment" && g.equipment)
          ? Number(g.count)
          : 0),
      0,
    );
  return (
    <div className="min-w-0 space-y-[var(--workspace-gap)]">
      <PageHeader
        title="Assets & devices"
        description="Find equipment, inspect observations and open the right workspace."
        action={
          <>
            <FactorySelector />
            <Button asChild variant="outline">
              <Link
                href="/models"
                onPointerEnter={() =>
                  void loadEquipmentRenderer().catch(() => {})
                }
                onFocus={() => void loadEquipmentRenderer().catch(() => {})}
              >
                <Box className="mr-2 size-4" />
                Factory models
              </Link>
            </Button>
            {user?.access?.canEngineer && (
              <>
                <Button
                  variant="outline"
                  aria-label="Export AutomationML"
                  onClick={() =>
                    window.location.assign("/api/assets/export/automationml")
                  }
                >
                  Export AutomationML
                </Button>
                <Button onClick={() => setAdd(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add item
                </Button>
              </>
            )}
          </>
        }
      />
      <SectionNav
        label="Inventory views"
        sections={views.map((v) => ({
          ...v,
          label: `${v.label}${count(v.id) != null ? ` (${count(v.id)})` : ""}`,
        }))}
        value={filter.view}
        onChange={(view) => update({ view })}
      >
        <FilterToolbar>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search inventory</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            />
            <Input
              aria-label="Search inventory"
              className="pl-9 pr-10"
              value={filter.search}
              maxLength={200}
              placeholder="Search name or identifier"
              onChange={(event) => update({ search: event.target.value })}
            />
            {!!filter.search && (
              <button
                type="button"
                className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Clear search"
                onClick={() => update({ search: "" })}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setDraft({
                zone: filter.zone,
                status: filter.status,
                mode: filter.mode,
                capability: filter.capability,
                sort: filter.sort,
              });
              setFiltersOpen(true);
            }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters{activeFilters.length ? ` (${activeFilters.length})` : ""}
          </Button>
        </FilterToolbar>
        {!!activeFilters.length && (
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Active inventory filters"
          >
            {activeFilters.map(([field, value]) => (
              <Button
                key={field}
                variant="secondary"
                size="sm"
                aria-label={`Clear ${filterLabels[field]} filter`}
                onClick={() =>
                  update({ [field]: field === "sort" ? "name" : "" })
                }
              >
                {filterLabels[field]}: {value}
                <X className="h-3 w-3" />
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear filters
            </Button>
          </div>
        )}
        {result.isLoading ? (
          <EmptyState title="Loading inventory…" />
        ) : result.error ? (
          <EmptyState
            error
            title="Inventory unavailable"
            description={result.error.message}
            action={
              <Button variant="outline" onClick={() => void result.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <p
              role="status"
              aria-label="Inventory results"
              className="text-xs text-muted-foreground"
              aria-live="polite"
            >
              {result.isFetching ? "Updating inventory · " : ""}
              {result.data?.total ?? 0} items
            </p>
            {!result.data?.items.length ? (
              <EmptyState
                title={
                  params.size ? "No matching items" : "No inventory items yet"
                }
                description={
                  params.size
                    ? "Clear filters or search another identifier."
                    : "Register a device, import an AAS or add local 3D equipment."
                }
              />
            ) : (
              <>
                <div className="hidden rounded-lg border bg-card lg:block">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        {[
                          "Item",
                          "Location / route",
                          "Observed status",
                          "Latest sample",
                          "Capabilities",
                          "",
                        ].map((x, i) => (
                          <th
                            className={`p-3 font-medium ${i === 0 ? "w-[27%]" : i === 5 ? "w-12" : ""}`}
                            key={i}
                          >
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((item) => (
                        <tr
                          data-selected={selected === item.ref || undefined}
                          className={`border-b last:border-0 hover:bg-muted/30 ${selected === item.ref ? "bg-primary/10" : ""}`}
                          key={item.ref}
                        >
                          <td className="p-3">
                            <Link
                              id={"inventory-desktop-" + item.ref}
                              aria-label={item.name}
                              onClick={() => remember(item)}
                              className="inline-flex items-center gap-2 font-medium text-foreground underline-offset-4 hover:underline"
                              href={href(item)}
                            >
                              <EquipmentSymbol
                                type={item.itemType}
                                className="size-6 text-info"
                              />
                              {item.name}
                            </Link>
                            <p
                              title={item.identifier}
                              className="mt-1 truncate text-xs text-muted-foreground"
                            >
                              {item.itemType.replaceAll("_", " ")} ·{" "}
                              {item.identifier}
                            </p>
                          </td>
                          <td className="p-3">
                            <p>
                              {[item.zone, item.location]
                                .filter(Boolean)
                                .join(" · ") || "Unspecified location"}
                            </p>
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {item.route}
                            </p>
                          </td>
                          <td className="p-3">
                            <StatusBadge status={item.status} />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.configured
                                ? "Connection configured"
                                : "No configured connection"}
                            </p>
                          </td>
                          <td className="p-3 text-xs">
                            <ItemMeasurements item={item} />
                            <SampleTime
                              value={item.sampleAt}
                              historical={!currentSample(item)}
                            />
                            <p className="mt-1 capitalize">
                              {item.mode} evidence
                            </p>
                          </td>
                          <td className="p-3">
                            <Capabilities item={item} />
                          </td>
                          <td className="p-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Actions for ${item.name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link
                                    onClick={() => remember(item)}
                                    href={href(item)}
                                  >
                                    Open workspace
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    void navigator.clipboard.writeText(
                                      item.identifier,
                                    )
                                  }
                                >
                                  Copy full identifier
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-3 lg:hidden">
                  {result.data.items.map((item) => (
                    <article
                      data-selected={selected === item.ref || undefined}
                      className={`space-y-2 rounded-lg border bg-card p-4 ${selected === item.ref ? "border-primary" : ""}`}
                      key={item.ref}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            id={"inventory-mobile-" + item.ref}
                            aria-label={item.name}
                            onClick={() => remember(item)}
                            href={href(item)}
                            className="flex items-start gap-2 break-words font-semibold"
                          >
                            <EquipmentSymbol
                              type={item.itemType}
                              className="size-6 text-info"
                            />
                            {item.name}
                          </Link>
                          <p
                            title={item.identifier}
                            className="mt-1 truncate text-xs text-muted-foreground"
                          >
                            {item.itemType.replaceAll("_", " ")} ·{" "}
                            {item.identifier}
                          </p>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <Link
                            onClick={() => remember(item)}
                            href={href(item)}
                          >
                            Open
                          </Link>
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="text-xs text-muted-foreground">
                          {item.zone || item.location || item.route}
                        </span>
                      </div>
                      <ItemMeasurements item={item} />
                      <p className="text-xs">
                        <SampleTime
                          value={item.sampleAt}
                          historical={!currentSample(item)}
                        />{" "}
                        · <span className="capitalize">{item.mode}</span>
                      </p>
                      <Capabilities item={item} />
                    </article>
                  ))}
                </div>
              </>
            )}
            <nav
              aria-label="Inventory pagination"
              className="flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={!filter.page || result.isFetching}
                onClick={() => update({ page: filter.page - 1 })}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {filter.page + 1} of{" "}
                {Math.max(1, Math.ceil((result.data?.total ?? 0) / 25))}
              </span>
              <Button
                variant="outline"
                disabled={
                  result.isFetching ||
                  (filter.page + 1) * 25 >= (result.data?.total ?? 0)
                }
                onClick={() => update({ page: filter.page + 1 })}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </SectionNav>
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Filter inventory</DialogTitle>
            <DialogDescription>
              Narrow the current view by location, evidence and capability.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium">
              Zone
              <Input
                aria-label="Filter zone"
                value={draft.zone}
                onChange={(event) =>
                  setDraft({ ...draft, zone: event.target.value })
                }
              />
            </label>
            {(
              [
                [
                  "status",
                  "Observed status",
                  [
                    "all",
                    "live",
                    "stale",
                    "offline",
                    "unknown",
                    "maintenance",
                    "error",
                  ],
                ],
                [
                  "mode",
                  "Evidence mode",
                  ["all", "live", "simulated", "replay", "unknown"],
                ],
                ["capability", "Capability", ["all", "aas", "3d"]],
                ["sort", "Sort", ["name", "recent"]],
              ] as const
            ).map(([field, label, options]) => (
              <label key={field} className="space-y-1 text-xs font-medium">
                {label}
                <select
                  aria-label={label}
                  className="block workspace-control"
                  value={draft[field]}
                  onChange={(event) =>
                    setDraft({ ...draft, [field]: event.target.value })
                  }
                >
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {value === "all"
                        ? "All"
                        : value === "name"
                          ? "Name A–Z"
                          : value === "recent"
                            ? "Newest observation"
                            : value === "unknown"
                              ? "Unknown / unclassified"
                              : value === "aas"
                                ? "AAS"
                                : value === "3d"
                                  ? "3D equipment"
                                  : value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                setDraft({
                  zone: "",
                  status: "all",
                  mode: "all",
                  capability: "all",
                  sort: "name",
                })
              }
            >
              Reset filters
            </Button>
            <Button
              onClick={() => {
                update(draft);
                setFiltersOpen(false);
              }}
            >
              Apply filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={add} onOpenChange={setAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an item</DialogTitle>
            <DialogDescription>
              Choose the record you need. Representations and connectivity can
              be added separately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {[
              [
                "IoT device",
                "A standalone sensor, actuator, controller or edge device. No AAS required.",
                () => setDeviceType("sensor"),
              ],
              [
                "Gateway",
                "A connectivity device serving one or more items.",
                () => setDeviceType("gateway"),
              ],
              [
                "AAS-backed asset",
                "Create an engineering record or import an AASX package.",
                () => setAssetOpen(true),
              ],
              [
                "3D equipment",
                "Create local equipment or import a model. Onesa is optional.",
                () => navigate("/equipment?setup=1"),
              ],
            ].map(([name, desc, fn]) => (
              <Button
                key={String(name)}
                variant="outline"
                className="h-auto justify-start whitespace-normal p-4 text-left"
                onClick={() => {
                  setAdd(false);
                  (fn as () => void)();
                }}
              >
                <span>
                  <strong className="block">{name as string}</strong>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {desc as string}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <CreateDeviceDialog
        key={deviceType ?? "closed"}
        initialType={deviceType ?? "sensor"}
        open={!!deviceType}
        onOpenChange={(v) => {
          if (!v) setDeviceType(null);
        }}
        onCreated={(d) => {
          void utils.inventory.invalidate();
          navigate(itemHref(`device:${d.id}`, "overview", location));
        }}
      />
      <CreateAssetDialog open={assetOpen} onOpenChange={setAssetOpen} />
    </div>
  );
}
function ItemMeasurements({ item }: { item: InventoryItem }) {
  const reading = { ...item.values, measurements: item.measurements },
    available = metrics.filter(
      (m) => reading[m] != null || item.measurements?.[m],
    );
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
      {available.slice(0, 2).map((m) => (
        <span key={m} className="text-sm" title={m}>
          <span className="sr-only">{m}: </span>
          <Measurement
            value={measurementValue(reading, m)}
            unit={measurementUnit(reading, m)}
          />
        </span>
      ))}
    </div>
  );
}
function Capabilities({ item }: { item: InventoryItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {item.aas && <Badge variant="secondary">AAS</Badge>}
      {item.equipmentId && <Badge variant="secondary">3D</Badge>}
      {item.lifecycle && (
        <span className="text-xs capitalize text-muted-foreground">
          {item.lifecycle}
        </span>
      )}
      {!item.aas && !item.equipmentId && (
        <span className="text-xs text-muted-foreground">No AAS / 3D</span>
      )}
    </div>
  );
}
