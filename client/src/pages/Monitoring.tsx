import { currentSample } from "@shared/measurements";
import {
  EvidencePath,
  EquipmentSymbol,
  ReceiptChange,
} from "@/components/workspace/VisualEvidence";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ObservationTrend } from "@/components/workspace/ObservationTrend";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { measurementValue } from "@shared/measurements";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  RefreshCw,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  Measurement,
  PageHeader,
  SampleTime,
  StatusBadge,
} from "@/components/workspace/Primitives";
import { observationHref } from "@shared/inventory";
import {
  canonicalUnits,
  measurementUnit,
  metrics,
  type Metric,
} from "@shared/measurements";
import type { EvidenceScope } from "../../../server/evidenceScope";
import { useWorkspaceLocation } from "@/lib/hashLocation";
const scopes = [
  "operational",
  "live",
  "simulated",
  "replay",
  "unknown",
  "all",
] as const;
export default function Monitoring() {
  const { user } = useAuth(),
    wide = useMediaQuery("(min-width: 1280px)"),
    [location, navigate] = useWorkspaceLocation(),
    active = useDocumentActive(),
    [paused, setPaused] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const search = params.get("search") ?? "",
    type = params.get("type") ?? "all",
    status = params.get("status") ?? "all",
    scope = (params.get("scope") ??
      (user?.access?.demoOnly ? "simulated" : "operational")) as EvidenceScope,
    page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    navigate(`/monitoring?${next}`);
  };
  const settledSearch = useDebouncedValue(search);
  const sources = trpc.devices.monitor.useQuery(
    {
      search: settledSearch,
      type: type as any,
      status: status as any,
      page,
      pageSize: 25,
    },
    {
      refetchInterval: active && !paused ? 30_000 : false,
      refetchIntervalInBackground: false,
      placeholderData: (previous) => previous,
    },
  );
  const ids = sources.data?.items.map((d) => d.id) ?? [];
  const readings = trpc.readings.getLatestBatch.useQuery(
    { deviceIds: ids, scope: scopes.includes(scope) ? scope : "operational" },
    {
      enabled: !!ids.length,
      refetchInterval: active && !paused ? 30_000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const latest = useMemo(
    () => new Map(readings.data?.map((r) => [r.deviceId, r])),
    [readings.data],
  );
  const refresh = () => Promise.all([sources.refetch(), readings.refetch()]);
  const renderValues = (id: number) => {
    const r = latest.get(id);
    if (readings.error)
      return <p className="text-sm text-destructive">Readings unavailable</p>;
    if (!r)
      return (
        <p className="text-sm text-muted-foreground">
          {readings.isFetching
            ? "Loading readings…"
            : "No observations in this evidence scope"}
        </p>
      );
    const evidence = r.integration?.evidence as { reason?: string } | undefined,
      available = metrics.filter((m) => r[m] != null || r.measurements?.[m]);
    if (
      evidence?.reason === "sensor_read_error" ||
      r.integration?.sourceQuality === "bad"
    )
      return (
        <p className="text-sm text-destructive">
          Sensor read unavailable ·{" "}
          {evidence?.reason?.replaceAll("_", " ") ?? "bad source quality"}
        </p>
      );
    return (
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {available.length ? (
          available.map((m) => (
            <div key={m}>
              <p className="text-xs capitalize text-muted-foreground">{m}</p>
              <ReceiptChange at={r.timestamp} eligible={currentSample(r)}>
                <Measurement
                  value={measurementValue(r, m)}
                  unit={measurementUnit(r, m)}
                />
              </ReceiptChange>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No scalar measurements in this sample
          </p>
        )}
      </div>
    );
  };
  const selected =
    sources.data?.items.find((d) => d.id === Number(params.get("selected"))) ??
    sources.data?.items.find(
      (d) =>
        d.type !== "gateway" &&
        latest.has(d.id) &&
        currentSample(latest.get(d.id)!),
    ) ??
    sources.data?.items.find((d) => d.type !== "gateway" && latest.has(d.id)) ??
    sources.data?.items.find((d) => d.type !== "gateway");
  const selectedReading = selected ? latest.get(selected.id) : undefined;
  const context = `/monitoring${params.size ? `?${params}` : ""}`;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Monitoring"
        description="Source readings, quality and freshness. Stored samples retain their evidence mode."
        action={
          <>
            <Button variant="outline" onClick={() => setPaused(!paused)}>
              {paused ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              aria-label="Refresh monitoring"
              disabled={sources.isFetching || readings.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </>
        }
      />
      <div className="rounded-lg border bg-card p-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="absolute left-3 top-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label="Search sources"
              value={search}
              onChange={(e) => update("search", e.target.value)}
              placeholder="Find a source or location"
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal className="size-4" />
            Filters
          </Button>
        </div>
        {filtersOpen && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              [
                "Type",
                "type",
                type,
                [
                  "all",
                  "sensor",
                  "edge_device",
                  "gateway",
                  "actuator",
                  "controller",
                ],
              ],
              [
                "Status",
                "status",
                status,
                [
                  "all",
                  "live",
                  "stale",
                  "offline",
                  "unknown",
                  "maintenance",
                  "error",
                ],
              ],
              ["Evidence scope", "scope", scope, scopes],
            ].map(([label, key, value, options]) => (
              <label
                key={String(key)}
                className="space-y-1 text-xs font-medium"
              >
                <span>{String(label)}</span>
                <select
                  aria-label={String(label)}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={String(value)}
                  onChange={(e) => update(String(key), e.target.value)}
                >
                  {(options as readonly string[]).map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {sources.data?.total ?? "…"} sources · {scope} evidence ·{" "}
        {paused
          ? "Updates paused"
          : !active
            ? "Updates paused while hidden or offline"
            : "Automatic refresh every 30 seconds"}
      </p>
      {sources.isLoading ? (
        <EmptyState title="Loading observation sources…" />
      ) : sources.error ? (
        <EmptyState
          error
          title="Sources unavailable"
          description={sources.error.message}
          action={
            <Button onClick={() => void refresh()} variant="outline">
              Retry
            </Button>
          }
        />
      ) : !sources.data?.items.length ? (
        <EmptyState
          title="No matching sources"
          description="Adjust the filters or register a source in Assets & devices."
          action={
            <Button asChild variant="outline">
              <Link href="/inventory">Open inventory</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="hidden grid-cols-[minmax(120px,1fr)_80px_minmax(120px,1fr)] gap-4 border-b border-info/30 bg-info/5 px-4 py-3 text-xs font-medium text-info lg:grid">
              <span>Source</span>
              <span>Observed state</span>
              <span>Measurements</span>
            </div>
            {sources.data!.items.map((d) => {
              const r = latest.get(d.id),
                href = observationHref(
                  { ref: `device:${d.id}`, kind: "device", itemType: d.type },
                  context,
                );
              return (
                <article
                  key={d.id}
                  className="grid min-w-0 gap-3 border-b p-4 last:border-0 lg:grid-cols-[minmax(120px,1fr)_80px_minmax(120px,1fr)] lg:items-center lg:gap-4"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        className="flex max-w-full items-center gap-2 text-left font-medium hover:underline"
                        onClick={() => update("selected", String(d.id))}
                        title={d.name}
                      >
                        <EquipmentSymbol
                          type={d.type}
                          className="size-6 text-info"
                        />
                        <span className="truncate">{d.name}</span>
                      </button>
                      <Link
                        href={href}
                        className="mt-1 hidden text-xs text-primary underline lg:block"
                      >
                        Open {d.type === "gateway" ? "gateway" : "telemetry"}
                      </Link>
                      <p
                        className="mt-1 truncate text-xs text-muted-foreground"
                        title={d.deviceId}
                      >
                        {d.type.replaceAll("_", " ")} · {d.deviceId}
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="lg:hidden"
                    >
                      <Link href={href}>Open</Link>
                    </Button>
                  </div>
                  <div>
                    <StatusBadge status={d.observedStatus} />
                  </div>
                  <div>{renderValues(d.id)}</div>
                  <div className="space-y-1 text-xs lg:col-span-3">
                    <p>
                      <SampleTime
                        value={r?.timestamp}
                        historical={!r || !currentSample(r)}
                      />
                    </p>
                    <p className="capitalize text-muted-foreground">
                      {String(r?.integration?.mode ?? "unknown")} · Quality:{" "}
                      {String(r?.integration?.sourceQuality ?? "unknown")}
                    </p>
                    {!!r?.integration?.evidence && (
                      <p className="text-muted-foreground">
                        {String(
                          (r.integration.evidence as { reason?: string })
                            .reason ?? "eligible acquisition",
                        ).replaceAll("_", " ")}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="order-first min-w-0 space-y-3 xl:order-none">
            {selected && selected.type !== "gateway" ? (
              <>
                <div className="rounded-lg border bg-card p-4">
                  <h2 className="font-semibold">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected.location ?? selected.deviceId}
                  </p>
                  <div className="mt-3">
                    <StatusBadge status={selected.observedStatus} />
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">
                        Sample acquisition
                      </dt>
                      <dd>
                        <SampleTime
                          value={selectedReading?.timestamp}
                          historical
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Received by application
                      </dt>
                      <dd>
                        <SampleTime
                          value={selectedReading?.createdAt?.toISOString()}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source quality</dt>
                      <dd>
                        {String(
                          selectedReading?.integration?.sourceQuality ??
                            "Unknown",
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                <EvidencePath
                  label="Recorded source path"
                  nodes={[
                    ...(typeof selected.metadata?.gatewayId === "string"
                      ? [
                          {
                            label: selected.metadata.gatewayId,
                            type: "gateway",
                            detail: "Configured parent",
                          },
                        ]
                      : []),
                    {
                      label: selected.name,
                      type: selected.type,
                      detail:
                        selected.metadata?.connectionMode === "direct_mqtt"
                          ? "Direct MQTT configuration"
                          : "Registered source",
                      href: observationHref(
                        {
                          ref: `device:${selected.id}`,
                          kind: "device",
                          itemType: selected.type,
                        },
                        context,
                      ),
                    },
                  ]}
                />
                <ObservationTrend
                  deviceId={selected.id}
                  title={`${selected.name} trend`}
                  scope={scope}
                />
                <Button className="w-full" asChild>
                  <Link
                    href={observationHref(
                      {
                        ref: `device:${selected.id}`,
                        kind: "device",
                        itemType: selected.type,
                      },
                      context,
                    )}
                  >
                    Open telemetry
                  </Link>
                </Button>
              </>
            ) : (
              <EmptyState
                title="Select a measurement source"
                description="Gateways provide connectivity evidence in their workspace."
              />
            )}
          </aside>
        </div>
      )}
      {!!sources.data && sources.data.total > 25 && (
        <nav
          aria-label="Monitoring pages"
          className="flex items-center justify-between"
        >
          <Button
            variant="outline"
            disabled={!page}
            onClick={() => update("page", String(page - 1))}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {page + 1} of {Math.ceil(sources.data.total / 25)}
          </span>
          <Button
            variant="outline"
            disabled={!sources.data.hasMore}
            onClick={() => update("page", String(page + 1))}
          >
            Next
          </Button>
        </nav>
      )}
      <p className="text-xs text-muted-foreground">
        Current connectivity and historical measurements are separate
        observations. Unknown units are shown as unverified and excluded from
        engineering aggregates.
      </p>
    </div>
  );
}
