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
import {
  ProcessDistribution,
  SourceStates,
} from "@/components/workspace/OverviewGraphics";
import { SystemItemTypes } from "@/components/workspace/SystemInventoryOverview";
import { metrics, type Metric } from "@shared/measurements";
import type { FloorLink } from "@shared/factory-floor";

export default function Home() {
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
    { openOnly: true, limit: 3 },
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
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Your factory floor, equipment activity and connection health at a glance."
        action={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh overview"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <Button asChild>
              <Link href="/inventory">
                Assets & devices <ArrowRight className="size-4" />
              </Link>
            </Button>
          </>
        }
      />
      {demo && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs"
          role="note"
        >
          <span>
            <strong>Demo factory · simulated evidence.</strong>{" "}
            {user?.access?.canSwitchData
              ? "Switch to Live data to view your operational installation."
              : "Live data requires an individual account on your operational installation."}
          </span>
          <Link
            href="/demo"
            className="inline-flex min-h-8 items-center gap-1 underline"
          >
            Demo guide <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <Link
            key={kpi.title}
            href={kpi.href}
            className="min-w-0 rounded-xl border bg-card p-3 transition-colors hover:border-info"
          >
            <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              {kpi.title}
              <kpi.icon className="size-4 shrink-0 text-info" />
            </span>
            <strong className="mt-2 block truncate text-2xl font-semibold tabular-nums">
              {kpi.value}
            </strong>
          </Link>
        ))}
      </div>
      {floor.isLoading ? (
        <div className="flex h-[32rem] items-center justify-center rounded-xl border bg-card">
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
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Factory inventory</CardTitle>
          </CardHeader>
          <CardContent>
            {floor.data && !floor.error ? (
              <SystemItemTypes groups={floor.data.groups} />
            ) : (
              <EmptyState title="Inventory summary unavailable" />
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Connection evidence</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && !overview.error ? (
              <SourceStates stats={stats.devices} />
            ) : (
              <EmptyState title="Connection summary unavailable" />
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Process incidents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats && !overview.error ? (
              <ProcessDistribution stats={stats.alerts} />
            ) : (
              <EmptyState title="Incident summary unavailable" />
            )}
            <p className="text-xs text-muted-foreground">
              <span>Confirmed downtime</span> ·{" "}
              {stats?.alerts.activeDowntime ?? "…"} explicitly confirmed events
            </p>
            <Link
              href="/cybersecurity"
              className="inline-flex min-h-9 items-center gap-2 text-xs underline"
            >
              Separate cybersecurity evidence <ArrowRight className="size-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 rounded-xl border bg-card p-4">
          {assetIds.length > 0 && assetIds.length <= 1000 ? (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                Factory trend · all {assetIds.length} registered
                assets/equipment · bucket averages of verified samples ·{" "}
                {demo ? "simulated" : "operational"} evidence
              </p>
              <ObservationTrend
                title="Factory observations"
                assetIds={assetIds}
                metric={metric}
                onMetricChange={(value) => update({ metric: value })}
                scope={demo ? "simulated" : "operational"}
                startTime={end - 3600000}
                endTime={end}
                intervalMs={60000}
                openHref="/analytics"
              />
            </>
          ) : (
            <EmptyState
              title={
                assetIds.length > 1000
                  ? "Select a zone in Analytics for detailed comparisons"
                  : "No factory observations yet"
              }
              description="Connected equipment will contribute measurements to the factory trend."
            />
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>FX / TSN health</CardTitle>
              <Link href="/network" className="text-xs underline">
                Inspect <ArrowRight className="inline size-3" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {network.error ? (
                <EmptyState error title="Network diagnostics unavailable" />
              ) : !snapshots.length ? (
                <p className="text-muted-foreground">
                  Connect a diagnostics collector to see FX components, streams
                  and clock quality.
                </p>
              ) : (
                <>
                  {coverage && coverage.returned < coverage.total && (
                    <p className="text-xs text-warning">
                      Coverage: {coverage.returned}/{coverage.total} gateway
                      reports
                    </p>
                  )}
                  <div className="flex justify-between">
                    <span>Automation components</span>
                    <strong>{components.length}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Operational connections</span>
                    <strong>
                      {
                        connections.filter((c) => c.state === "operational")
                          .length
                      }
                      /{connections.length}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Clock synchronisation</span>
                    <Badge variant="outline">
                      {network.data?.stale
                        ? "Stale evidence"
                        : ports.every((p) => p.syncState === "locked") &&
                            ports.length
                          ? "Locked"
                          : "Needs review"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {network.data?.synthetic
                      ? "Authored simulation · no physical TSN timing claim"
                      : network.data?.stale
                        ? "Stale collector evidence · review diagnostics"
                        : "Reported collector evidence"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Needs attention</CardTitle>
              <Link href="/alerts?status=open" className="text-xs underline">
                All incidents
              </Link>
            </CardHeader>
            <CardContent>
              {incidents.error ? (
                <EmptyState error title="Incidents unavailable" />
              ) : !incidents.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No open process incidents.
                </p>
              ) : (
                <ul className="divide-y">
                  {incidents.data.map((incident) => (
                    <li key={incident.id} className="py-3 first:pt-0">
                      <Link
                        href={`/alerts/${incident.id}`}
                        className="block text-sm hover:underline"
                      >
                        <strong className="font-medium">
                          {incident.message}
                        </strong>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{incident.severity}</Badge>
                          <SampleTime
                            value={incident.createdAt.toISOString()}
                            historical
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
