import { FactorySelector } from "@/components/workspace/FactorySelector";
import { FactoryWorkspace } from "@/components/workspace/FactoryWorkspace";
import { useFactorySelection } from "@/lib/factory-selection";
import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  RefreshCw,
  Boxes,
  Radio,
  AlertTriangle,
  Network,
  Clock3,
  Gauge,
  ChevronRight,
  CircleAlert,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  PageHeader,
  SampleTime,
} from "@/components/workspace/Primitives";
import { FactoryFloor } from "@/components/workspace/FactoryFloor";
import { ObservationTrend } from "@/components/workspace/ObservationTrend";
import { SourceStates } from "@/components/workspace/OverviewGraphics";
import { OverviewInfrastructure } from "@/components/workspace/OverviewInfrastructure";
import { SystemItemTypes } from "@/components/workspace/SystemInventoryOverview";
import { metrics, type Metric } from "@shared/measurements";
import type { FloorLink } from "@shared/factory-floor";

export default function Home() {
  const { id } = useFactorySelection();
  return id ? (
    <FactoryWorkspace key={id} id={id} mode="overview" />
  ) : (
    <LegacyHome />
  );
}
function LegacyHome() {
  const active = useDocumentActive(),
    { user } = useAuth();
  const [location, navigate] = useWorkspaceLocation(),
    [anchor, setAnchor] = useState(() => Date.now());
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values))
      value ? next.set(key, value) : next.delete(key);
    navigate(`/${next.size ? `?${next}` : ""}`);
  };
  const options = {
    staleTime: 30000,
    refetchInterval: active ? 60000 : (false as const),
    refetchIntervalInBackground: false,
  };
  const floor = trpc.factory.floor.useQuery({ zone: "" }, options);
  const overview = trpc.analytics.getOverview.useQuery(undefined, options);
  const incidents = trpc.alerts.list.useQuery(
    { openOnly: true, limit: 2 },
    options,
  );
  const network = trpc.networkDiagnostics.overview.useQuery(
    { scenario: "normal" },
    options,
  );
  const showcase = trpc.system.showcase.useQuery(undefined, {
    staleTime: 300000,
  });
  const items = floor.data?.items ?? [],
    stats = overview.data;
  const demo = !!user?.access?.demoOnly;
  const selected = items.find((item) => item.ref === params.get("source"));
  const metric = metrics.includes(params.get("metric") as Metric)
    ? (params.get("metric") as Metric)
    : "temperature";
  const rangeMs = params.get("range") === "24h" ? 86400000 : 3600000;
  const at = Number(params.get("at"));
  const end =
    params.has("at") && at > 0 && at <= Date.now() + 300000
      ? at
      : demo && showcase.data
        ? Date.parse(showcase.data.anchor)
        : anchor;
  const assets = items.filter((i) => i.kind !== "device"),
    assetIds = [...new Set(assets.map((i) => i.identifier))];
  const snapshots = network.data?.snapshots ?? [],
    components = snapshots.flatMap((s) => s.components),
    connections = snapshots.flatMap((s) => s.connections),
    ports = snapshots.flatMap((s) => s.ports);
  const fxLinks: FloorLink[] = snapshots.flatMap((snapshot) =>
    snapshot.connections.flatMap((connection) => {
      const publisher = snapshot.components.find(
          (c) => c.id === connection.publisher,
        ),
        subscriber = snapshot.components.find(
          (c) => c.id === connection.subscriber,
        );
      const from = items.find(
          (i) => i.identifier === publisher?.deviceIdentifier,
        ),
        to = items.find((i) => i.identifier === subscriber?.deviceIdentifier);
      return from && to
        ? [
            {
              from: from.ref,
              to: to.ref,
              kind: "fx" as const,
              label: connection.name,
            },
          ]
        : [];
    }),
  );
  const coverage = network.data?.coverage;
  const busy = floor.isFetching || overview.isFetching;
  const refresh = () => {
    setAnchor(Date.now());
    void Promise.all([
      floor.refetch(),
      overview.refetch(),
      incidents.refetch(),
      network.refetch(),
    ]);
  };
  const kpis = [
    {
      title: "Registered items",
      value: floor.error ? "Unavailable" : (floor.data?.total ?? "…"),
      icon: Boxes,
      href: "/inventory",
    },
    {
      title: "Devices & gateways",
      value: overview.error ? "Unavailable" : (stats?.devices.total ?? "…"),
      icon: Radio,
      href: "/monitoring",
    },
    {
      title: "Open incidents",
      value: overview.error ? "Unavailable" : (stats?.alerts.open ?? "…"),
      icon: AlertTriangle,
      href: "/alerts?status=open",
    },
    {
      title: "FX connections",
      value: network.error ? "Unavailable" : connections.length,
      icon: Network,
      href: "/network",
    },
    {
      title: demo ? "Demo clocks locked" : "Reported clocks locked",
      value: network.error
        ? "Unavailable"
        : network.data?.stale
          ? "Stale evidence"
          : ports.length
            ? `${ports.filter((p) => p.syncState === "locked").length}/${ports.length}`
            : "No collector",
      icon: Clock3,
      href: "/network?tab=timing",
    },
  ];
  return (
    <div
      className="factory-overview space-y-3"
      data-testid="factory-overview-dashboard"
    >
      <PageHeader
        title="Overview"
        description="Your connected factory, at a glance."
        action={
          <>
            <FactorySelector />
            <select
              aria-label="Overview time range"
              value={rangeMs === 86400000 ? "24h" : "1h"}
              onChange={(e) => update({ range: e.target.value })}
              className="workspace-control h-9 w-auto text-xs"
            >
              <option value="1h">Last 60 min</option>
              <option value="24h">Last 24 hours</option>
            </select>
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              aria-label="Refresh overview"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw
                className={`size-4 ${busy ? "motion-safe:animate-spin" : ""}`}
              />
            </Button>
          </>
        }
      />
      {demo && (
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-warning/25 bg-warning/5 px-3 py-1.5 text-xs"
          role="note"
        >
          <span className="flex min-w-0 items-center gap-2">
            <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
            <span>
              <strong>Demo factory · simulated evidence.</strong>{" "}
              {user?.access?.canSwitchData
                ? "Switch to Live data to view your operational installation."
                : "Live data requires an individual account on your operational installation."}
            </span>
          </span>
          {demo && (
            <Link
              href="/sandbox"
              className="inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              Open editable demo
            </Link>
          )}
          <Link
            href="/demo"
            className="inline-flex min-h-7 items-center gap-1 underline"
          >
            Demo guide <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      )}
      <div className="overview-kpis grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <Link
            key={kpi.title}
            href={kpi.href}
            className="overview-kpi flex min-w-0 items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors last:col-span-2 sm:last:col-span-1 hover:border-info focus-visible:outline-2 focus-visible:outline-ring"
          >
            <kpi.icon
              className="size-7 shrink-0 text-info"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">
                {kpi.title}
              </span>
              <strong
                className={`mt-1 block font-semibold tabular-nums ${String(kpi.value).length > 8 ? "text-sm" : "text-2xl"}`}
              >
                {kpi.value}
              </strong>
            </span>
          </Link>
        ))}
      </div>
      <div className="overview-main-grid grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {floor.isLoading ? (
            <div className="flex h-[28rem] items-center justify-center rounded-lg border bg-card">
              <EmptyState title="Loading the complete factory floor…" />
            </div>
          ) : floor.error || !floor.data ? (
            <EmptyState
              error
              title="Factory floor unavailable"
              description={floor.error?.message}
              action={
                <Button variant="outline" onClick={() => void floor.refetch()}>
                  Retry factory floor
                </Button>
              }
            />
          ) : !items.length ? (
            <EmptyState
              title="No registered factory items"
              description="Connect assets, gateways and devices through Assets & devices to populate this floor."
              action={
                <Button asChild>
                  <Link href="/inventory">Connect first item</Link>
                </Button>
              }
            />
          ) : (
            <FactoryFloor
              items={items}
              links={[...floor.data.links, ...fxLinks]}
              selected={selected?.ref ?? null}
              onSelect={(ref) => update({ source: ref })}
              returnTo={location}
              demo={demo}
            />
          )}
        </div>
        <aside
          aria-label="Factory status"
          className="overview-status grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-1"
        >
          <Card className="overview-panel min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-4 text-info" aria-hidden />
                Needs attention
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {overview.error
                  ? "Incident count unavailable"
                  : `${stats?.alerts.open ?? "…"} open process incidents`}
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {incidents.error ? (
                <EmptyState error title="Incidents unavailable" />
              ) : incidents.isLoading ? (
                <p className="text-xs text-muted-foreground" role="status">
                  Loading incidents…
                </p>
              ) : !incidents.data?.length ? (
                <p className="py-3 text-xs text-muted-foreground">
                  No open process incidents.
                </p>
              ) : (
                <ul
                  className="space-y-2"
                  aria-label="Incidents needing attention"
                >
                  {incidents.data.map((incident) => (
                    <li key={incident.id}>
                      <Link
                        href={`/alerts/${incident.id}`}
                        className="flex min-h-16 items-start gap-2 rounded-lg border p-2.5 hover:border-info focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span
                          className={`mt-1 size-2.5 shrink-0 rounded-full ${incident.severity === "critical" ? "bg-destructive" : incident.severity === "warning" ? "bg-warning" : "bg-info"}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="line-clamp-2 block text-xs font-semibold">
                            {incident.message}
                          </strong>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="capitalize">
                              {incident.severity}
                            </span>{" "}
                            ·{" "}
                            <SampleTime
                              value={incident.createdAt.toISOString()}
                              historical
                            />
                          </span>
                        </span>
                        <ChevronRight
                          className="mt-0.5 size-3 shrink-0"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/alerts?status=open"
                className="mt-auto inline-flex min-h-8 items-center justify-end gap-1 pt-2 text-xs underline"
              >
                View alerts <ArrowRight className="size-3" aria-hidden />
              </Link>
            </CardContent>
          </Card>
          <Card className="overview-panel min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="size-4 text-info" aria-hidden />
                Connection health
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats && !overview.error ? (
                <SourceStates stats={stats.devices} compact />
              ) : (
                <EmptyState title="Connection summary unavailable" />
              )}
              <p className="mt-2 text-[10px] text-muted-foreground">
                {demo
                  ? "Simulated source evidence"
                  : "Reported observation states"}{" "}
                · Unknown remains unknown
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
      <div className="overview-bottom-grid grid min-w-0 items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,2.15fr)_minmax(14rem,1fr)_minmax(13rem,.9fr)]">
        <div className="overview-telemetry min-w-0 lg:col-span-2 xl:col-span-1">
          {assetIds.length > 0 && assetIds.length <= 1000 ? (
            <ObservationTrend
              dashboard
              title="Factory observations"
              assetIds={assetIds}
              metric={metric}
              onMetricChange={(value) => update({ metric: value })}
              scope={demo ? "simulated" : "operational"}
              startTime={end - rangeMs}
              endTime={end}
              intervalMs={rangeMs === 86400000 ? 900000 : 60000}
              openHref="/analytics"
            />
          ) : (
            <Card className="overview-panel h-full">
              <CardHeader>
                <CardTitle>Factory observations</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  title={
                    assetIds.length > 1000
                      ? "Select a zone in Analytics for detailed comparisons"
                      : "No factory observations yet"
                  }
                  description="Connected equipment will contribute measurements to the factory trend."
                />
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="overview-panel overview-inventory min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-4 text-info" aria-hidden />
              Factory inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            {floor.data && !floor.error ? (
              <SystemItemTypes groups={floor.data.groups} />
            ) : (
              <EmptyState title="Inventory summary unavailable" />
            )}
          </CardContent>
        </Card>
        <OverviewInfrastructure />
      </div>
      <details className="rounded-lg border bg-card px-4 py-2 text-xs">
        <summary className="cursor-pointer font-medium">
          Process and FX / TSN evidence
        </summary>
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p>
              <strong>{stats?.alerts.open ?? "…"}</strong> open process
              incidents ·{" "}
              <span className="text-destructive">
                {stats?.alerts.critical ?? "…"} critical
              </span>{" "}
              ·{" "}
              <span className="text-warning">
                {stats?.alerts.warning ?? "…"} warning
              </span>
            </p>
            <p className="text-muted-foreground">
              <span>Confirmed downtime</span> ·{" "}
              {stats?.alerts.activeDowntime ?? "…"} explicitly confirmed events
            </p>
            <Link
              href="/cybersecurity"
              aria-label="Separate cybersecurity evidence"
              className="inline-flex min-h-8 items-center gap-1 underline"
            >
              Separate cybersecurity evidence{" "}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">FX / TSN health</h3>
            {network.error ? (
              <p>Network diagnostics unavailable</p>
            ) : !snapshots.length ? (
              <p className="text-muted-foreground">
                Connect a diagnostics collector to see FX components, streams
                and clock quality.
              </p>
            ) : (
              <>
                {coverage && coverage.returned < coverage.total && (
                  <p className="text-warning">
                    Coverage: {coverage.returned}/{coverage.total} gateway
                    reports
                  </p>
                )}
                <p>
                  {components.length} automation components ·{" "}
                  {connections.filter((c) => c.state === "operational").length}/
                  {connections.length} operational connections
                </p>
                <p>
                  Clock synchronisation{" "}
                  <Badge variant="outline">
                    {network.data?.stale
                      ? "Stale evidence"
                      : ports.every((p) => p.syncState === "locked") &&
                          ports.length
                        ? "Locked"
                        : "Needs review"}
                  </Badge>
                </p>
                <p className="text-muted-foreground">
                  {network.data?.synthetic
                    ? "Authored simulation · no physical TSN timing claim"
                    : network.data?.stale
                      ? "Stale collector evidence · review diagnostics"
                      : "Reported collector evidence"}
                </p>
              </>
            )}
            <Link
              href="/network"
              aria-label="Inspect FX / TSN"
              className="inline-flex min-h-8 items-center gap-1 underline"
            >
              Inspect FX / TSN <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}
