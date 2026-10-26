import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { canViewEngineering } from "@/lib/access";
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
import { MoreHorizontal, Plus } from "lucide-react";
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
  const { user } = useAuth();
  const [location, navigate] = useHashLocation();
  const restoredSelection = useRef<string | null>(null);
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const key = `inventory:${user?.id}`;
  const [add, setAdd] = useState(false);
  const [deviceType, setDeviceType] = useState<"gateway" | "sensor" | null>(
    null,
  );
  const [assetOpen, setAssetOpen] = useState(false);
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
  const result = trpc.inventory.list.useQuery(filter, {
    retry: false,
    refetchInterval: 30000,
  });
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
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Assets & devices"
        description="One inventory. Explicit connections, digital representations and observed evidence."
        action={
          canViewEngineering(user?.role) && (
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
          )
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
          <label className="basis-full flex-1 text-xs sm:basis-48">
            Search inventory
            <Input
              aria-label="Search inventory"
              value={filter.search}
              placeholder="Name or full identifier"
              onChange={(e) => update({ search: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Zone
            <Input
              aria-label="Filter zone"
              className="w-32"
              value={filter.zone}
              onChange={(e) => update({ zone: e.target.value })}
            />
          </label>
          {[
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
          ].map(([field, label, options]) => (
            <label className="text-xs" key={String(field)}>
              {label}
              <select
                aria-label={String(label)}
                className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm"
                value={filter[field as keyof typeof filter]}
                onChange={(e) => update({ [String(field)]: e.target.value })}
              >
                {(options as string[]).map((o) => (
                  <option key={o} value={o}>
                    {o === "all"
                      ? "All"
                      : o === "recent"
                        ? "Newest samples"
                        : o === "name"
                          ? "Name A–Z"
                          : o.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              safeLocalStorage.removeItem(key);
              navigate("/inventory");
            }}
          >
            Clear filters
          </Button>
        </FilterToolbar>
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
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {result.data?.total ?? 0} matching items · View filters overlap;
              3D is a capability.
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
                <div className="hidden rounded-lg border bg-card md:block">
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
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                              href={href(item)}
                            >
                              {item.name}
                            </Link>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {item.itemType} · {item.identifier}
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
                            <SampleTime
                              value={item.sampleAt}
                              historical={item.status !== "live"}
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
                <div className="space-y-3 md:hidden">
                  {result.data.items.map((item) => (
                    <article
                      data-selected={selected === item.ref || undefined}
                      className={`space-y-3 rounded-lg border bg-card p-4 ${selected === item.ref ? "border-primary" : ""}`}
                      key={item.ref}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            id={"inventory-mobile-" + item.ref}
                            aria-label={item.name}
                            onClick={() => remember(item)}
                            href={href(item)}
                            className="break-words font-semibold"
                          >
                            {item.name}
                          </Link>
                          <p className="break-all text-xs text-muted-foreground">
                            {item.itemType} · {item.identifier}
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
                      <StatusBadge status={item.status} />
                      <p className="text-sm text-muted-foreground">
                        {item.route} ·{" "}
                        {item.zone || item.location || "No location"}
                      </p>
                      <p className="text-xs">
                        <SampleTime
                          value={item.sampleAt}
                          historical={item.status !== "live"}
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
                disabled={!filter.page}
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
                disabled={(filter.page + 1) * 25 >= (result.data?.total ?? 0)}
                onClick={() => update({ page: filter.page + 1 })}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </SectionNav>
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
