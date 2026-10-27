import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { canonicalUnits, metrics, type Metric } from "@shared/measurements";
import { EmptyState, Measurement, SampleTime } from "./Primitives";
import { Button } from "@/components/ui/button";
export type TrendScope =
  | "operational"
  | "live"
  | "simulated"
  | "replay"
  | "unknown"
  | "all";
export function ObservationTrend({
  deviceId,
  assetIds,
  title = "Observed trend",
  scope = "operational",
  startTime,
  endTime,
  metric: controlled,
  onMetricChange,
  intervalMs = 60000,
  openHref,
}: {
  deviceId?: number;
  assetIds?: string[];
  title?: string;
  scope?: TrendScope;
  startTime?: number;
  endTime?: number;
  metric?: Metric;
  onMetricChange?: (m: Metric) => void;
  intervalMs?: number;
  openHref?: string;
}) {
  const { user } = useAuth();
  const showcase = trpc.system.showcase.useQuery(undefined, {
    enabled: !!user?.access?.demoOnly,
    staleTime: 300000,
  });
  const recordedEnd =
    user?.access?.demoOnly && scope === "simulated" && showcase.data
      ? Date.parse(showcase.data.anchor)
      : undefined;
  const active = useDocumentActive();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [metric, setMetric] = useState<Metric>(controlled ?? "temperature"),
    [end, setEnd] = useState(() => Date.now()),
    [range, setRange] = useState(3600000);
  const selected = controlled ?? metric,
    input = useMemo(
      () => ({
        deviceId,
        assetIds,
        metric: selected,
        scope,
        startTime: startTime ?? (endTime ?? recordedEnd ?? end) - range,
        endTime: endTime ?? recordedEnd ?? end,
        intervalMs,
      }),
      [
        deviceId,
        assetIds?.join("|"),
        selected,
        scope,
        startTime,
        endTime,
        recordedEnd,
        end,
        range,
        intervalMs,
      ],
    );
  const query = trpc.readings.trend.useQuery(input, {
      enabled: !!deviceId || !!assetIds?.length,
    }),
    data = query.data;
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  const exportCsv = () => {
    if (!data) return;
    const cell = (v: unknown) => {
      const raw = String(v ?? "");
      return (
        '"' +
        (/^[\s]*[=+@-]/.test(raw) ? "'" : "") +
        raw.replaceAll('"', '""') +
        '"'
      );
    };
    const rows = [
        ["Evidence scope", data.scope],
        [
          "Source",
          deviceId ? `device:${deviceId}` : (assetIds ?? []).join(";"),
        ],
        ["UTC start", new Date(input.startTime).toISOString()],
        ["UTC end", new Date(input.endTime).toISOString()],
        ["Complete range observations", data.total],
        ["Verified metric values", data.verified],
        ["Effective bucket milliseconds", data.intervalMs],
        ["timestamp_utc", `average_${selected}_${data.unit}`, "verified_count"],
        ...data.buckets.map((b) => [
          new Date(b.timestamp).toISOString(),
          b.value ?? "",
          b.count,
        ]),
      ],
      url = URL.createObjectURL(
        new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
          type: "text/csv;charset=utf-8",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `observations-${selected}-${data.scope}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex flex-wrap gap-2">
          {openHref && (
            <Button asChild variant="outline" size="sm">
              <Link href={openHref}>Open telemetry</Link>
            </Button>
          )}
          <select
            aria-label="Trend metric"
            className="h-10 rounded-md border border-input bg-card px-2 capitalize"
            value={selected}
            onChange={(e) => {
              setMetric(e.target.value as Metric);
              onMetricChange?.(e.target.value as Metric);
            }}
          >
            {metrics.map((m) => (
              <option key={m} value={m}>
                {m} ({canonicalUnits[m]})
              </option>
            ))}
          </select>
          {!startTime && (
            <select
              aria-label="Trend period"
              className="h-10 rounded-md border border-input bg-card px-2"
              value={range}
              onChange={(e) => setRange(Number(e.target.value))}
            >
              <option value={3600000}>Last hour</option>
              <option value={86400000}>Last 24 hours</option>
              <option value={604800000}>Last 7 days</option>
            </select>
          )}
          {!user?.access?.demoOnly && data && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => {
              setEnd(Date.now());
              void query.refetch();
            }}
          >
            Refresh trend
          </Button>
        </div>
      </div>
      {recordedEnd && !endTime && (
        <p className="text-xs text-muted-foreground">
          Recorded simulation window ending{" "}
          {new Date(recordedEnd).toLocaleString()}. Current physical
          connectivity is not inferred.
        </p>
      )}
      {query.isLoading ? (
        <EmptyState title="Loading observations…" />
      ) : query.error ? (
        <EmptyState
          error
          title="Trend unavailable"
          description={query.error.message}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data?.verified ? (
        <EmptyState
          title="No verified measurements in this period"
          description={
            data?.total
              ? `${data.total} stored observations have no good-quality compatible ${selected} value. Review units, source quality or evidence scope.`
              : "Choose another period or evidence scope, or inspect the source connection."
          }
        />
      ) : (
        <>
          <div className="p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              {new Date(input.startTime).toLocaleString(undefined, {
                timeZone: "UTC",
              })}{" "}
              –{" "}
              {new Date(input.endTime).toLocaleString(undefined, {
                timeZone: "UTC",
              })}{" "}
              UTC · {scope} · {Math.round(data.intervalMs / 1000)} second
              averages · {data.unit}
            </p>
            <div
              className="h-64 w-full"
              role={openHref ? "link" : "img"}
              tabIndex={openHref ? 0 : undefined}
              onClick={
                openHref
                  ? () => {
                      window.location.hash = openHref;
                    }
                  : undefined
              }
              onKeyDown={
                openHref
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        window.location.hash = openHref;
                      }
                    }
                  : undefined
              }
              aria-label={`${selected} in ${data.unit}. Missing observations are gaps; a data table follows.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  accessibilityLayer={!openHref}
                  data={data.buckets}
                  margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                >
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={time}
                    minTickGap={40}
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    width={64}
                    domain={["auto", "auto"]}
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    labelFormatter={(v) =>
                      new Date(Number(v)).toLocaleString(undefined, {
                        timeZone: "UTC",
                      }) + " UTC"
                    }
                    formatter={(v) => [
                      `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${data.unit}`,
                      selected,
                    ]}
                    contentStyle={{
                      background: "var(--card)",
                      borderColor: "var(--border)",
                      color: "var(--foreground)",
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    connectNulls={false}
                    dot={
                      data.buckets.filter((bucket) => bucket.value != null)
                        .length === 1
                        ? { r: 4, fill: "var(--chart-2)", strokeWidth: 0 }
                        : false
                    }
                    isAnimationActive={active && !reduceMotion}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-4">
            {[
              ["Latest", data.summary.latest],
              ["Minimum", data.summary.min],
              ["Maximum", data.summary.max],
              ["Average", data.summary.average],
            ].map(([label, value]) => (
              <div className="p-4" key={String(label)}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-semibold">
                  <Measurement
                    value={value as number | null}
                    unit={data.unit}
                  />
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            {data.verified.toLocaleString()} verified {selected} measurements /{" "}
            {data.total.toLocaleString()} observations · Complete selected-range
            statistics · Latest{" "}
            <SampleTime value={data.summary.latestAt} historical />
          </div>
          <details className="border-t p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Accessible bucket table
            </summary>
            <div className="mt-3 max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  All displayed buckets, in UTC; missing values remain
                  unavailable.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Time (UTC)</th>
                    <th scope="col">Average ({data.unit})</th>
                    <th scope="col">Verified samples</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => (
                    <tr className="border-t" key={b.timestamp}>
                      <td className="py-2">
                        {new Date(b.timestamp).toISOString()}
                      </td>
                      <td>
                        {b.value == null
                          ? "No samples"
                          : b.value.toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })}
                      </td>
                      <td>{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
