import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { Search, RefreshCw, SlidersHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { IncidentInvestigation } from "@/components/workspace/IncidentInvestigation";
import {
  PageHeader,
  EmptyState,
  SampleTime,
  SectionNav,
} from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/ExportButton";
export default function Alerts() {
  const { user } = useAuth(),
    { eventId } = useParams<{ eventId?: string }>(),
    [location, navigate] = useWorkspaceLocation(),
    active = useDocumentActive(),
    wide = useMediaQuery("(min-width:1280px)"),
    [filterOpen, setFilterOpen] = useState(false),
    params = new URLSearchParams(location.split("?")[1] ?? "");
  const search = (params.get("search") ?? "").slice(0, 100),
    status = ["open", "all", "active", "acknowledged", "resolved"].includes(
      params.get("status") ?? "",
    )
      ? params.get("status")!
      : "open",
    severity = ["critical", "warning", "info"].includes(
      params.get("severity") ?? "",
    )
      ? params.get("severity")!
      : "all",
    page = Math.max(0, Number(params.get("page") ?? 0) || 0),
    from = params.get("from") ?? "",
    to = params.get("to") ?? "",
    startTime =
      from && Number.isFinite(Date.parse(from)) ? Date.parse(from) : undefined,
    endTime =
      to && Number.isFinite(Date.parse(to))
        ? Date.parse(to) + 86399999
        : undefined,
    deviceId = /^[1-9]\d*$/.test(params.get("deviceId") ?? "")
      ? Number(params.get("deviceId"))
      : undefined;
  const filters = {
    search,
    status:
      status !== "all" && status !== "open"
        ? (status as "active" | "acknowledged" | "resolved")
        : undefined,
    openOnly: status === "open",
    severity:
      severity !== "all"
        ? (severity as "critical" | "warning" | "info")
        : undefined,
    startTime,
    endTime,
    deviceId,
  };
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page" && key !== "selected") next.delete("page");
    navigate(`/alerts?${next}`);
  };
  const settledSearch = useDebouncedValue(search);
  const queue = trpc.alerts.page.useQuery(
      { ...filters, search: settledSearch, page, pageSize: 25 },
      {
        enabled: !eventId,
        refetchInterval: active ? 30000 : false,
        refetchIntervalInBackground: false,
      },
    ),
    exportHistory = trpc.export.alertHistoryReport.useMutation(),
    context = `/alerts${params.size ? `?${params}` : ""}`,
    selected =
      queue.data?.items.find((e) => e.id === Number(params.get("selected"))) ??
      queue.data?.items[0];
  const requested = params.get("return"),
    back =
      requested?.startsWith("/alerts?") ||
      requested === "/alerts" ||
      requested === "/" ||
      requested?.startsWith("/?")
        ? requested
        : "/alerts?status=open";
  if (eventId)
    return (
      <div className="space-y-4">
        <Button asChild variant="outline">
          <Link href={back}>
            {back === "/" || back.startsWith("/?")
              ? "Return to overview"
              : "Return to incident queue"}
          </Link>
        </Button>
        {/^[1-9]\d*$/.test(eventId) ? (
          <IncidentInvestigation
            key={eventId}
            id={Number(eventId)}
            returnTo={back}
          />
        ) : (
          <EmptyState error title="Invalid incident link" />
        )}
      </div>
    );
  const control = "h-10 w-full rounded-md border border-input bg-card px-3";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        description="Review process incidents and track their resolution."
        action={
          <>
            <Button
              variant="outline"
              aria-label="Refresh alerts"
              onClick={() => void queue.refetch()}
              disabled={queue.isFetching}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            {!user?.access?.demoOnly && (
              <ExportButton
                label="Export history"
                onExportHtml={() =>
                  exportHistory.mutateAsync({
                    ...filters,
                    startTime: startTime ?? 0,
                    endTime: endTime ?? Date.now(),
                  })
                }
              />
            )}
          </>
        }
      />
      <SectionNav
        label="Incident views"
        value={status}
        sections={[
          { id: "open", label: "Open" },
          { id: "active", label: "Active" },
          { id: "acknowledged", label: "Acknowledged" },
          { id: "resolved", label: "Resolved" },
          { id: "all", label: "All history" },
        ]}
        onChange={(v) => update("status", v)}
      >
        <div className="rounded-lg border bg-card p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <Input
                aria-label="Search alerts"
                value={search}
                onChange={(e) => update("search", e.target.value)}
                className="pl-9"
                placeholder="Find a message, source or event code"
              />
            </div>
            <Button
              variant="outline"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <SlidersHorizontal className="size-4" />
              Filters
            </Button>
          </div>
          {filterOpen && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs">
                Severity
                <select
                  className={control}
                  aria-label="Severity"
                  value={severity}
                  onChange={(e) => update("severity", e.target.value)}
                >
                  {["all", "critical", "warning", "info"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                From (UTC)
                <Input
                  aria-label="From date"
                  type="date"
                  value={from}
                  onChange={(e) => update("from", e.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs">
                To (UTC)
                <Input
                  aria-label="To date"
                  type="date"
                  min={from || undefined}
                  value={to}
                  onChange={(e) => update("to", e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {queue.data?.total ?? "…"} matching incidents ·{" "}
          {severity === "all" ? "All severities" : severity} ·{" "}
          {from || to ? "Selected dates" : "All recorded history"}
          {deviceId ? ` · Source device:${deviceId}` : ""}
          {params.size > 0 && (
            <button
              className="ml-3 text-primary underline"
              onClick={() => navigate("/alerts")}
            >
              Clear filters
            </button>
          )}
        </p>
        {queue.isLoading ? (
          <EmptyState title="Loading incidents…" />
        ) : queue.error ? (
          <EmptyState
            error
            title="Incident queue unavailable"
            description={queue.error.message}
            action={
              <Button variant="outline" onClick={() => void queue.refetch()}>
                Retry
              </Button>
            }
          />
        ) : !queue.data?.items.length ? (
          <EmptyState
            title="No matching incidents"
            description="Adjust the search or filters. An empty process queue does not establish equipment availability or security."
          />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]">
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="hidden grid-cols-[90px_minmax(0,1fr)_110px] gap-3 border-b bg-info/5 p-3 text-xs font-medium text-info lg:grid">
                <span>Severity</span>
                <span>Incident / affected item</span>
                <span>Last observed</span>
              </div>
              <ul className="divide-y">
                {queue.data.items.map((e) => (
                  <li key={e.id}>
                    <Link
                      aria-current={
                        wide && selected?.id === e.id ? "true" : undefined
                      }
                      href={
                        wide
                          ? `/alerts?${new URLSearchParams({ ...Object.fromEntries(params), selected: String(e.id) })}`
                          : `/alerts/${e.id}?return=${encodeURIComponent(context)}`
                      }
                      className={`grid gap-3 p-4 hover:bg-muted/40 lg:grid-cols-[90px_minmax(0,1fr)_110px] ${wide && selected?.id === e.id ? "bg-primary/8" : ""}`}
                    >
                      <div>
                        <Badge variant="outline" className="capitalize">
                          {e.severity}
                        </Badge>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">{e.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {e.deviceName ?? "Observation source"} ·{" "}
                          {e.assignedToName ?? "Unassigned"}
                        </p>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">
                          {e.status}
                          {e.downtimeStartedAt && e.status !== "resolved"
                            ? " · Confirmed downtime"
                            : ""}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <SampleTime
                          value={(
                            e.lastObservedAt ?? e.createdAt
                          ).toISOString()}
                          historical
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t p-3">
                <span className="text-xs text-muted-foreground">
                  Showing {queue.data.returned} of {queue.data.total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!page}
                    onClick={() => update("page", String(page - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs">{page + 1}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!queue.data.hasMore}
                    onClick={() => update("page", String(page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
            {wide && selected && (
              <IncidentInvestigation
                key={selected.id}
                id={selected.id}
                returnTo={context}
                compact
              />
            )}
          </div>
        )}
      </SectionNav>
    </div>
  );
}
