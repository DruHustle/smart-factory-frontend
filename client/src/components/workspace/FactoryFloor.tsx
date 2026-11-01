import type { PhysicalDimensions } from "@shared/named-factory";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import {
  Box,
  Focus,
  Layers,
  ArrowUpRight,
  RotateCcw,
  Maximize2,
  Minimize2,
  Trash2,
  Workflow,
  Cable,
} from "lucide-react";
import { layoutFactory, type FloorLink } from "@shared/factory-floor";
import { currentSample } from "@shared/measurements";
import {
  factoryLayoutGeometry,
  type FactoryLayoutDocument,
} from "@shared/factory-layout";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { safeLocalStorage } from "@/lib/storage";
import {
  arrangeFloor,
  readFloorOffsets,
  type FloorOffsets,
  type FloorLayout,
} from "./floor-arrangement";
import type { FloorDrag } from "./floor-arrangement";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FloorPlan } from "./FactoryFloorPlan";
import {
  FactoryConnectionEditor,
  useConnectionAppearances,
} from "./FactoryConnectionEditor";
import { useFloorFullscreen } from "./useFloorFullscreen";
import { SampleTime, StatusBadge } from "./Primitives";
import { ObservationValues } from "./ObservationValues";
import { FactorySchematic } from "./FactorySchematic";
import {
  FactoryDiagramEditor,
  DiagramConnectionDetails,
} from "./FactoryDiagramEditor";
import { useFactoryDiagram } from "./useFactoryDiagram";
import { EngineeringDrawingExport } from "./EngineeringDrawingExport";
const Scene = lazy(() => import("./FactoryFloorScene"));
class FloorSceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function FactoryFloor({
  items,
  links,
  selected,
  onSelect,
  returnTo,
  demo,
  layoutDocument,
  onLayoutMove,
  arrangementKey,
  diagramScopeKey,
  headerActions,
  editor,
  onGrabStart,
  onInventoryDelete,
  movable = true,
  itemDimensions,
  measured = false,
  onGrabChange,
}: {
  items: InventoryItem[];
  links: FloorLink[];
  selected: string | null;
  onSelect: (ref: string) => void;
  returnTo: string;
  demo: boolean;
  layoutDocument?: FactoryLayoutDocument;
  onLayoutMove?: (ref: string, x: number, z: number) => void;
  arrangementKey?: string;
  diagramScopeKey?: string;
  headerActions?: ReactNode;
  editor?: ReactNode;
  onGrabStart?: () => void;
  onInventoryDelete?: (ref: string) => Promise<void>;
  movable?: boolean;
  itemDimensions?: Record<string, PhysicalDimensions>;
  measured?: boolean;
  onGrabChange?: (active: boolean) => void;
}) {
  const { theme } = useTheme();
  const fullscreen = useFloorFullscreen();
  const { user } = useAuth();
  const preferenceKey =
    arrangementKey ??
    `smart-factory:floor-arrangement:v1:${user?.id ?? "anonymous"}:${user?.access?.workspaceView ?? (demo ? "demo" : "live")}`;
  // Visual routing is browser-local and isolated by account, workspace and factory/study.
  const routingScope = JSON.stringify([
    user?.id ?? "anonymous",
    user?.access?.workspaceView ?? (demo ? "demo" : "live"),
    arrangementKey ?? layoutDocument?.name ?? "overview",
  ]);
  const connectionRoutes = useConnectionAppearances(routingScope);
  const drawingScope = JSON.stringify([
    user?.id ?? "anonymous",
    user?.access?.workspaceView ?? (demo ? "demo" : "live"),
    diagramScopeKey ?? arrangementKey ?? layoutDocument?.name ?? "overview",
  ]);
  const [saved, setSaved] = useState<{ key: string; offsets: FloorOffsets }>(
    () => ({
      key: preferenceKey,
      offsets: readFloorOffsets(safeLocalStorage.getItem(preferenceKey)),
    }),
  );
  const offsets = useMemo(
    () =>
      saved.key === preferenceKey
        ? saved.offsets
        : readFloorOffsets(safeLocalStorage.getItem(preferenceKey)),
    [saved, preferenceKey],
  );
  const [view, setView] = useState<"3d" | "plan" | "process" | "electrical">(
      "3d",
    ),
    [zone, setZone] = useState("all"),
    [reset, setReset] = useState(0),
    [search, setSearch] = useState("");
  const schematic = view === "process" || view === "electrical";
  const diagram = useFactoryDiagram({
    scope: drawingScope,
    mode: view === "electrical" ? "electrical" : "process",
    items,
    links,
    demo,
  });
  const [selectedConnection, setSelectedConnection] = useState<string | null>(
    null,
  );
  useEffect(() => {
    setSelectedConnection(null);
  }, [view, drawingScope]);
  const zones = [
    ...new Set([
      ...(layoutDocument?.zones.map((zone) => zone.name) ?? []),
      ...items.map(
        (item) => item.zone?.trim() || item.location?.trim() || "Unassigned",
      ),
    ]),
  ].sort();
  const visible = useMemo(
    () =>
      zone === "all"
        ? items
        : items.filter(
            (i) =>
              (i.zone?.trim() || i.location?.trim() || "Unassigned") === zone,
          ),
    [items, zone],
  );
  const visibleRefs = useMemo(
    () => new Set(visible.map((item) => item.ref)),
    [visible],
  );
  const activeDiagramConnection = schematic
    ? diagram.document.connections.find(
        (link) =>
          link.id === selectedConnection &&
          visibleRefs.has(link.from) &&
          visibleRefs.has(link.to),
      )
    : undefined;
  const omittedConnections = diagram.document.connections.filter(
    (link) => !visibleRefs.has(link.from) || !visibleRefs.has(link.to),
  ).length;
  const baseLayout = useMemo(
    () =>
      layoutDocument
        ? factoryLayoutGeometry(layoutDocument, visible)
        : layoutFactory(visible),
    [visible, layoutDocument],
  );
  const layout = useMemo<FloorLayout>(() => {
    const placed = layoutDocument
      ? baseLayout
      : arrangeFloor(baseLayout, offsets);
    return {
      ...placed,
      measured,
      placements: placed.placements.map((p) => ({
        ...p,
        dimensions: itemDimensions?.[p.item.ref],
      })),
    };
  }, [baseLayout, offsets, layoutDocument, itemDimensions, measured]);
  const moveItem = (ref: string, x: number, z: number) => {
    if (onLayoutMove) {
      onLayoutMove(ref, x, z);
      return;
    }
    const original = baseLayout.placements.find((p) => p.item.ref === ref);
    if (!original || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const currentRefs = new Set(items.map((i) => i.ref));
    const next = Object.fromEntries(
      Object.entries(offsets).filter(([id]) => currentRefs.has(id)),
    );
    next[ref] = { x: x - original.x, z: z - original.z };
    setSaved({ key: preferenceKey, offsets: next });
    safeLocalStorage.setItem(preferenceKey, JSON.stringify(next));
  };
  const [grabbedRef, setGrabbedRef] = useState<string | null>(null);
  const grabRef = useRef<string | null>(null);
  const bin = useRef<HTMLButtonElement>(null);
  const [overBin, setOverBin] = useState(false);
  const [deleteRef, setDeleteRef] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteTarget = items.find((item) => item.ref === deleteRef);
  const requestDelete = onInventoryDelete
    ? (ref: string) => {
        setDeleteRef(ref);
        setDeleteError("");
      }
    : undefined;
  const hitsBin = (x: number, y: number) => {
    const rect = bin.current?.getBoundingClientRect();
    return (
      !!rect &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  };
  const itemDragged = (drag: FloorDrag) => {
    if ((drag?.ref ?? null) !== grabRef.current) {
      if (drag) onGrabStart?.();
      onGrabChange?.(!!drag);
      grabRef.current = drag?.ref ?? null;
      setGrabbedRef(drag?.ref ?? null);
    }
    setOverBin(
      !!drag && !!onInventoryDelete && hitsBin(drag.clientX, drag.clientY),
    );
  };
  const itemDropped = (ref: string, x: number, y: number) => {
    if (!requestDelete || !hitsBin(x, y)) return false;
    requestDelete(ref);
    return true;
  };
  const wasFullscreen = useRef(fullscreen.expanded);
  useEffect(() => {
    if (wasFullscreen.current && !fullscreen.expanded && !deleting)
      setDeleteRef(null);
    wasFullscreen.current = fullscreen.expanded;
  }, [fullscreen.expanded, deleting]);
  useEffect(() => {
    if (!onInventoryDelete && !deleting) setDeleteRef(null);
  }, [!!onInventoryDelete, deleting]);
  const active = items.find((item) => item.ref === selected);
  const details = useRef<HTMLDivElement>(null);
  const related = active
    ? items.filter((item) =>
        links.some(
          (link) =>
            (link.from === active.ref && link.to === item.ref) ||
            (link.to === active.ref && link.from === item.ref),
        ),
      )
    : [];
  const previousSelection = useRef<string | null>(null);
  const suppressDetails = useRef(false);
  const selectOnFloor = (ref: string, revealDetails = true) => {
    setSelectedConnection(null);
    suppressDetails.current = !revealDetails && ref !== selected;
    onSelect(ref);
  };
  useEffect(() => {
    const changed = previousSelection.current !== selected;
    previousSelection.current = selected;
    if (
      changed &&
      selected &&
      !layoutDocument &&
      !fullscreen.expanded &&
      !suppressDetails.current
    )
      details.current?.scrollIntoView({ block: "nearest" });
    suppressDetails.current = false;
  }, [selected, !!layoutDocument, fullscreen.expanded]);
  return (
    <section
      ref={fullscreen.panel}
      className={`overview-floor min-w-0 overflow-hidden rounded-lg border bg-card ${fullscreen.expanded ? "floor-expanded" : ""}`}
      role={fullscreen.expanded ? "dialog" : undefined}
      aria-modal={fullscreen.expanded || undefined}
      data-measured={measured}
      aria-label="Factory floor overview"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Box className="size-4 text-info" />
            Factory floor
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {visible.length} of {items.length} items shown ·{" "}
            {layoutDocument ? layoutDocument.zones.length : zones.length} zones{" "}
            {demo && "· Simulated installation"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {headerActions}
          <select
            aria-label="Factory floor zone"
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              onSelect("");
            }}
            className="workspace-control h-9 w-40 max-w-full shrink-0"
          >
            <option value="all">Whole factory</option>
            {zones.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="Fit whole factory floor"
              title="Fit whole factory floor"
              onClick={() => {
                setZone("all");
                setReset((n) => n + 1);
              }}
            >
              <Focus className="size-4" />
            </Button>
            <Button
              ref={fullscreen.button}
              size="icon"
              variant="outline"
              className="size-9"
              aria-label={
                fullscreen.expanded ? "Exit fullscreen" : "Enter fullscreen"
              }
              title={
                fullscreen.expanded
                  ? "Exit fullscreen (Esc)"
                  : "Enter fullscreen"
              }
              aria-pressed={fullscreen.expanded}
              aria-busy={fullscreen.pending}
              disabled={fullscreen.pending}
              onClick={() => void fullscreen.toggle()}
            >
              {fullscreen.expanded ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </Button>
            {!layoutDocument && !schematic && (
              <Button
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label="Reset arrangement"
                title="Reset arrangement"
                disabled={!Object.keys(offsets).length}
                onClick={() => {
                  safeLocalStorage.removeItem(preferenceKey);
                  setSaved({ key: preferenceKey, offsets: {} });
                  setReset((n) => n + 1);
                }}
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="border-b px-4 py-2">
        <div
          className="grid grid-cols-4 gap-1 rounded-md border p-1 sm:inline-flex"
          role="group"
          aria-label="Floor representation"
        >
          {(
            [
              { mode: "3d", label: "3D", name: "3D floor", Icon: Box },
              {
                mode: "plan",
                label: "Floor plan",
                name: "Floor plan",
                Icon: Layers,
              },
              {
                mode: "process",
                label: "Process / P&ID",
                name: "Process / P&ID",
                Icon: Workflow,
              },
              {
                mode: "electrical",
                label: "Electrical",
                name: "Electrical wiring",
                Icon: Cable,
              },
            ] as const
          ).map(({ mode, label, name, Icon }) => (
            <Button
              key={mode}
              size="sm"
              className="min-h-12 flex-col gap-1 px-1 text-xs sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-3"
              aria-label={name}
              title={name}
              variant={view === mode ? "default" : "ghost"}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">
                {mode === "process" ? "P&ID" : label}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        <details className="group min-w-0">
          <summary className="cursor-pointer rounded-sm text-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View controls
          </summary>
          <p className="mt-2 max-w-xl leading-relaxed">
            {schematic
              ? "Select equipment or a connection to inspect it. Hold and drag to pan; use the zoom controls or scroll to zoom."
              : movable
                ? "Hold and drag an item to move it, or empty floor to pan. Release to stop."
                : "Click equipment to inspect it; hold and drag to pan. Release to stop."}{" "}
            {view === "3d" &&
              "With Rotate on, click empty floor to start mouse rotation; click again to stop. Scroll or pinch to zoom."}
            {fullscreen.expanded && " · Esc to exit fullscreen."}
          </p>
        </details>
      </div>
      {view === "3d" && (
        <FactoryConnectionEditor
          links={links}
          layout={layout}
          controller={connectionRoutes}
        />
      )}
      {schematic && (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-1 border-b px-4 py-2 text-[11px] text-muted-foreground"
            aria-label="Diagram source"
          >
            <span>
              {diagram.source === "demo"
                ? "Illustrative demo diagram"
                : diagram.source === "registered"
                  ? "Registered process connections"
                  : diagram.source === "local"
                    ? "Local drawing"
                    : "No connections defined"}{" "}
              · Schematic, not to scale
            </span>
            {omittedConnections > 0 && (
              <span>
                {omittedConnections} connections outside the current equipment
                selection
              </span>
            )}
          </div>
          {diagram.error && (
            <p
              role="alert"
              className="border-b px-4 py-2 text-xs text-destructive"
            >
              {diagram.error}
            </p>
          )}
          <FactoryDiagramEditor
            key={diagram.key}
            controller={diagram}
            items={items}
            onSelectConnection={setSelectedConnection}
          />
          <EngineeringDrawingExport
            key={`cad-${diagram.key}`}
            controller={diagram}
            items={items}
          />
        </>
      )}
      {zone !== "all" && (
        <div
          className="floor-secondary border-b bg-info/5 px-4 py-3"
          aria-label="Selected factory section"
        >
          <h3 className="text-sm font-semibold">{zone}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {visible.length} registered items ·{" "}
            {visible.filter((item) => item.kind === "device").length} devices &
            gateways
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                "live",
                "stale",
                "offline",
                "unknown",
                "maintenance",
                "error",
              ] as const
            ).map((status) => {
              const count = visible.filter(
                (item) => item.status === status,
              ).length;
              return count ? (
                <span
                  key={status}
                  className="inline-flex items-center gap-1 text-xs"
                >
                  <StatusBadge status={status} /> {count}
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}
      <div
        className={`overview-floor-viewport relative min-w-0 ${measured ? "h-[24rem] sm:h-[32rem]" : "h-[21rem]"}`}
        data-testid="factory-floor"
        data-total-items={items.length}
        data-visible-items={visible.length}
        data-view={view}
      >
        {schematic ? (
          <FactorySchematic
            key={`${drawingScope}:${view}`}
            document={diagram.document}
            items={visible}
            selected={selected}
            onSelect={selectOnFloor}
            selectedConnection={activeDiagramConnection?.id ?? null}
            onSelectConnection={setSelectedConnection}
            reset={reset}
          />
        ) : view === "plan" ? (
          <FloorPlan
            layout={layout}
            links={links}
            selected={selected}
            onSelect={selectOnFloor}
            onMove={movable ? moveItem : undefined}
            onItemDrag={itemDragged}
            onItemDrop={onInventoryDelete ? itemDropped : undefined}
            onDelete={requestDelete}
            reset={reset}
          />
        ) : (
          <FloorSceneBoundary
            fallback={
              <FloorPlan
                layout={layout}
                links={links}
                selected={selected}
                onSelect={selectOnFloor}
                onMove={movable ? moveItem : undefined}
                onItemDrag={itemDragged}
                onItemDrop={onInventoryDelete ? itemDropped : undefined}
                onDelete={requestDelete}
                reset={reset}
              />
            }
          >
            <Suspense
              fallback={
                <FloorPlan
                  layout={layout}
                  links={links}
                  selected={selected}
                  onSelect={selectOnFloor}
                  onMove={movable ? moveItem : undefined}
                  onItemDrag={itemDragged}
                  onItemDrop={onInventoryDelete ? itemDropped : undefined}
                  onDelete={requestDelete}
                  reset={reset}
                />
              }
            >
              <Scene
                layout={layout}
                links={links}
                connectionAppearances={connectionRoutes.values}
                selected={selected}
                onSelect={selectOnFloor}
                dark={theme === "dark"}
                reset={reset}
                zone={zone}
                onMove={movable ? moveItem : undefined}
                onItemDrag={itemDragged}
                onItemDrop={onInventoryDelete ? itemDropped : undefined}
                onDelete={requestDelete}
              />
            </Suspense>
          </FloorSceneBoundary>
        )}
        {editor}
        {!schematic && onInventoryDelete && (grabbedRef || selected) && (
          <Button
            ref={bin}
            type="button"
            variant="outline"
            className={`absolute bottom-12 right-3 z-10 border-destructive/60 bg-background/95 text-destructive ${grabbedRef ? "h-16 min-w-32 border-2 border-dashed" : "size-10"} ${overBin ? "bg-destructive text-destructive-foreground ring-4 ring-destructive/20" : ""}`}
            aria-label="Delete selected item from factory inventory"
            title={
              grabbedRef
                ? "Drop to delete from factory inventory"
                : "Delete selected item from factory inventory"
            }
            data-floor-bin="true"
            data-drop-active={overBin ? "true" : "false"}
            onClick={() => requestDelete?.(grabbedRef ?? selected!)}
          >
            <Trash2 className="size-5" />
            {grabbedRef && <span className="text-xs">Drop to delete</span>}
          </Button>
        )}
        {!schematic && fullscreen.expanded && active && (
          <p
            aria-live="polite"
            className="pointer-events-none absolute bottom-12 left-3 max-w-[calc(100%-1.5rem)] rounded-md border bg-background/95 px-2 py-1 text-xs font-medium"
          >
            {active.name}
          </p>
        )}
        {!schematic && (
          <div
            className="pointer-events-none absolute bottom-3 left-3 right-3 flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-md border bg-background/95 px-2 py-1 text-[10px] text-muted-foreground"
            aria-label="Floor indicator legend"
          >
            {[
              ["#28a6c4", "Simulated"],
              ["#32b881", "Fresh source"],
              ["#dba64a", "Needs review"],
              ["#ef6461", "Reported error"],
              ["#8191a3", "Unknown"],
            ].map(([color, text]) => (
              <span key={text} className="inline-flex items-center gap-1">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {text}
              </span>
            ))}
          </div>
        )}
      </div>
      {activeDiagramConnection && (
        <DiagramConnectionDetails
          connection={activeDiagramConnection}
          items={visible}
          onSelect={selectOnFloor}
        />
      )}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteRef(null);
        }}
      >
        <AlertDialogContent container={fullscreen.panel.current}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.name} from{" "}
              {layoutDocument?.name ?? "factory inventory"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the item from the floor and inventory. Its activity
              history is retained. Disconnect linked devices before deleting
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-xs text-muted-foreground">
            {deleteTarget?.factoryTag ?? deleteTarget?.identifier}
          </p>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep item</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || !onInventoryDelete}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget || !onInventoryDelete) return;
                setDeleting(true);
                setDeleteError("");
                try {
                  await onInventoryDelete(deleteTarget.ref);
                  setDeleteRef(null);
                } catch (error) {
                  setDeleteError(
                    error instanceof Error
                      ? error.message
                      : "The item could not be deleted.",
                  );
                } finally {
                  setDeleting(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete inventory item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {active && (
        <div
          ref={details}
          className="floor-secondary scroll-mt-20 space-y-3 border-t bg-info/5 px-4 py-3"
          aria-label="Selected floor item"
        >
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Selected equipment or device
            </p>
            <h3
              className="mt-1 break-words text-base font-semibold"
              aria-live="polite"
            >
              {active.name}
            </h3>
            <span className="text-xs text-muted-foreground">
              {active.zone || active.location || "Unassigned"} ·{" "}
              {active.itemType.replaceAll("_", " ")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{active.mode} evidence</Badge>
            <StatusBadge status={active.status} />
            <Button asChild size="sm">
              <Link
                href={
                  active.sandbox
                    ? `/sandbox?tab=inventory&item=${encodeURIComponent(active.ref)}`
                    : itemHref(active.ref, "overview", returnTo)
                }
              >
                {active.sandbox ? "Open demo item" : "Open item"}{" "}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
            {active.equipmentId && (
              <Button asChild size="sm" variant="outline">
                <Link href={itemHref(active.ref, "3d", returnTo)}>
                  Inspect 3D
                </Link>
              </Button>
            )}
          </div>
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground">Identifier</dt>
              <dd className="mt-1 break-all">{active.identifier}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Configuration</dt>
              <dd className="mt-1">
                {active.configured ? "Connection configured" : "Not configured"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last observation</dt>
              <dd className="mt-1">
                <SampleTime
                  value={active.sampleAt}
                  historical={!currentSample(active)}
                />{" "}
                · {active.quality} quality
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lifecycle</dt>
              <dd className="mt-1">{active.lifecycle || "Not reported"}</dd>
            </div>
          </dl>
          <ObservationValues
            reading={{
              ...active.values,
              measurements: active.measurements,
              integration: { sourceQuality: active.quality },
            }}
          />
          <div aria-label="Selected item connections">
            <p className="text-xs font-medium">
              Connected items · {related.length}
            </p>
            {related.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {related.map((item) => (
                  <li key={item.ref}>
                    <button
                      className="min-h-11 rounded-md border bg-background px-3 py-2 text-left text-xs hover:border-info"
                      onClick={() => onSelect(item.ref)}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No registered connections for this item.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="floor-secondary flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          {schematic
            ? "Engineering schematic"
            : measured
              ? "Measured floor"
              : "Illustrative layout"}
        </span>
        <Link
          href="/inventory"
          className="inline-flex min-h-8 items-center gap-1 text-foreground underline"
        >
          Explore assets <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <details className="floor-secondary border-t px-4 py-2">
        <summary className="cursor-pointer text-xs font-medium">
          Find an item · {items.length}
        </summary>
        <div className="mt-3 space-y-2">
          <input
            aria-label="Find a factory floor item"
            className="workspace-control"
            placeholder="Search every floor item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul
            className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Factory floor items"
          >
            {items
              .filter((i) =>
                `${i.name} ${i.identifier}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => (
                <li key={item.ref}>
                  <button
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs hover:bg-muted ${selected === item.ref ? "border-info bg-info/5" : ""}`}
                    aria-label={item.name}
                    aria-pressed={selected === item.ref}
                    onClick={() => {
                      setZone("all");
                      onSelect(item.ref);
                    }}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
