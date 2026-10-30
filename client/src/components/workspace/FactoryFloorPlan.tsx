import type { FloorLink, layoutFactory } from "@shared/factory-floor";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  constrainFloorPosition,
  type FloorSelect,
  type FloorMove,
} from "./floor-arrangement";
type Layout = ReturnType<typeof layoutFactory>;

function EquipmentSymbol({ model }: { model: string | null }) {
  switch (model) {
    case "conveyor":
      return (
        <>
          <rect x="-.85" y="-.4" width="1.7" height=".8" rx=".15" />
          {[-0.55, -0.2, 0.2, 0.55].map((x) => (
            <path key={x} d={`M${x} -.35v.7`} />
          ))}
        </>
      );
    case "storage-tank":
      return (
        <>
          <ellipse rx=".65" ry=".5" />
          <ellipse rx=".4" ry=".3" />
          <path d="M0 -.5v-.25M.65 0h.2" />
        </>
      );
    case "robot-arm":
      return (
        <>
          <circle cx="-.45" cy=".2" r=".3" />
          <path
            d="M-.45 .2L-.1 -.35 .5 -.05 .7 -.45"
            strokeWidth=".18"
            strokeLinecap="round"
          />
          <circle cx="-.1" cy="-.35" r=".12" />
        </>
      );
    case "pump-motor":
      return (
        <>
          <rect x="-.7" y="-.35" width=".8" height=".7" rx=".15" />
          <circle cx=".4" r=".4" />
          <path d="M-.5 -.3v.6M-.3 -.3v.6M.4 -.4v-.2" />
        </>
      );
    case "valve":
      return (
        <>
          <path d="M-.75 0h1.5M-.45 -.35L.45 .35v-.7L-.45 .35zM0 -.35v-.25" />
          <path d="M-.3 -.6h.6" />
        </>
      );
    case "raspberry-pi-4b":
      return (
        <>
          <rect x="-.65" y="-.4" width="1.3" height=".8" rx=".1" />
          <rect x="-.2" y="-.2" width=".4" height=".4" />
          <path d="M.3 -.35h.25M.3 0h.25M.3 .3h.25" />
        </>
      );
    case "control-cabinet":
      return (
        <>
          <rect x="-.55" y="-.5" width="1.1" height="1" rx=".1" />
          <path d="M0 -.5v1M.2 -.2h.2M.2 0h.2M.2 .2h.2" />
        </>
      );
    default:
      return (
        <>
          <circle r=".3" />
          <circle r=".1" />
        </>
      );
  }
}

function statusColor(item: Layout["placements"][number]["item"]) {
  if (item.status === "error" || item.status === "offline")
    return "var(--destructive)";
  if (item.status === "stale" || item.status === "maintenance")
    return "var(--warning)";
  if (item.mode === "simulated") return "var(--info)";
  return item.status === "live" ? "var(--success)" : "var(--muted-foreground)";
}
export function FloorPlan({
  layout,
  links,
  selected,
  onSelect,
  onMove,
  reset = 0,
}: {
  layout: Layout;
  links: FloorLink[];
  selected: string | null;
  onSelect: FloorSelect;
  onMove?: FloorMove;
  reset?: number;
}) {
  const canvas = useRef<SVGSVGElement>(null);
  const panModifier = useRef(false);
  const [grabbed, setGrabbed] = useState<"item" | "floor" | null>(null);
  const [pan, setPan] = useState({ x: 0, z: 0 });
  const [preview, setPreview] = useState<{
    ref: string;
    x: number;
    z: number;
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    matrix: DOMMatrix;
    start: DOMPoint;
    origin: { x: number; z: number };
    ref?: string;
    next: { x: number; z: number };
  } | null>(null);
  const suppressClick = useRef(false);
  const zoneKey = JSON.stringify(layout.zones);
  useEffect(() => {
    cancel();
    setPan({ x: 0, z: 0 });
  }, [reset, layout.width, layout.depth, zoneKey]);
  const placements = layout.placements.map((p) =>
    preview?.ref === p.item.ref ? { ...p, x: preview.x, z: preview.z } : p,
  );
  const byRef = new Map(placements.map((p) => [p.item.ref, p]));
  const cancel = () => {
    const ended = drag.current;
    drag.current = null;
    if (ended) suppressClick.current = true;
    if (ended && !ended.ref) setPan(ended.origin);
    setPreview(null);
    setGrabbed(null);
    if (ended && canvas.current?.hasPointerCapture(ended.pointerId))
      canvas.current.releasePointerCapture(ended.pointerId);
  };
  useEffect(() => {
    const blur = () => {
      panModifier.current = false;
      cancel();
    };
    const spaceDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        e.code === "Space" &&
        canvas.current?.matches(":hover") &&
        !(
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        )
      ) {
        e.preventDefault();
        panModifier.current = true;
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") panModifier.current = false;
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", spaceDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", spaceDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);
  const moveKey = (ref: string, key: string) => {
    const p = byRef.get(ref);
    if (!p || !onMove) return;
    const next = constrainFloorPosition(
      layout,
      p.x + (key === "ArrowLeft" ? -0.5 : key === "ArrowRight" ? 0.5 : 0),
      p.z + (key === "ArrowUp" ? -0.5 : key === "ArrowDown" ? 0.5 : 0),
    );
    onMove(ref, next.x, next.z);
  };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) {
      cancel();
      return;
    }
    if (e.button !== 0) return;
    const matrix = e.currentTarget.getScreenCTM()?.inverse();
    if (!matrix) return;
    const ref =
      e.target instanceof Element
        ? e.target.closest("[data-floor-ref]")?.getAttribute("data-floor-ref")
        : null;
    const p = ref && byRef.get(ref);
    const moveItem = !!p && !!onMove && !panModifier.current && !e.shiftKey;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    const origin = moveItem && p ? { x: p.x, z: p.z } : pan;
    drag.current = {
      pointerId: e.pointerId,
      matrix,
      start: point,
      origin,
      ref: moveItem && ref ? ref : undefined,
      next: origin,
    };
    suppressClick.current = false;
    setGrabbed(moveItem ? "item" : "floor");
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  return (
    <svg
      ref={canvas}
      data-interaction="grab"
      data-grab-state={grabbed ?? "idle"}
      aria-description="Grab equipment to move it, or empty floor to pan. Release to drop. Select equipment and use arrow keys for precise placement; Escape cancels a grab or clears selection. Hold Space or Shift to pan over equipment."
      viewBox={`${-layout.width / 2 - 2 + pan.x} ${-layout.depth / 2 - 2 + pan.z} ${layout.width + 4} ${layout.depth + 4}`}
      className="h-full w-full bg-muted/30 text-foreground"
      role="img"
      aria-label="Accessible factory floor plan"
      tabIndex={0}
      style={{
        touchAction: "none",
        cursor: grabbed ? "grabbing" : "grab",
      }}
      onPointerDown={down}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            d.matrix,
          ),
          dx = point.x - d.start.x,
          dz = point.y - d.start.y;
        if (Math.hypot(dx, dz) > 0.05) suppressClick.current = true;
        if (!suppressClick.current) return;
        d.next = d.ref
          ? constrainFloorPosition(layout, d.origin.x + dx, d.origin.z + dz)
          : { x: d.origin.x - dx, z: d.origin.z - dz };
        if (d.ref) setPreview({ ref: d.ref, ...d.next });
        else setPan(d.next);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (d.ref) {
          if (suppressClick.current) onMove?.(d.ref, d.next.x, d.next.z);
          onSelect(d.ref, !suppressClick.current);
          // Pointer capture retargets click to the SVG; selection is handled here.
          suppressClick.current = true;
        }
        setPreview(null);
        setGrabbed(null);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if (e.code === "Space" && e.target === e.currentTarget) {
          e.preventDefault();
          panModifier.current = true;
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (drag.current) cancel();
          else onSelect("");
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            e.key,
          ) ||
          e.target !== e.currentTarget
        )
          return;
        if (selected) {
          e.preventDefault();
          moveKey(selected, e.key);
        } else {
          e.preventDefault();
          setPan((p) => ({
            x:
              p.x +
              (e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0),
            z: p.z + (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0),
          }));
        }
      }}
    >
      {layout.zones.map((z) => (
        <g key={z.name}>
          <rect
            x={z.x}
            y={z.z}
            width={z.width}
            height={z.depth}
            rx=".5"
            fill="var(--info)"
            fillOpacity=".06"
            stroke="var(--border)"
            strokeWidth=".08"
          />
          <path
            d={`M${z.x + 0.5} ${z.z + 1.2}h${z.width - 1}`}
            stroke="var(--warning)"
            strokeWidth=".08"
            strokeDasharray=".25 .15"
          />
          <text
            x={z.x + 0.7}
            y={z.z + 0.9}
            fontSize=".5"
            fontWeight="600"
            fill="currentColor"
          >
            {z.name} · {z.count}
          </text>
        </g>
      ))}
      {links.map((l, n) => {
        const a = byRef.get(l.from),
          b = byRef.get(l.to);
        return a && b ? (
          <line
            key={n}
            x1={a.x}
            y1={a.z}
            x2={b.x}
            y2={b.z}
            stroke="var(--info)"
            strokeWidth=".06"
            strokeDasharray=".2 .15"
          />
        ) : null;
      })}
      {placements.map((p) => (
        <g
          key={p.item.ref}
          data-floor-ref={p.item.ref}
          role="button"
          aria-label={`Select ${p.item.name}`}
          aria-description={`${p.item.status} · ${p.item.mode} evidence`}
          aria-pressed={selected === p.item.ref}
          tabIndex={0}
          onClick={() => {
            if (!suppressClick.current) onSelect(p.item.ref);
            suppressClick.current = false;
          }}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              e.stopPropagation();
              moveKey(p.item.ref, e.key);
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(p.item.ref);
            }
          }}
          className="group outline-none"
          style={{ cursor: "inherit" }}
        >
          <title>
            {p.item.name} · {p.item.status} · {p.item.mode} evidence
          </title>
          <g
            transform={`translate(${p.x} ${p.z}) rotate(${p.rotation ?? 0}) scale(${p.item.kind === "device" ? 0.42 : 1})`}
          >
            <rect
              x="-1.1"
              y="-.8"
              width="2.2"
              height="1.6"
              rx=".2"
              fill={selected === p.item.ref ? "var(--info)" : "var(--card)"}
              fillOpacity={selected === p.item.ref ? ".2" : "1"}
              stroke="var(--info)"
              strokeWidth={selected === p.item.ref ? ".15" : ".07"}
              className="group-focus:stroke-[.18]"
            />
            <g fill="var(--muted)" stroke="var(--info)" strokeWidth=".07">
              <EquipmentSymbol model={p.model} />
            </g>
            <circle
              cx=".87"
              cy="-.57"
              r=".13"
              fill={statusColor(p.item)}
              stroke="var(--card)"
              strokeWidth=".04"
            />
          </g>
          {(p.item.kind !== "device" || selected === p.item.ref) && (
            <text
              x={p.x}
              y={p.z + 1.25}
              textAnchor="middle"
              fontSize=".38"
              fill="currentColor"
            >
              {p.item.name.slice(0, 25)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
