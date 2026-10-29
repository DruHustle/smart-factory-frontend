import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import { Box, Expand, Layers, ArrowUpRight } from "lucide-react";
import { layoutFactory, type FloorLink } from "@shared/factory-floor";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FloorPlan } from "./FactoryFloorPlan";
import { StatusBadge } from "./Primitives";
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
}: {
  items: InventoryItem[];
  links: FloorLink[];
  selected: string | null;
  onSelect: (ref: string) => void;
  returnTo: string;
  demo: boolean;
}) {
  const { theme } = useTheme();
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
  const layout = useMemo(() => layoutFactory(visible), [visible]);
  const active = items.find((item) => item.ref === selected);
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
            onChange={(e) => setZone(e.target.value)}
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
          />
        ) : (
          <FloorSceneBoundary
            fallback={
              <FloorPlan
                layout={layout}
                links={links}
                selected={selected}
                onSelect={onSelect}
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
          className="flex flex-wrap items-center justify-between gap-3 border-t bg-info/5 px-4 py-3"
          aria-label="Selected floor item"
        >
          <div className="min-w-0">
            <strong className="block break-words text-sm">{active.name}</strong>
            <span className="text-xs text-muted-foreground">
              {active.zone || active.location || "Unassigned"} ·{" "}
              {active.itemType.replaceAll("_", " ")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{active.mode} evidence</Badge>
            <StatusBadge status={active.status} />
            <Button asChild size="sm">
              <Link href={itemHref(active.ref, "overview", returnTo)}>
                Open item <ArrowUpRight className="size-3.5" />
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
