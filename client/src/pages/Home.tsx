import { FactorySelector } from "@/components/workspace/FactorySelector";
import { useRuntimeCapability } from "@/components/RuntimeBoundary";
import { FactoryWorkspace } from "@/components/workspace/FactoryWorkspace";
import { useFactorySelection } from "@/lib/factory-selection";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  RefreshCw,
  Boxes,
  Radio,
  WifiOff,
  CircleHelp,
  Clock3,
  ChevronRight,
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
import { OverviewInfrastructure } from "@/components/workspace/OverviewInfrastructure";
import { SystemItemTypes } from "@/components/workspace/SystemInventoryOverview";
import { metrics, type Metric } from "@shared/measurements";
import type { FloorLink } from "@shared/factory-floor";
import { OperationsWorkspace } from "@/components/operations/OperationsWorkspace";
import { TimeZoneDialog } from "@/components/operations/OperationsPanel";
import { DashboardTimeZone } from "@/components/workspace/DashboardTimeZone";
import { operationScenarios, type OperationScenario } from "@shared/operations";
import {
  ALL_ASSET_OBSERVATIONS,
  selectOverviewObservationSource,
} from "@/lib/overview-observations";

export default function Home() {
  const { id } = useFactorySelection();
  const { user } = useAuth();
  const supported = useRuntimeCapability("ot-operations-v1");
  const timezoneSupported = useRuntimeCapability("ot-site-timezone-v1");
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [location] = useWorkspaceLocation();
  const requested = new URLSearchParams(location.split("?")[1] ?? "").get(
    "otScenario",
  );
  const scenario = operationScenarios.includes(requested as OperationScenario)
    ? (requested as OperationScenario)
    : "healthy";
  const operations = trpc.operations.summary.useQuery(
    {
      factoryId: user?.access?.demoOnly ? undefined : (id ?? undefined),
      scenario,
    },
    { enabled: supported, staleTime: 15000, retry: false },
  );
  const timezoneAction =
    user?.access?.canEngineer &&
    timezoneSupported &&
    operations.data &&
    !operations.data.demo ? (
      <>
        <Button
          variant="outline"
          className="min-h-11 max-w-64"
          aria-label={`Change factory timezone, current ${operations.data.configuration.timeZone}`}
          onClick={() => setTimezoneOpen(true)}
        >
          <Clock3 className="mr-1 size-4 shrink-0" />
          <span className="truncate">
            Timezone: {operations.data.configuration.timeZone}
          </span>
        </Button>
        {timezoneOpen && (
          <TimeZoneDialog
            data={operations.data}
            factoryId={id ?? undefined}
            onClose={() => setTimezoneOpen(false)}
            onSaved={() => operations.refetch()}
          />
        )}
      </>
    ) : null;
  return id ? (
    <DashboardTimeZone.Provider value={operations.data?.configuration.timeZone}>
      <FactoryWorkspace
        key={id}
        id={id}
        mode="overview"
        overviewAction={timezoneAction}
      />
    </DashboardTimeZone.Provider>
  ) : (
    <DashboardTimeZone.Provider value={operations.data?.configuration.timeZone}>
      <LegacyHome timezoneAction={timezoneAction} />
    </DashboardTimeZone.Provider>
  );
}
function LegacyHome({ timezoneAction }: { timezoneAction?: ReactNode }) {
  const active = useDocumentActive(),
    { user } = useAuth();
  const [location, navigate] = useWorkspaceLocation(),
    [anchor, setAnchor] = useState(() => Date.now()),
    [actionPage, setActionPage] = useState(0);
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
  const incidentPrioritySupported = useRuntimeCapability(
    "ot-incident-review-v1",
  );
  const incidents = trpc.alerts.list.useQuery(
    { openOnly: true, limit: 2, order: "severity" },
    { ...options, enabled: incidentPrioritySupported },
  );
  const actionsSupported = useRuntimeCapability("ot-follow-up-actions-v1");
  const actions = trpc.alerts.actionQueue.useQuery(
    { page: actionPage, pageSize: 3 },
    {
      ...options,
      enabled: actionsSupported,
      retry: false,
      placeholderData: (previous) => previous,
    },
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
  const observations = selectOverviewObservationSource(
    items,
    metric,
    params.get("observationSource"),
  );
  const pinnedWindow = params.has("at") && at > 0 && at <= Date.now() + 300000;
  useEffect(() => {
    if (!active || demo || pinnedWindow) return;
    setAnchor(Date.now());
    const timer = window.setInterval(() => setAnchor(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [active, demo, pinnedWindow]);
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
      ...(incidentPrioritySupported ? [incidents.refetch()] : []),
      ...(actionsSupported ? [actions.refetch()] : []),
      network.refetch(),
    ]);
  };
  const kpis = [
    {
      title: "Registered items",
      shortTitle: "Items",
      value: floor.error ? "Unavailable" : (floor.data?.total ?? "…"),
      icon: Boxes,
      href: "/inventory",
    },
    {
      title: "Online",
      shortTitle: "Online",
      value: overview.error ? "Unavailable" : (stats?.devices.online ?? "…"),
      icon: Radio,
      href: "/monitoring?status=live",
    },
    {
      title: "Offline",
      shortTitle: "Offline",
      value: overview.error ? "Unavailable" : (stats?.devices.offline ?? "…"),
      icon: WifiOff,
      href: "/monitoring?status=offline",
    },
    {
      title: "Needs review",
      shortTitle: "Review",
      value: overview.error
        ? "Unavailable"
        : stats
          ? stats.devices.stale +
            stats.devices.unknown +
            stats.devices.maintenance +
            stats.devices.error
          : "…",
      icon: CircleHelp,
      href: "/monitoring",
      description: "Unknown, stale, maintenance or error status",
    },
  ];
  const attentionEmpty =
    incidentPrioritySupported &&
    !incidents.isLoading &&
    !incidents.error &&
    !overview.error &&
    stats?.alerts.open === 0 &&
    incidents.data?.length === 0;
  const showAttentionPanel =
    !attentionEmpty ||
    !!(
      actionsSupported &&
      (actions.data?.items.length || actionPage > 0 || actions.error)
    );
  const incidentCount = overview.error
    ? "Unavailable"
    : (stats?.alerts.open ?? "…");
  return (
    <div
      className="factory-overview space-y-3"
      data-testid="factory-overview-dashboard"
    >
      <PageHeader
        title="Overview"
        action={
          <>
            <div className="overview-controls flex flex-wrap items-center gap-2">
              <FactorySelector compact />
              <select
                aria-label="Overview time range"
                value={rangeMs === 86400000 ? "24h" : "1h"}
                onChange={(e) => update({ range: e.target.value })}
                className="overview-range workspace-control h-9 w-auto text-xs"
              >
                <option value="1h">Last 60 min</option>
                <option value="24h">Last 24 hours</option>
              </select>
              <Button
                variant="outline"
                size="icon"
                className="overview-refresh size-9"
                aria-label="Refresh overview"
                onClick={refresh}
                disabled={busy}
              >
                <RefreshCw
                  className={`size-4 ${busy ? "motion-safe:animate-spin" : ""}`}
                />
              </Button>
            </div>
            {timezoneAction}
          </>
        }
      />
      <section className="overview-summary" aria-label="Factory summary">
        <div className="overview-kpis">
          {kpis.map((kpi) => (
            <Link
              key={kpi.title}
              href={kpi.href}
              title={kpi.description}
              aria-label={`${kpi.title} ${kpi.value}`}
              className="overview-kpi transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <kpi.icon
                className="overview-kpi-icon size-4 shrink-0 text-info"
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="overview-kpi-label block text-xs text-muted-foreground">
                  <span className="hidden sm:inline">{kpi.title}</span>
                  <span className="sm:hidden">{kpi.shortTitle}</span>
                </span>
                <strong
                  className={`overview-kpi-value block font-semibold tabular-nums ${String(kpi.value).length > 8 ? "overview-kpi-text" : ""}`}
                >
                  {kpi.value}
                </strong>
              </span>
            </Link>
          ))}
        </div>
        <div className="overview-incident-summary">
          <Link
            href="/alerts?status=open"
            className="overview-incident-count inline-flex items-center gap-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span
              className={`size-2 shrink-0 rounded-full ${overview.error ? "bg-muted-foreground" : stats?.alerts.critical ? "bg-destructive" : stats?.alerts.open ? "bg-warning" : "bg-info"}`}
              aria-hidden
            />
            <span>
              Open incidents{" "}
              <strong className="tabular-nums">{incidentCount}</strong>
            </span>
            <ArrowRight className="size-3" aria-hidden />
          </Link>
          {attentionEmpty && (
            <p className="text-xs text-muted-foreground">
              No open process incidents.
            </p>
          )}
        </div>
      </section>
      <div
        className={`overview-main-grid grid min-w-0 items-start gap-3 ${showAttentionPanel ? "xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.35fr)]" : ""}`}
      >
        {showAttentionPanel && (
          <aside
            aria-label="Factory status"
            className="overview-status order-1 min-w-0 xl:order-2"
          >
            <Card
              className={`overview-panel min-w-0 ${attentionEmpty ? "overview-attention-empty" : ""}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock3 className="size-4 text-info" aria-hidden />
                  Needs attention
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                {!incidentPrioritySupported ? (
                  <p className="text-xs text-muted-foreground">
                    Priority view unavailable. Open alerts to review incidents.
                  </p>
                ) : incidents.error ? (
                  <EmptyState error title="Incidents unavailable" />
                ) : incidents.isLoading ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    Loading incidents…
                  </p>
                ) : !incidents.data?.length ? (
                  <p className="overview-attention-message py-3 text-xs text-muted-foreground">
                    {attentionEmpty
                      ? "No open process incidents."
                      : "No incident details in this response. Open alerts for the current queue."}
                  </p>
                ) : (
                  <ul
                    className="space-y-2"
                    aria-label="Incidents needing attention"
                  >
                    {incidents.data.map((incident) => (
                      <li key={incident.id}>
                        <Link
                          href={`/alerts/${incident.id}?return=${encodeURIComponent(location)}`}
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
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {incident.deviceName ?? "Equipment unavailable"}
                            </span>
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
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              {incident.assignedToName ??
                                (incident.assignedToId
                                  ? "Owner unavailable"
                                  : "Unassigned")}{" "}
                              · Review {incident.status}
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
                  className="overview-alerts-link mt-auto inline-flex min-h-8 items-center justify-end gap-1 pt-2 text-xs underline"
                >
                  View alerts <ArrowRight className="size-3" aria-hidden />
                </Link>
              </CardContent>
            </Card>
            {actionsSupported &&
            (actions.data?.items.length || actionPage > 0) ? (
              <details className="mt-3 rounded-lg border bg-card p-3 text-xs">
                <summary className="cursor-pointer font-medium">
                  Follow-up ·{" "}
                  {actionPage
                    ? `page ${actionPage + 1}`
                    : `${actions.data?.items.length ?? 0}${actions.data?.hasMore ? "+" : ""}`}
                </summary>
                {actions.isPlaceholderData ? (
                  <p role="status" className="mt-2 text-muted-foreground">
                    Loading actions…
                  </p>
                ) : (
                  !actions.error && (
                    <ul
                      className="mt-2 space-y-2"
                      aria-label="Outstanding follow-up actions"
                    >
                      {actions.data?.items.map((action) => (
                        <li key={action.id}>
                          <Link
                            href={`/alerts/${action.incidentId}?return=${encodeURIComponent(location)}`}
                            className="block rounded-md border p-2 hover:border-info focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <strong className="block">{action.title}</strong>
                            <span className="mt-1 block text-muted-foreground">
                              {action.deviceName ?? "Source unavailable"} ·{" "}
                              {action.ownerName ?? "Owner unavailable"}
                              {action.dueDate ? ` · Due ${action.dueDate}` : ""}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                )}
                {actions.error && (
                  <p role="alert" className="mt-2">
                    Actions unavailable.{" "}
                    <button
                      className="underline"
                      onClick={() => void actions.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                )}
                {!actions.isFetching && !actions.data?.items.length && (
                  <p className="mt-2 text-muted-foreground">
                    No actions on this page.
                  </p>
                )}
                {(actionPage > 0 || actions.data?.hasMore) && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actions.isFetching || actionPage === 0}
                      onClick={() => setActionPage((page) => page - 1)}
                    >
                      Previous actions
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        actions.isFetching ||
                        !actions.data?.hasMore ||
                        actionPage >= 100000
                      }
                      onClick={() => setActionPage((page) => page + 1)}
                    >
                      Next actions
                    </Button>
                  </div>
                )}
              </details>
            ) : actionsSupported && actions.error ? (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                Follow-up actions unavailable.{" "}
                <button
                  className="underline"
                  onClick={() => void actions.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : null}
          </aside>
        )}
        <div className="order-2 min-w-0 xl:order-1">
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
      </div>
      <OperationsWorkspace compact />
      <div className="overview-bottom-grid grid min-w-0 items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,2.15fr)_minmax(14rem,1fr)_minmax(13rem,.9fr)]">
        <div className="overview-telemetry min-w-0 lg:col-span-2 xl:col-span-1">
          {observations.value ? (
            <ObservationTrend
              dashboard
              title="Factory observations"
              {...observations.input}
              sourceLabel={`Source: ${observations.label}${observations.source ? "" : " · asset observations only"}`}
              sourceControl={
                <label className="overview-observation-source flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0">Source</span>
                  <select
                    aria-label="Overview observation source"
                    className="workspace-control min-w-0 w-full"
                    value={observations.selection}
                    onChange={(event) =>
                      update({ observationSource: event.target.value })
                    }
                  >
                    <option value="auto">Choose automatically</option>
                    {observations.aggregateAvailable && (
                      <option value={ALL_ASSET_OBSERVATIONS}>
                        All registered assets
                      </option>
                    )}
                    {observations.sources.map((source) => (
                      <option key={source.ref} value={source.ref}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>
              }
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
                    observations.assetIds.length > 1000
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
