import type { FloorLink, layoutFactory } from "@shared/factory-floor";
type Layout = ReturnType<typeof layoutFactory>;
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
      className="h-full w-full bg-muted/30"
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
          <text x={z.x + 0.7} y={z.z + 0.9} fontSize=".5" fill="currentColor">
            {z.name}
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
          tabIndex={0}
          onClick={() => onSelect(p.item.ref)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(p.item.ref);
            }
          }}
          className="cursor-pointer outline-none"
        >
          <title>{p.item.name}</title>
          <rect
            x={p.x - 1.1}
            y={p.z - 0.8}
            width="2.2"
            height="1.6"
            rx=".2"
            fill={selected === p.item.ref ? "var(--info)" : "var(--card)"}
            stroke="var(--info)"
            strokeWidth=".07"
          />
          <text
            x={p.x}
            y={p.z + 1.25}
            textAnchor="middle"
            fontSize=".38"
            fill="currentColor"
          >
            {p.item.name.slice(0, 25)}
          </text>
        </g>
      ))}
    </svg>
  );
}
