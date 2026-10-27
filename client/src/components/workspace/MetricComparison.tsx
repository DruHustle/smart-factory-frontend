import { Measurement } from "./Primitives";

/** A signed comparison with a shared zero baseline; unavailable values are not bars. */
export function MetricComparison({
  title,
  unit,
  items,
}: {
  title: string;
  unit: string;
  items: { name: string; value: number | null }[];
}) {
  const measured = items.filter(
    (item): item is { name: string; value: number } =>
      item.value != null && Number.isFinite(item.value),
  );
  if (!measured.length) return null;
  const min = Math.min(0, ...measured.map((i) => i.value)),
    max = Math.max(0, ...measured.map((i) => i.value));
  const span = max - min || 1,
    zero = (-min / span) * 100;
  return (
    <figure
      aria-label={title}
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <figcaption className="font-semibold">{title}</figcaption>
      <p className="text-xs text-muted-foreground">
        Showing up to 12 of {measured.length} measured groups. Shared zero
        baseline · {unit} · mean of verified per-asset means, with equal asset
        weight.
      </p>
      <div
        aria-hidden
        className="flex justify-between text-xs text-muted-foreground"
      >
        <span>
          {min.toLocaleString()} {unit}
        </span>
        <span>
          {max.toLocaleString()} {unit}
        </span>
      </div>
      <ul className="space-y-4">
        {measured.slice(0, 12).map((item) => (
          <li key={item.name} className="space-y-1">
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{item.name}</span>
              <strong className="shrink-0 tabular-nums">
                <Measurement value={item.value} unit={unit} />
              </strong>
            </div>
            <div className="relative h-5 rounded bg-muted/50" aria-hidden>
              <span
                className="absolute top-0 h-5 border-l border-muted-foreground"
                style={{ left: `${zero}%` }}
              />
              <span
                className="absolute top-1 h-3 rounded-sm bg-info"
                style={{
                  left: `${Math.min(zero, ((item.value - min) / span) * 100)}%`,
                  width: `${(Math.abs(item.value) / span) * 100}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
