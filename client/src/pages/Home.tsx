import { ShowcaseJourney } from "@/components/workspace/ShowcaseJourney";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  PageHeader,
  SampleTime,
  StatusBadge,
  SummaryMetric,
} from "@/components/workspace/Primitives";
import { itemHref } from "@shared/inventory";

export default function Home() {
  const active = useDocumentActive();
  const overview = trpc.analytics.getOverview.useQuery(undefined, {
    refetchInterval: active ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const fleet = trpc.inventory.list.useQuery({
    page: 0,
    pageSize: 5,
    view: "all",
  });
  const incidents = trpc.alerts.list.useQuery({ openOnly: true, limit: 5 });
  const stats = overview.data;
  const refresh = () =>
    Promise.all([overview.refetch(), fleet.refetch(), incidents.refetch()]);
  const busy = overview.isFetching || fleet.isFetching || incidents.isFetching;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Your equipment, observed connectivity and operational work in one place."
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
      <ShowcaseJourney />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryMetric
          label="Items"
          value={fleet.error ? "Unavailable" : (fleet.data?.total ?? "…")}
          description="Assets, devices and equipment"
        />
        <SummaryMetric
          label="Observed online"
          value={
            overview.error
              ? "Unavailable"
              : stats
                ? `${stats.devices.online} / ${stats.devices.total}`
                : "…"
          }
          description={
            stats
              ? `${stats.devices.stale} stale · ${stats.devices.unknown} unknown`
              : "Connectivity observations"
          }
        />
        <SummaryMetric
          label="Open incidents"
          value={overview.error ? "Unavailable" : (stats?.alerts.open ?? "…")}
          description={
            stats
              ? `${stats.alerts.critical} critical · ${stats.alerts.warning} warning`
              : "Operational incidents"
          }
        />
        <SummaryMetric
          label="Confirmed downtime"
          value={
            overview.error
              ? "Unavailable"
              : (stats?.alerts.activeDowntime ?? "…")
          }
          description="Active, explicitly confirmed events"
        />
      </div>
      {overview.error && (
        <EmptyState
          error
          title="Summary unavailable"
          description="The data service could not return the current summary. Try refreshing."
        />
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Needs attention</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/alerts?status=open">
                Incident queue <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {incidents.isLoading ? (
              <p role="status" className="py-4 text-muted-foreground">
                Loading incidents…
              </p>
            ) : incidents.error ? (
              <EmptyState
                error
                title="Incidents unavailable"
                description="Refresh to retry the operational queue."
              />
            ) : !incidents.data?.length ? (
              <div className="rounded-md border p-4">
                <p className="font-medium">No open operational incidents</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This describes recorded incidents. Check source freshness
                  before drawing conclusions about physical equipment.
                </p>
              </div>
            ) : (
              <ul className="divide-y rounded-md border">
                {incidents.data.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`/alerts/${event.id}`}
                      className="flex items-start gap-3 p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <AlertTriangle
                        aria-hidden
                        className={`mt-0.5 size-4 shrink-0 ${event.severity === "critical" ? "text-destructive" : "text-warning"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-snug">
                          {event.message}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {event.deviceName ?? "Observation source"} ·{" "}
                          <SampleTime value={event.createdAt.toISOString()} />
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {event.assignedToName
                            ? `Assigned to ${event.assignedToName}`
                            : "Unassigned"}{" "}
                          · {event.status}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {event.severity}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!!stats && stats.devices.stale + stats.devices.unknown > 0 && (
              <Link
                href="/monitoring"
                className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <span>
                  <span className="block font-medium">
                    Review disconnected sources
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stats.devices.stale} stale · {stats.devices.unknown} with
                    no current observation
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0" />
              </Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Fleet at a glance</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/inventory">
                All items <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {fleet.isLoading ? (
              <p role="status" className="py-4 text-muted-foreground">
                Loading inventory…
              </p>
            ) : fleet.error ? (
              <EmptyState
                error
                title="Inventory unavailable"
                description="Refresh to retry this view."
              />
            ) : !fleet.data?.items.length ? (
              <EmptyState
                title="Start with your first item"
                description="Register an IoT device or gateway, create an asset, or open a 3D equipment workspace."
                action={
                  <Button variant="outline" asChild>
                    <Link href="/inventory">Browse setup options</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {fleet.data.items.map((item) => (
                  <li key={item.ref}>
                    <Link
                      href={itemHref(item.ref, "overview", "/")}
                      className="flex items-center justify-between gap-3 rounded-md py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span
                          className="block truncate font-medium"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground capitalize">
                          {item.itemType.replaceAll("_", " ")} ·{" "}
                          {item.zone || item.location || "Location unassigned"}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          <SampleTime
                            value={item.sampleAt ?? item.lastObserved}
                          />{" "}
                          · {item.mode}
                        </span>
                      </span>
                      <StatusBadge status={item.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [
            "Monitoring",
            "Readings, quality and source freshness",
            "/monitoring",
          ],
          [
            "Cybersecurity",
            "Coverage and evidence-led investigations",
            "/cybersecurity",
          ],
          ["Analytics", "Observed results over a chosen period", "/analytics"],
        ].map(([title, description, href]) => (
          <Link
            key={href}
            href={href}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 hover:bg-muted/50"
          >
            <span>
              <span className="block font-medium">{title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {description}
              </span>
            </span>
            <ArrowRight aria-hidden className="size-4 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
