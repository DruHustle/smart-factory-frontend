import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
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
import { ShowcaseJourney } from "@/components/workspace/ShowcaseJourney";
import {
  ObservationTrend,
  type TrendScope,
} from "@/components/workspace/ObservationTrend";
import {
  ProcessDistribution,
  SourceStates,
} from "@/components/workspace/OverviewGraphics";
import {
  SystemItemList,
  SystemItemTypes,
  FactoryConnections,
} from "@/components/workspace/SystemInventoryOverview";
import { observationHref } from "@shared/inventory";
import { metrics, type Metric } from "@shared/measurements";

const scopes: TrendScope[] = [
  "operational",
  "live",
  "simulated",
  "replay",
  "unknown",
  "all",
];
const periods = { "1h": 3600000, "24h": 86400000, "7d": 604800000 };
const pageSize = 12;

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
  const context = `/${params.size ? `?${params}` : ""}`;
  const scope = scopes.includes(params.get("scope") as TrendScope)
    ? (params.get("scope") as TrendScope)
    : user?.access?.demoOnly
      ? "simulated"
      : "operational";
  const range = Object.hasOwn(periods, params.get("range") ?? "")
    ? (params.get("range") as keyof typeof periods)
    : "1h";
  const metric = metrics.includes(params.get("metric") as Metric)
    ? (params.get("metric") as Metric)
    : "temperature";
  const showcase = trpc.system.showcase.useQuery(undefined, {
    staleTime: 300000,
  });
  const at = Number(params.get("at"));
  const end =
    params.has("at") &&
    Number.isFinite(at) &&
    at > 0 &&
    at <= Date.now() + 300000
      ? at
      : user?.access?.demoOnly && showcase.data
        ? Date.parse(showcase.data.anchor)
        : anchor;
  const requestedPage = Number(params.get("itemsPage"));
  const itemsPage = Number.isFinite(requestedPage)
    ? Math.min(100000, Math.max(0, Math.floor(requestedPage)))
    : 0;
  const requestedGatewayPage = Number(params.get("gatewaysPage"));
  const gatewaysPage = Number.isFinite(requestedGatewayPage)
    ? Math.min(100000, Math.max(0, Math.floor(requestedGatewayPage)))
    : 0;
  const overview = trpc.analytics.getOverview.useQuery(undefined, {
    refetchInterval: active ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  // System totals come from the complete authorized inventory. Only the visible
  // item cards are paginated; an item/trend/legacy equipment selection never
  // filters the overview or causes an arbitrary model to load.
  const fleet = trpc.inventory.list.useQuery(
    { page: itemsPage, pageSize, view: "all", sort: "name" },
    {
      staleTime: 30000,
      refetchInterval: active ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const requested = params.get("source") ?? "";
  const validRequested =
    /^(asset:[1-9]\d*|device:[1-9]\d*|equipment:[a-f0-9-]{36})$/.test(
      requested,
    );
  const lookup = trpc.inventory.item.useQuery(
    { ref: requested },
    {
      enabled:
        !!fleet.data &&
        validRequested &&
        !fleet.data.items.some((i) => i.ref === requested),
    },
  );
  const selected = requested
    ? (fleet.data?.items.find((i) => i.ref === requested) ??
      (lookup.error ? undefined : lookup.data))
    : undefined;
  const incidents = trpc.alerts.list.useQuery(
    { openOnly: true, limit: 5 },
    {
      refetchInterval: active ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const utils = trpc.useUtils();
  const refresh = () => {
    setAnchor(Date.now());
    return Promise.all([
      overview.refetch(),
      fleet.refetch(),
      incidents.refetch(),
      ...(validRequested
        ? [utils.inventory.item.invalidate({ ref: requested })]
        : []),
      ...(selected ? [utils.readings.trend.invalidate()] : []),
      utils.devices.monitor.invalidate(),
      utils.devices.getConnectedDevices.invalidate(),
      utils.devices.getConnectedAssets.invalidate(),
    ]);
  };
  const stats = overview.data,
    busy = overview.isFetching || fleet.isFetching || incidents.isFetching;
  const openTrend = selected
    ? `${observationHref(selected, context)}&scope=${scope}&metric=${metric}&from=${end - periods[range]}&to=${end}`
    : undefined;
  const control = "workspace-control";
  return (
    <div className="space-y-[var(--workspace-gap)]">
      <PageHeader
        title="Overview"
        description="All assets, gateways, devices and equipment across your system."
        action={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh overview"
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <Button asChild>
              <Link href="/inventory">
                Open inventory <ArrowRight className="size-4" />
              </Link>
            </Button>
          </>
        }
      />
      {user?.access?.demoOnly && !user.access.canSwitchData && (
        <p
          className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm"
          role="note"
        >
          <strong>Demo data · read-only.</strong> This session shows
          demonstration systems. Live data requires an individual account on
          your operational installation. Open “About demo and live data” beside
          the data selector to switch accounts.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span>
          {fleet.error
            ? "Inventory unavailable"
            : `${fleet.data?.total ?? "…"} registered items`}
        </span>
        <span>
          {overview.error
            ? "Incident summary unavailable"
            : `${stats?.alerts.open ?? "…"} open process incidents`}
        </span>
        <span>
          <span>Confirmed downtime</span> ·{" "}
          {overview.error
            ? "Summary unavailable"
            : `${stats?.alerts.activeDowntime ?? "…"} explicitly confirmed events`}
        </span>
        {user?.access?.demoOnly && (
          <Link
            href="/demo"
            className="rounded border border-info/40 bg-info/5 px-3 py-2 text-foreground underline"
          >
            Read-only simulation · Explore all demo chapters
          </Link>
        )}
      </div>
      <div className="grid items-stretch gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>System inventory</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every registered item, including connected, offline and
              unconfigured items. Linked 3D views belong to their item.
            </p>
          </CardHeader>
          <CardContent>
            {fleet.isLoading ? (
              <EmptyState title="Loading system inventory…" />
            ) : fleet.error || !fleet.data ? (
              <EmptyState
                error
                title="System inventory unavailable"
                action={
                  <Button
                    variant="outline"
                    onClick={() => void fleet.refetch()}
                  >
                    Retry inventory summary
                  </Button>
                }
              />
            ) : (
              <SystemItemTypes groups={fleet.data.groups} />
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Observation status</CardTitle>
            <p className="text-xs text-muted-foreground">
              Current connection evidence across authorized devices and
              gateways. Simulation does not establish physical connectivity.
            </p>
          </CardHeader>
          <CardContent>
            {overview.isLoading ? (
              <EmptyState title="Loading source states…" />
            ) : overview.error || !stats ? (
              <EmptyState error title="Source states unavailable" />
            ) : (
              <SourceStates stats={stats.devices} />
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 lg:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle>Process incident distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats && !overview.error ? (
              <ProcessDistribution stats={stats.alerts} />
            ) : (
              <EmptyState
                title={
                  overview.error
                    ? "Incident summary unavailable"
                    : "Loading incident distribution…"
                }
                error={!!overview.error}
              />
            )}
            <Link
              href="/cybersecurity"
              className="flex min-h-10 items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50"
            >
              <ShieldCheck className="size-5 text-info" />
              Review separate cybersecurity evidence{" "}
              <ArrowRight className="ml-auto size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
      <FactoryConnections
        page={gatewaysPage}
        onPage={(page) => update({ gatewaysPage: page ? String(page) : "" })}
        returnTo={context}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
        <SystemItemList
          data={fleet.data}
          page={itemsPage}
          pageSize={pageSize}
          isLoading={fleet.isLoading}
          isFetching={fleet.isFetching}
          error={fleet.error}
          onPage={(page) => update({ itemsPage: page ? String(page) : "" })}
          onRetry={() => void fleet.refetch()}
          returnTo={context}
        />
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Needs attention</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/alerts?status=open">
                Incident queue <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {incidents.isLoading ? (
              <EmptyState title="Loading incidents…" />
            ) : incidents.error ? (
              <EmptyState error title="Incidents unavailable" />
            ) : !incidents.data?.length ? (
              <EmptyState
                title="No open operational incidents"
                description="Recorded incident counts do not establish physical equipment health."
              />
            ) : (
              <>
                <p className="mb-4 text-xs text-muted-foreground">
                  Timeline · up to five most recently created open incidents.
                  Timestamps retain their evidence age.
                </p>
                <ol
                  className="ml-2 border-l border-border pl-5"
                  aria-label="Recent open process incident timeline"
                >
                  {incidents.data.map((event) => (
                    <li
                      key={event.id}
                      className="relative pb-5 before:absolute before:-left-[1.55rem] before:top-2 before:size-2.5 before:rounded-full before:border-2 before:border-card before:bg-primary"
                    >
                      <Link
                        href={`/alerts/${event.id}?return=${encodeURIComponent(context)}`}
                        className="block rounded-md p-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <span className="mb-2 block text-xs text-muted-foreground">
                          <SampleTime
                            value={event.createdAt.toISOString()}
                            historical
                          />
                        </span>
                        <strong className="block text-sm leading-snug">
                          {event.message}
                        </strong>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {event.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {event.status} ·{" "}
                            {event.assignedToName ?? "Unassigned"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <details open={!!requested} className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Inspect an item’s telemetry
        </summary>
        <p className="my-3 text-xs text-muted-foreground">
          Select a source for detailed measurements, or open Monitoring and
          Analytics to compare observations across the system.
        </p>
        <div className="min-w-0 space-y-3">
          <section
            aria-label="Overview telemetry scope"
            className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3"
          >
            <label className="min-w-0 space-y-1 text-xs">
              <span>Trend source · items on this page</span>
              <select
                aria-label="Overview trend source"
                className={control}
                value={selected?.ref ?? ""}
                onChange={(e) => update({ source: e.target.value, at: "" })}
              >
                <option value="">Choose an item</option>
                {selected &&
                  !fleet.data?.items.some((i) => i.ref === selected.ref) && (
                    <option value={selected.ref}>{selected.name}</option>
                  )}
                {fleet.data?.items.map((i) => (
                  <option key={i.ref} value={i.ref}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>Telemetry evidence</span>
              <select
                aria-label="Overview evidence scope"
                className={control}
                value={scope}
                onChange={(e) => update({ scope: e.target.value })}
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>Time range (UTC)</span>
              <select
                aria-label="Overview time range"
                className={control}
                value={range}
                onChange={(e) => update({ range: e.target.value })}
              >
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </label>
            {selected?.sampleAt != null && (
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-3">
                <span className="text-xs text-muted-foreground">
                  {params.has("at")
                    ? "Historical window ending at recorded sample"
                    : "Window ending at overview refresh"}{" "}
                  · latest sample{" "}
                  <SampleTime value={selected.sampleAt} historical />
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      at: params.has("at") ? "" : String(selected.sampleAt),
                    })
                  }
                >
                  {params.has("at")
                    ? "Return to recent window"
                    : "Show latest recorded window"}
                </Button>
              </div>
            )}
          </section>
          {selected ? (
            <ObservationTrend
              key={selected.ref}
              title={`${selected.name} · observed trend`}
              deviceId={
                selected.kind === "device" ? Number(selected.id) : undefined
              }
              assetIds={
                selected.kind !== "device" ? [selected.identifier] : undefined
              }
              scope={scope}
              metric={metric}
              onMetricChange={(value) => update({ metric: value })}
              startTime={end - periods[range]}
              endTime={end}
              intervalMs={
                range === "7d" ? 3600000 : range === "24h" ? 900000 : 60000
              }
              openHref={openTrend}
            />
          ) : (
            <EmptyState
              title={
                fleet.error || lookup.error
                  ? "Trend source unavailable"
                  : "No observation source selected"
              }
              description="Choose an item to inspect its measurements. System totals above always include all items."
            />
          )}
        </div>
      </details>
      {showcase.data && (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Isolated simulation walkthrough
          </summary>
          <div className="mt-3">
            <ShowcaseJourney />
          </div>
        </details>
      )}
    </div>
  );
}
