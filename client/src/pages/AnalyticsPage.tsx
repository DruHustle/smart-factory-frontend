import { useMemo, useState } from "react";
import { MetricComparison } from "@/components/workspace/MetricComparison";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import {
  PageHeader,
  EmptyState,
  Measurement,
} from "@/components/workspace/Primitives";
import {
  ObservationTrend,
  type TrendScope,
} from "@/components/workspace/ObservationTrend";
import { ExportButton } from "@/components/ExportButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canonicalUnits, metrics, type Metric } from "@shared/measurements";
import { analysisRange } from "@/lib/analysis-range";
const fields = [
  "assetType",
  "zone",
  "location",
  "manufacturer",
  "lifecycleStage",
] as const;
type Group = (typeof fields)[number];
export default function AnalyticsPage() {
  const { user } = useAuth(),
    [location, navigate] = useWorkspaceLocation(),
    params = new URLSearchParams(location.split("?")[1] ?? "");
  const showcase = trpc.system.showcase.useQuery(undefined, {
    enabled: !!user?.access?.demoOnly,
    staleTime: 300000,
  });
  const [anchor, setAnchor] = useState(() => Date.now()),
    [sourceSearch, setSourceSearch] = useState("");
  const assetId = params.get("asset") ?? "",
    groupBy = (
      fields.includes(params.get("groupBy") as Group)
        ? params.get("groupBy")
        : "assetType"
    ) as Group,
    group = params.get("group") ?? "all",
    metric = (
      metrics.includes(params.get("metric") as Metric)
        ? params.get("metric")
        : "temperature"
    ) as Metric,
    scope = (
      ["operational", "live", "simulated", "replay", "unknown", "all"].includes(
        params.get("scope") ?? "",
      )
        ? params.get("scope")
        : user?.access?.demoOnly
          ? "simulated"
          : "operational"
    ) as TrendScope;
  const rangeAnchor = user?.access?.demoOnly && showcase.data ? Date.parse(showcase.data.anchor) : anchor;
  const { custom, range, endTime, startTime, valid, intervalMs } = analysisRange(
    params, rangeAnchor, user?.access?.demoOnly ? "1h" : "7d",
  );
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values))
      v ? next.set(k, v) : next.delete(k);
    navigate(`/analytics?${next}`);
  };
  const sources = trpc.assets.list.useQuery(),
    assets = sources.data ?? [],
    groupValue = (a: Pick<(typeof assets)[number], Group>) =>
      String(a[groupBy] ?? "Unassigned"),
    options = Array.from(new Set(assets.map(groupValue))).sort(),
    selected = assets.filter((a) =>
      assetId
        ? a.assetId === assetId
        : group === "all" || groupValue(a) === group,
    ),
    assetIds = useMemo(
      () => selected.map((a) => a.assetId),
      [selected.map((a) => a.assetId).join("|")],
    );
  const input = {
      assetIds,
      startTime,
      endTime,
      scope,
      intervalMs,
    },
    analytics = trpc.analytics.getAssetTelemetry.useQuery(input, {
      enabled: valid && !!assetIds.length,
    }),
    exportReport = trpc.export.analyticsReport.useMutation();
  const groups = new Map<
    string,
    { sum: number; count: number; assets: number }
  >();
  for (const a of analytics.data?.assets ?? []) {
    const key = groupValue(a),
      entry = groups.get(key) ?? { sum: 0, count: 0, assets: 0 },
      v = (a as any)[`avg${metric[0].toUpperCase() + metric.slice(1)}`] as
        | number
        | null;
    entry.assets++;
    if (v != null) {
      entry.sum += v;
      entry.count++;
    }
    groups.set(key, entry);
  }
  const control =
    "workspace-control";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Understand observed trends and the evidence behind them."
        action={
          !user?.access?.demoOnly && assetIds.length && valid ? (
            <ExportButton
              label="Export report"
              onExportHtml={() => exportReport.mutateAsync(input)}
            />
          ) : undefined
        }
      />
      {user?.access?.demoOnly && showcase.data && valid && (
        <p
          data-demo-anchor={showcase.data.anchor}
          className="rounded-md border border-info/40 bg-info/5 p-3 text-sm"
        >
          Recorded simulation window · {new Date(startTime).toLocaleString()} –{" "}
          {new Date(endTime).toLocaleString()}. Gaps are retained; current
          physical connectivity is not inferred.
        </p>
      )}
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span>Asset scope</span>
          <select
            aria-label="Asset scope"
            className={control}
            value={assetId}
            onChange={(e) => update({ asset: e.target.value })}
          >
            <option value="">Selected group ({selected.length} assets)</option>
            {assets.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span>Time range (UTC)</span>
          <select
            aria-label="Time range"
            className={control}
            value={custom ? "custom" : range}
            onChange={(e) =>
              update(
                e.target.value === "custom"
                  ? {
                      range: "custom",
                      from: new Date(valid ? startTime : rangeAnchor - 3600000).toISOString().slice(0, 16),
                      to: new Date(valid ? endTime : rangeAnchor).toISOString().slice(0, 16),
                    }
                  : { range: e.target.value, from: "", to: "" },
              )
            }
          >
            {["1h", "24h", "7d", "30d", "custom"].map((v) => (
              <option key={v} value={v}>
                {v === "custom" ? "Custom dates" : `Last ${v}`}
              </option>
            ))}
          </select>
        </label>
        <details className="sm:col-span-2 xl:col-span-4">
          <summary className="cursor-pointer text-sm font-medium">
            Scope and aggregation · {scope} evidence ·{" "}
            {Math.round(input.intervalMs / 60000)} minute buckets
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {" "}
            <label className="space-y-1 text-xs">
              <span>Evidence scope</span>
              <select
                aria-label="Evidence scope"
                className={control}
                value={scope}
                onChange={(e) => update({ scope: e.target.value })}
              >
                {[
                  "operational",
                  "live",
                  "simulated",
                  "replay",
                  "unknown",
                  "all",
                ].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>Aggregation</span>
              <select
                aria-label="Aggregation"
                className={control}
                value={input.intervalMs}
                onChange={(e) => update({ interval: e.target.value })}
              >
                <option value={60000}>1 minute average</option>
                <option value={900000}>15 minute average</option>
                <option value={3600000}>1 hour average</option>
                <option value={86400000}>1 day average</option>
              </select>
            </label>
            {!assetId && (
              <>
                <label className="space-y-1 text-xs">
                  <span>Group by</span>
                  <select
                    aria-label="Group by"
                    className={control}
                    value={groupBy}
                    onChange={(e) =>
                      update({ groupBy: e.target.value, group: "all" })
                    }
                  >
                    {fields.map((v) => (
                      <option key={v} value={v}>
                        {v.replace(/([A-Z])/g, " $1")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span>Group</span>
                  <select
                    aria-label="Asset group"
                    className={control}
                    value={group}
                    onChange={(e) => update({ group: e.target.value })}
                  >
                    <option value="all">All groups</option>
                    {options.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </details>
        {custom && (
          <>
            <label className="space-y-1 text-xs">
              <span>From (UTC)</span>
              <Input
                aria-label="Analysis from UTC"
                type="datetime-local"
                value={params.get("from") ?? ""}
                onChange={(e) => update({ from: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>To (UTC)</span>
              <Input
                aria-label="Analysis to UTC"
                type="datetime-local"
                value={params.get("to") ?? ""}
                onChange={(e) => update({ to: e.target.value })}
              />
            </label>
          </>
        )}
      </div>
      {!valid ? (
        <EmptyState
          error
          title="Review the selected dates"
          description="Choose a start before the end, within a period of 93 days. Dates are interpreted in UTC."
        />
      ) : sources.error || analytics.error ? (
        <EmptyState
          error
          title="Analytics unavailable"
          description={sources.error?.message ?? analytics.error?.message}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void sources.refetch();
                void analytics.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : sources.isLoading || analytics.isLoading ? (
        <EmptyState title="Loading selected evidence…" />
      ) : !assetIds.length ? (
        <EmptyState
          title="No assets in this scope"
          description="Choose another group or register an asset and link its observations."
          action={
            <Button asChild variant="outline">
              <Link href="/inventory">Open inventory</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ObservationTrend
            assetIds={assetIds}
            title={
              assetId
                ? (selected[0]?.name ?? "Asset observations")
                : "Group observations"
            }
            startTime={startTime}
            endTime={endTime}
            metric={metric}
            onMetricChange={(m) => update({ metric: m })}
            scope={scope}
            intervalMs={input.intervalMs}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
            <div>
              <h2 className="font-semibold">Evidence coverage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {analytics.data?.overall.sampleCount.toLocaleString() ?? 0}{" "}
                stored observations across {assetIds.length} selected assets.
                Missing buckets remain gaps.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expected sample coverage is unavailable without a reviewed
                acquisition cadence. Service readiness does not establish
                physical source coverage.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href="/monitoring">Review sources</Link>
            </Button>
          </div>
          <MetricComparison
            title={`Observed ${metric} by ${groupBy}`}
            unit={canonicalUnits[metric]}
            items={Array.from(groups, ([name, group]) => ({
              name,
              value: group.count ? group.sum / group.count : null,
            }))}
          />
          {!!analytics.data?.overall.sampleCount && (
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer font-medium">
                Asset and group comparisons
              </summary>
              <p className="my-3 text-xs text-muted-foreground">
                Group comparisons use the mean of verified per-asset means;
                faster sources do not receive extra weight.
              </p>
              <div className="space-y-2">
                {Array.from(groups, ([name, g]) => (
                  <div
                    className="flex justify-between gap-4 border-b py-2"
                    key={name}
                  >
                    <span>
                      {name} · {g.assets} assets
                    </span>
                    <Measurement
                      value={g.count ? g.sum / g.count : null}
                      unit={canonicalUnits[metric]}
                    />
                  </div>
                ))}
              </div>
              <Input
                className="mt-4"
                aria-label="Find an analysed asset"
                placeholder="Find an analysed asset"
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
              />
              <ul className="mt-2 divide-y">
                {analytics.data.assets
                  .filter((a) =>
                    a.name.toLowerCase().includes(sourceSearch.toLowerCase()),
                  )
                  .map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 py-2">
                      <Link
                        className="hover:underline"
                        href={`/inventory/asset:${a.id}/telemetry?return=${encodeURIComponent(location)}`}
                      >
                        {a.name}
                      </Link>
                      <span className="text-sm text-muted-foreground">
                        {a.sampleCount.toLocaleString()} observations
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Named asset signals are retained in the asset workspace; their
                units are not inferred into scalar engineering aggregates.
              </p>
            </details>
          )}
        </>
      )}
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced analytics readiness
        </summary>
        <p className="mt-3 text-sm text-muted-foreground">
          OEE, remaining useful life, predictions, calibrated energy/emissions
          and financial metrics require validated production, maintenance,
          metering and cost inputs. These results are unavailable until their
          inputs and methods are qualified.
        </p>
      </details>
    </div>
  );
}
