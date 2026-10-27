import {
  metrics,
  measurementUnit,
  measurementValue,
  type Metric,
} from "@shared/measurements";
import { Measurement } from "./Primitives";
export function ObservationValues({
  reading,
  limit = 6,
}: {
  reading?:
    | (Partial<Record<Metric, number | null>> & {
        measurements?: unknown;
        integration?: Record<string, unknown> | null;
      })
    | null;
  limit?: number;
}) {
  if (!reading)
    return (
      <span className="text-sm text-muted-foreground">No observation</span>
    );
  if (reading.integration?.sourceQuality === "bad")
    return (
      <span className="text-sm text-destructive">
        Bad-quality observation · values unavailable
      </span>
    );
  const evidence = reading.measurements as Record<string, unknown> | undefined,
    available = metrics.filter((m) => reading[m] != null || evidence?.[m]);
  return available.length ? (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {available.slice(0, limit).map((m) => (
        <div key={m}>
          <p className="text-xs capitalize text-muted-foreground">{m}</p>
          <Measurement
            value={measurementValue(reading, m)}
            unit={measurementUnit(reading, m)}
          />
        </div>
      ))}
    </div>
  ) : (
    <span className="text-sm text-muted-foreground">
      No scalar values in this sample
    </span>
  );
}
