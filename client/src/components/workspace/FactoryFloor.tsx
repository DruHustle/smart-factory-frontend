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
import { Box, Expand, Layers, ArrowUpRight } from "lucide-react";
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
  type FloorInteraction,
  type FloorOffsets,
} from "./floor-arrangement";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FloorPlan } from "./FactoryFloorPlan";
import { SampleTime, StatusBadge } from "./Primitives";
import { ObservationValues } from "./ObservationValues";
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
}) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const preferenceKey =
    arrangementKey ??
    `smart-factory:floor-arrangement:v1:${user?.id ?? "anonymous"}:${user?.access?.workspaceView ?? (demo ? "demo" : "live")}`;
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
  const [interaction, setInteraction] = useState<FloorInteraction>(
    layoutDocument ? "item" : "orbit",
  );
  const [view, setView] = useState<"3d" | "plan">("3d"),
    [zone, setZone] = useState("all"),
    [reset, setReset] = useState(0),
    [search, setSearch] = useState("");
  const zones = [
    ...new Set(
      items.map(
        (item) => item.zone?.trim() || item.location?.trim() || "Unassigned",
      ),
    ),
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
  const baseLayout = useMemo(
    () =>
      layoutDocument
        ? factoryLayoutGeometry(layoutDocument, visible)
        : layoutFactory(visible),
    [visible, layoutDocument],
  );
  const layout = useMemo(
    () => (layoutDocument ? baseLayout : arrangeFloor(baseLayout, offsets)),
    [baseLayout, offsets, layoutDocument],
  );
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
  useEffect(() => {
    const changed = previousSelection.current !== selected;
    previousSelection.current = selected;
    if (changed && selected && !layoutDocument && interaction !== "item")
      details.current?.scrollIntoView({ block: "nearest" });
  }, [selected, !!layoutDocument, interaction]);
  return (
    <section
      className="overview-floor min-w-0 overflow-hidden rounded-lg border bg-card"
      aria-label="Factory floor overview"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Box className="size-4 text-info" />
            Factory floor
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {visible.length} of {items.length} items shown · {zones.length}{" "}
            zones {demo && "· Simulated installation"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Factory floor zone"
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              onSelect("");
            }}
            className="workspace-control h-9 w-auto max-w-44"
          >
            <option value="all">Whole factory</option>
            {zones.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div
            className="inline-flex rounded-md border p-0.5"
            role="group"
            aria-label="Floor representation"
          >
            {(["3d", "plan"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={view === mode ? "default" : "ghost"}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className="h-8 gap-1 px-2"
              >
                {mode === "3d" ? (
                  <Box className="size-3.5" />
                ) : (
                  <Layers className="size-3.5" />
                )}
                {mode === "3d" ? "3D floor" : "Floor plan"}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Fit whole factory floor"
            onClick={() => {
              setZone("all");
              setReset((n) => n + 1);
            }}
          >
            <Expand className="size-4" />
          </Button>
        </div>
      </div>
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">
        Tap or click equipment to view its details. Choose a zone to inspect
        that section.
      </p>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div
          role="group"
          aria-label="Floor interaction"
          className="flex flex-wrap gap-1"
        >
          {(
            [
              ["orbit", "Rotate view"],
              ["pan", "Move floor"],
              ["item", "Move item"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              size="sm"
              variant={interaction === mode ? "default" : "outline"}
              aria-pressed={interaction === mode}
              onClick={() => setInteraction(mode)}
              className="min-h-11"
            >
              {mode === "orbit" && view === "plan" ? "Select items" : label}
            </Button>
          ))}
        </div>
        {!layoutDocument && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={!Object.keys(offsets).length}
            onClick={() => {
              safeLocalStorage.removeItem(preferenceKey);
              setSaved({ key: preferenceKey, offsets: {} });
              setReset((n) => n + 1);
            }}
          >
            Reset arrangement
          </Button>
        )}
        <p className="basis-full text-xs text-muted-foreground">
          {interaction === "item"
            ? "Drag an item to rearrange this view. Keyboard: select an item, focus the floor and use arrow keys."
            : interaction === "pan"
              ? "Grab and drag to move the whole floor view. Use Fit to return to the factory."
              : view === "plan"
                ? "Tap or click an item for details."
                : "Drag to rotate the view. Tap or click an item for details."}
        </p>
      </div>
      {zone !== "all" && (
        <div
          className="border-b bg-info/5 px-4 py-3"
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
        className="overview-floor-viewport relative h-[21rem] min-w-0"
        data-testid="factory-floor"
        data-total-items={items.length}
        data-visible-items={visible.length}
      >
        {view === "plan" ? (
          <FloorPlan
            layout={layout}
            links={links}
            selected={selected}
            onSelect={onSelect}
            interaction={interaction}
            onMove={moveItem}
            reset={reset}
          />
        ) : (
          <FloorSceneBoundary
            fallback={
              <FloorPlan
                layout={layout}
                links={links}
                selected={selected}
                onSelect={onSelect}
                interaction={interaction}
                onMove={moveItem}
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
                  onSelect={onSelect}
                  interaction={interaction}
                  onMove={moveItem}
                  reset={reset}
                />
              }
            >
              <Scene
                layout={layout}
                links={links}
                selected={selected}
                onSelect={onSelect}
                dark={theme === "dark"}
                reset={reset}
                zone={zone}
                interaction={interaction}
                onMove={moveItem}
              />
            </Suspense>
          </FloorSceneBoundary>
        )}
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
      </div>
      {active && (
        <div
          ref={details}
          className="scroll-mt-20 space-y-3 border-t bg-info/5 px-4 py-3"
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          {visible.length} of {items.length} items shown · Illustrative layout
        </span>
        <Link
          href="/inventory"
          className="inline-flex min-h-8 items-center gap-1 text-foreground underline"
        >
          Explore assets <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <details className="border-t px-4 py-2">
        <summary className="cursor-pointer text-xs font-medium">
          Find an item · {items.length} available
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
