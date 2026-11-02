import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Cable, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorLink } from "@shared/factory-floor";
import type { FloorLayout } from "./floor-arrangement";
import {
  connectionKey, defaultConnectionAppearance, MAX_ROUTE_POINTS,
  readConnectionAppearances, validateConnectionAppearance,
  type ConnectionAppearance, type ConnectionAppearances,
} from "./factory-connection-settings";

function load(key: string) {
  try {
    const result = readConnectionAppearances(localStorage.getItem(key));
    return { key, ...result, blocked: !!result.error };
  } catch {
    return { key, values: {} as ConnectionAppearances, blocked: false,
      error: "Browser storage is unavailable. Changes apply to this view but may not survive a refresh." };
  }
}

export function useConnectionAppearances(scope: string) {
  const key = `smart-factory:connection-appearance:v1:${scope}`;
  const [saved, setSaved] = useState(() => load(key));
  const current = useMemo(() => saved.key === key ? saved : load(key), [saved, key]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSaved(load(key));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  function persist(values: ConnectionAppearances) {
    let error = "";
    try {
      if (Object.keys(values).length > 1000) throw Error("Too many route preferences.");
      const serialized = JSON.stringify({ version: 1, routes: values });
      if (serialized.length > 1_000_000) throw Error("Route preferences are too large.");
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized) throw Error("Storage did not retain routing.");
    } catch {
      error = "3D routing changed in this view, but could not be saved in this browser. It may be lost on refresh.";
    }
    setSaved({ key, values, blocked: false, error });
  }
  return {
    values: current.values,
    error: current.error,
    blocked: current.blocked,
    set(link: FloorLink, value: ConnectionAppearance) {
      if (current.blocked) return;
      persist({ ...current.values, [connectionKey(link)]: validateConnectionAppearance(value) });
    },
    reset(link: FloorLink) {
      if (current.blocked) return;
      const next = { ...current.values };
      delete next[connectionKey(link)];
      persist(next);
    },
    resetUnreadable() { persist({}); },
  };
}

function RouteNumber({ label, value, min, max, onCommit }: {
  label: string; value: number; min: number; max: number; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => { setText(String(value)); setError(false); }, [value]);
  return (
    <label className="block min-w-0 text-xs text-muted-foreground">
      {label}
      <input type="number" aria-label={label} min={min} max={max} step="0.01"
        className="workspace-control mt-1 w-full min-w-0" value={text} aria-invalid={error || undefined}
        onChange={(event) => { setText(event.target.value); setError(false); }}
        onBlur={() => {
          const parsed = Number(text);
          if (!text.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) {
            setError(true); return;
          }
          setError(false); onCommit(parsed);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      />
      {error && <span className="text-destructive" role="alert">Enter {min} to {max}.</span>}
    </label>
  );
}

export function FactoryConnectionEditor({ links, layout, controller }: {
  links: FloorLink[];
  layout: FloorLayout;
  controller: ReturnType<typeof useConnectionAppearances>;
}) {
  const [selected, setSelected] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const available = useMemo(() => {
    const refs = new Set(layout.placements.map((p) => p.item.ref));
    return [...new Map(links.filter((l) => l.from !== l.to && refs.has(l.from) && refs.has(l.to))
      .map((l) => [connectionKey(l), l])).values()];
  }, [links, layout]);
  const link = available.find((l) => connectionKey(l) === selected) ?? available[0];
  if (!link) return null;
  const id = connectionKey(link), appearance = controller.values[id] ?? defaultConnectionAppearance(link);
  const names = new Map(layout.placements.map((p) => [p.item.ref, p.item.name]));
  const set = (patch: Partial<ConnectionAppearance>) => controller.set(link, { ...appearance, ...patch });
  const reorder = (index: number, direction: number) => {
    const next = appearance.points.map((p) => ({ ...p }));
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    set({ points: next });
  };
  return (
    <details
      className="relative shrink-0"
      data-testid="connection-routing"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary
        role="button"
        aria-label="Edit 3D connections"
        aria-expanded={isOpen}
        title="Edit 3D connections"
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <Cable className="size-4 shrink-0" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-full z-50 mt-1 max-h-[min(28rem,65vh)] w-[min(24rem,calc(100vw-3rem))] space-y-3 overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
        <p className="text-xs text-muted-foreground">
          Illustrative routing, not surveyed pipework or verified wiring. Automatic cable trays show shared visual routes; they do not establish physical wiring. Appearance is saved in this browser and does not change operational connections or floor-plan lines. Routes are not collision-checked.
        </p>
        {controller.error && <p role="alert" className="text-xs text-destructive">{controller.error}</p>}
        {controller.blocked && <Button size="sm" variant="outline" aria-label="Reset unreadable 3D routing" onClick={controller.resetUnreadable}>Reset unreadable 3D routing</Button>}
        <label className="block text-xs text-muted-foreground">
          Connection
          <select aria-label="3D connection" className="workspace-control mt-1 w-full" value={id}
            onChange={(event) => setSelected(event.target.value)}>
            {available.map((l) => <option key={connectionKey(l)} value={connectionKey(l)}>
              {names.get(l.from)} → {names.get(l.to)} · {l.label}
            </option>)}
          </select>
        </label>
        <fieldset disabled={controller.blocked} className="min-w-0 space-y-3" key={id}>
          <legend className="sr-only">Connection appearance</legend>
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <label className="block min-w-0 text-xs text-muted-foreground">
              Type
              <select aria-label="3D connection type" className="workspace-control mt-1 w-full" value={appearance.type}
                onChange={(event) => {
                  const pipe = event.target.value === "pipe";
                  set({ type: pipe ? "pipe" : "wire", diameter: pipe ? 0.16 : 0.07,
                    routing: undefined,
                    color: pipe ? "#a5b1bf" : "#405d6b" });
                }}>
                <option value="wire">Wire / cable</option><option value="pipe">Pipe</option>
              </select>
            </label>
            <label className="block min-w-0 text-xs text-muted-foreground">
              Shape
              <select aria-label="3D route shape" className="workspace-control mt-1 w-full" value={appearance.routing === "tray" ? "tray" : appearance.shape}
                onChange={(event) => {
                  const route = event.target.value;
                  set(route === "tray" ? { shape: "elbow", routing: "tray" } : {
                    shape: route as ConnectionAppearance["shape"], routing: undefined,
                  });
                }}>
                {appearance.type === "wire" && <option value="tray">Automatic cable tray</option>}
                <option value="straight">Straight</option><option value="elbow">Rounded elbows</option>
                <option value="curve">Curved</option><option value="custom">Custom points</option>
              </select>
            </label>
            <RouteNumber label="Route height (m)" value={appearance.height} min={0.05} max={100} onCommit={(height) => set({ height })} />
            <RouteNumber label="Diameter (m)" value={appearance.diameter} min={0.02} max={1} onCommit={(diameter) => set({ diameter })} />
            <RouteNumber label="Bend radius / rise (m)" value={appearance.bendRadius} min={0.01} max={10} onCommit={(bendRadius) => set({ bendRadius })} />
            <label className="block text-xs text-muted-foreground">
              Colour
              <input aria-label="3D connection colour" type="color" className="mt-1 h-9 w-full rounded-md border bg-background" value={appearance.color}
                onChange={(event) => set({ color: event.target.value })} />
            </label>
          </div>
          {appearance.shape === "custom" && <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Ordered bend points in factory metres: X left/right, Y height, Z front/back. Endpoints follow the equipment; intermediate points stay at these coordinates.</p>
            {appearance.points.map((point, index) => <div key={index} className="rounded-md border p-2">
              <div className="grid grid-cols-3 gap-2">
                {(["x", "y", "z"] as const).map((axis) => <RouteNumber key={axis}
                  label={`Point ${index + 1} ${axis.toUpperCase()} (m)`} value={point[axis]}
                  min={axis === "y" ? 0.05 : -1000} max={axis === "y" ? 100 : 1000}
                  onCommit={(value) => set({ points: appearance.points.map((p, i) => i === index ? { ...p, [axis]: value } : p) })} />)}
              </div>
              <div className="mt-2 flex justify-end gap-1">
                <Button size="icon" variant="ghost" aria-label={`Move point ${index + 1} earlier`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Move point ${index + 1} later`} disabled={index === appearance.points.length - 1} onClick={() => reorder(index, 1)}><ArrowDown className="size-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Remove point ${index + 1}`} onClick={() => set({ points: appearance.points.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button>
              </div>
            </div>)}
            <Button size="sm" variant="outline" aria-label="Add bend point" disabled={appearance.points.length >= MAX_ROUTE_POINTS} onClick={() => {
              const from = layout.placements.find((p) => p.item.ref === link.from)!;
              const to = layout.placements.find((p) => p.item.ref === link.to)!;
              const previous = appearance.points.at(-1) ?? { x: from.x, z: from.z };
              set({ points: [...appearance.points, { x: (previous.x + to.x) / 2, y: appearance.height, z: (previous.z + to.z) / 2 }] });
            }}><Plus className="mr-1 size-4" />Add bend point</Button>
          </div>}
          <Button size="sm" variant="outline" aria-label="Reset this route" onClick={() => controller.reset(link)}>Reset this route</Button>
        </fieldset>
      </div>
    </details>
  );
}
