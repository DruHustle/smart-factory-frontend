import type { FloorLink, layoutFactory } from "@shared/factory-floor";
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
}: {
  layout: Layout;
  links: FloorLink[];
  selected: string | null;
  onSelect: (ref: string) => void;
}) {
  const byRef = new Map(layout.placements.map((p) => [p.item.ref, p]));
  return (
    <svg
      viewBox={`${-layout.width / 2 - 2} ${-layout.depth / 2 - 2} ${layout.width + 4} ${layout.depth + 4}`}
      className="h-full w-full bg-muted/30 text-foreground"
      role="img"
      aria-label="Accessible factory floor plan"
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
      {layout.placements.map((p) => (
        <g
          key={p.item.ref}
          role="button"
          aria-label={`Select ${p.item.name}`}
          aria-description={`${p.item.status} · ${p.item.mode} evidence`}
          aria-pressed={selected === p.item.ref}
          tabIndex={0}
          onClick={() => onSelect(p.item.ref)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(p.item.ref);
            }
          }}
          className="group cursor-pointer outline-none"
        >
          <title>
            {p.item.name} · {p.item.status} · {p.item.mode} evidence
          </title>
          <g
            transform={`translate(${p.x} ${p.z}) scale(${p.item.kind === "device" ? 0.42 : 1})`}
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
