import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAuth } from "@/contexts/AuthContext";
import {
  SectionNav,
  SampleTime,
  PageHeader,
} from "@/components/workspace/Primitives";
import SecurityAdministration from "@/components/security/SecurityAdministration";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { safeLocalStorage } from "@/lib/storage";
import { resolveApiBase } from "@/lib/api-base";
const tabs = [
  "Overview",
  "Asset posture",
  "Events",
  "Findings",
  "Incidents",
  "Sources and policies",
] as const;
type Filter = {
  page: number;
  search: string;
  mode?: "live" | "simulated" | "replay" | "unknown";
  sourceId?: string;
  severity?: "critical" | "high" | "medium" | "low";
  status?:
    | "open"
    | "acknowledged"
    | "investigating"
    | "resolved"
    | "accepted_risk"
    | "dismissed";
  since?: string;
  targetKind?: "asset" | "device" | "application";
  targetId?: number;
};
const selectClass = "rounded border bg-background p-2 text-sm max-w-full";
const time = (s: unknown) =>
  s ? new Date(String(s)).toLocaleString() : "Not observed";
const json = (s: unknown) => JSON.stringify(s, null, 2);
const investigationLabels: Record<string, string> = {
  finding_opened: "Finding opened",
  condition_repeated: "Condition observed again",
  investigation_acknowledge: "Finding acknowledged",
  investigation_assign: "Review assigned",
  investigation_investigate: "Investigation started",
  investigation_note: "Review note added",
  investigation_resolve: "Investigation resolved",
  investigation_dismiss: "Finding dismissed",
  investigation_accept_risk: "Time-limited risk accepted",
  risk_acceptance_expired: "Risk acceptance expired",
};
const sourceLabel = (name: string) =>
  name === "node-app"
    ? "Application audit"
    : name === "dotnet-services"
      ? "Service audit"
      : name;

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Cybersecurity() {
  const access = trpc.security.availability.useQuery();
  if (access.isLoading)
    return <p role="status">Loading cybersecurity permissions…</p>;
  if (access.error)
    return (
      <p role="alert">
        Cybersecurity access is unavailable. {access.error.message}
      </p>
    );
  if (!access.data?.enabled)
    return (
      <div>
        <h1 className="text-2xl font-bold">Cybersecurity</h1>
        <p>
          Cybersecurity collection is disabled. Equipment and telemetry remain
          available.
        </p>
      </div>
    );
  return <Workspace access={access.data} />;
}
function Workspace({
  access,
}: {
  access: {
    demoOnly: boolean;
    role: string;
    canReview: boolean;
    canEngineer: boolean;
    canAdmin: boolean;
  };
}) {
  const { user } = useAuth();
  const documentActive = useDocumentActive();
  const preferenceKey = `security-filters:${user?.id}`;
  const [hashLocation, navigate] = useHashLocation();
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [tab, setTab] = useState<string>(
    params.has("finding") ? "Findings" : (params.get("tab") ?? "Overview"),
  );
  const [selected, setSelected] = useState<string | null>(
    params.get("finding"),
  );
  useEffect(() => {
    const next = new URLSearchParams(hashLocation.split("?")[1] ?? "");
    const selectedId = next.get("finding");
    setSelected(selectedId);
    if (selectedId) setTab("Findings");
    else if (tabs.includes(next.get("tab") as (typeof tabs)[number]))
      setTab(next.get("tab")!);
  }, [hashLocation]);
  const [filter, setFilter] = useState<Filter>(() => {
    try {
      const p = {
        ...JSON.parse(safeLocalStorage.getItem(preferenceKey) ?? "{}"),
        ...Object.fromEntries(params.entries()),
      };
      return {
        search: String(p.search ?? "").slice(0, 100),
        sourceId: /^[a-f0-9-]{36}$/.test(p.sourceId ?? "")
          ? p.sourceId
          : undefined,
        severity: ["critical", "high", "medium", "low"].includes(p.severity)
          ? p.severity
          : undefined,
        status: [
          "open",
          "acknowledged",
          "investigating",
          "resolved",
          "accepted_risk",
          "dismissed",
        ].includes(p.status)
          ? p.status
          : undefined,
        since:
          /^\d{4}-\d{2}-\d{2}T/.test(p.since ?? "") &&
          Number.isFinite(Date.parse(p.since))
            ? p.since
            : undefined,
        mode: ["live", "simulated", "replay", "unknown"].includes(p.mode)
          ? (p.mode as "live")
          : undefined,
        page: 0,
        targetKind: (params.get("targetKind") || undefined) as
          | "asset"
          | "device"
          | undefined,
        targetId: params.has("targetId")
          ? Number(params.get("targetId"))
          : undefined,
      };
    } catch {
      return {
        search: "",
        mode: undefined as "live" | undefined,
        page: 0,
        targetKind: undefined as "asset" | "device" | undefined,
        targetId: undefined as number | undefined,
      };
    }
  });
  const previousHash = useRef(hashLocation);
  useEffect(() => {
    if (previousHash.current === hashLocation) return;
    previousHash.current = hashLocation;
    const p = new URLSearchParams(hashLocation.split("?")[1] ?? "");
    setFilter({
      search: (p.get("search") ?? "").slice(0, 100),
      page: Math.min(200, Math.max(0, Number(p.get("page")) || 0)),
      mode: ["live", "simulated", "replay", "unknown"].includes(
        p.get("mode") ?? "",
      )
        ? (p.get("mode") as Filter["mode"])
        : undefined,
      sourceId: /^[a-f0-9-]{36}$/.test(p.get("sourceId") ?? "")
        ? p.get("sourceId")!
        : undefined,
      severity: ["critical", "high", "medium", "low"].includes(
        p.get("severity") ?? "",
      )
        ? (p.get("severity") as Filter["severity"])
        : undefined,
      status: [
        "open",
        "acknowledged",
        "investigating",
        "resolved",
        "accepted_risk",
        "dismissed",
      ].includes(p.get("status") ?? "")
        ? (p.get("status") as Filter["status"])
        : undefined,
      since:
        p.get("since") && Number.isFinite(Date.parse(p.get("since")!))
          ? p.get("since")!
          : undefined,
      targetKind: ["asset", "device", "application"].includes(
        p.get("targetKind") ?? "",
      )
        ? (p.get("targetKind") as Filter["targetKind"])
        : undefined,
      targetId:
        Number(p.get("targetId")) > 0 ? Number(p.get("targetId")) : undefined,
    });
  }, [hashLocation]);
  const [notice, setNotice] = useState(""),
    [failure, setFailure] = useState("");
  const debouncedSearch = useDebouncedValue(filter.search),
    queryFilter = { ...filter, search: debouncedSearch };
  const overview = trpc.security.overview.useQuery(queryFilter, {
    refetchInterval: documentActive ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  const posture = trpc.security.posture.useQuery(queryFilter, {
    enabled: ["Asset posture", "Sources and policies"].includes(tab),
  });
  const events = trpc.security.events.useQuery(queryFilter, {
    enabled: tab === "Events",
  });
  const findings = trpc.security.findings.useQuery(
    { ...queryFilter, incidents: tab === "Incidents" },
    { enabled: tab === "Findings" || tab === "Incidents" },
  );
  const sources = trpc.security.sources.useQuery(undefined, {
    refetchInterval: documentActive ? 30000 : false,
    refetchIntervalInBackground: false,
    enabled: true,
  });
  const finding = trpc.security.finding.useQuery(
    { id: selected ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!selected },
  );
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.security.invalidate();
  };
  const select = (id: string) => {
    setSelected(id);
    const p = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    p.set("finding", id);
    p.set("tab", "Findings");
    navigate(`/cybersecurity?${p}`);
  };
  const changeTab = (value: string) => {
    setTab(value);
    setSelected(null);
    setFailure("");
    const p = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    p.set("tab", value);
    p.delete("finding");
    navigate(`/cybersecurity?${p}`);
  };
  const setFilters = (next: Partial<typeof filter>) => {
    setSelected(null);
    const value = { ...filter, ...next, page: 0 };
    setFilter(value);
    safeLocalStorage.setItem(preferenceKey, JSON.stringify(value));
    const p = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    p.delete("finding");
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    navigate(`/cybersecurity?${p}`, { replace: true });
  };

  const demonstration = trpc.security.seedDemo.useMutation({
    onSuccess: () => {
      setNotice("Authored simulation and replay evidence is ready.");
      refresh();
    },
    onError: (e) => setFailure(e.message),
  });
  const repeatDemo = trpc.security.simulateRecurrence.useMutation({
    onSuccess: () => {
      setNotice(
        "Simulated evidence repeated; live incident state is unchanged.",
      );
      refresh();
    },
    onError: (e) => setFailure(e.message),
  });
  const action = trpc.security.action.useMutation({
    onSuccess: () => {
      setNotice("Investigation decision saved.");
      setFailure("");
      refresh();
    },
    onError: (e) => setFailure(e.message),
  });
  const [reason, setReason] = useState(""),
    [decision, setDecision] = useState<
      | "acknowledge"
      | "assign"
      | "investigate"
      | "note"
      | "resolve"
      | "accept_risk"
      | "dismiss"
    >("acknowledge"),
    [assignee, setAssignee] = useState(""),
    [riskUntil, setRiskUntil] = useState("");
  const assignees = trpc.security.assignees.useQuery(undefined, {
    enabled: access.canEngineer && !!selected,
  });
  const [exportFormat, setExportFormat] = useState<"json" | "ndjson" | "csv">(
    "ndjson",
  );
  const exporter = trpc.security.export.useQuery(
    { ...filter, format: exportFormat },
    { enabled: false },
  );
  const goTarget = (target: any) =>
    ["asset", "device"].includes(target?.kind)
      ? `#/inventory/${target.kind}:${target.id}/overview?return=${encodeURIComponent(hashLocation)}`
      : "#/cybersecurity";
  const activeError =
    overview.error ??
    posture.error ??
    events.error ??
    findings.error ??
    sources.error ??
    finding.error;
  return (
    <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
      <PageHeader
        title="Cybersecurity"
        description="Review source coverage, evidence and security investigations."
        action={
          <Button variant="outline" onClick={refresh}>
            Refresh evidence
          </Button>
        }
      />
      {access.canEngineer && (
        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm">
            Demonstration / setup
          </summary>
          <Button
            variant="outline"
            disabled={demonstration.isPending}
            onClick={() => demonstration.mutate()}
          >
            Load local security demonstration
          </Button>
        </details>
      )}
      {access.demoOnly && (
        <p className="rounded border p-3 text-sm">
          Read-only demonstration. Simulated/replay evidence is separate from
          live security investigations.
        </p>
      )}
      <SectionNav
        label="Cybersecurity sections"
        sections={tabs.map((t) => ({ id: t, label: t }))}
        value={tab}
        onChange={changeTab}
      >
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          <label className="text-sm font-medium">
            Evidence mode scope
            <select
              aria-label="Filter evidence mode"
              className={`ml-2 ${selectClass}`}
              value={filter.mode ?? ""}
              onChange={(e) =>
                setFilters({
                  mode: (e.target.value || undefined) as Filter["mode"],
                })
              }
            >
              <option value="">Combined · all evidence modes</option>
              {["live", "simulated", "replay", "unknown"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">
            {filter.mode
              ? `${filter.mode} scope`
              : "Combined scope · provenance retained on every record"}
          </span>
        </div>
        {(notice || failure) && (
          <p
            role={failure ? "alert" : "status"}
            className="rounded border p-3 text-sm"
          >
            {failure || notice}
          </p>
        )}
        {activeError && (
          <p role="alert" className="rounded border p-3 text-sm">
            Security evidence could not be loaded. {activeError.message}{" "}
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          </p>
        )}
        {tab === "Overview" && (
          <p className="text-sm">
            Open findings by evidence mode:{" "}
            {overview.data?.modeCounts
              .map((m: any) => `${m.mode}: ${m.count}`)
              .join(" · ") || "No assessed findings"}
            . {filter.mode ? "Scoped assessment" : "Combined scope"}. Missing
            coverage remains unknown.
          </p>
        )}
        {tab === "Overview" &&
          (overview.isLoading ? (
            <p role="status">Loading observed coverage…</p>
          ) : (
            overview.data && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {["critical", "high", "medium", "low"].map((severity) => (
                    <Card key={severity}>
                      <button
                        className="w-full rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Open ${severity} findings`}
                        onClick={() => {
                          setFilters({
                            severity: severity as Filter["severity"],
                            status: undefined,
                          });
                          changeTab("Findings");
                        }}
                      >
                        <CardHeader>
                          <CardTitle className="text-sm capitalize">
                            Open {severity} findings
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <strong className="text-3xl">
                            {overview.data.counts.find(
                              (c) => c.severity === severity,
                            )?.count ?? 0}
                          </strong>
                        </CardContent>
                      </button>
                    </Card>
                  ))}
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Source coverage · live receipts</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p>
                      {overview.data.coverage.receiving} receiving ·{" "}
                      {overview.data.coverage.stale} stale or missing ·{" "}
                      {overview.data.coverage.configured} configured sources ·{" "}
                      {overview.data.affected} affected identities
                    </p>
                    <div className="text-sm text-muted-foreground">
                      Receiving evidence does not prove secure controls. Zero
                      findings leaves uncovered controls unknown.
                      <details className="mt-2">
                        <summary className="cursor-pointer">
                          How coverage is calculated
                        </summary>
                        {overview.data.explanation}
                      </details>
                    </div>
                    {!overview.data.sources.length && (
                      <p>
                        No security sources are configured. Create a scoped
                        source or import reviewed evidence; asset controls
                        remain unknown.
                      </p>
                    )}
                    {overview.data.sources.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap justify-between gap-2 rounded border p-3 text-sm"
                      >
                        <span>{sourceLabel(s.name)}</span>
                        <Badge variant="outline">{s.state}</Badge>
                        <span>
                          Last live receipt: {time(s.last_received_at)}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Recent security evidence</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {overview.data.activity.length ? (
                      overview.data.activity.map((e) => (
                        <article
                          key={e.id}
                          className="grid gap-1 border-b py-3 text-sm last:border-0 sm:grid-cols-2"
                        >
                          <strong className="font-medium capitalize">
                            {e.event_type.replaceAll(/[._]/g, " ")}
                          </strong>
                          <span className="text-muted-foreground">
                            Source:{" "}
                            {String(e.source_name ?? "Registered source")}
                          </span>
                          <span>
                            {e.target &&
                            ["asset", "device"].includes(e.target.kind) ? (
                              <a
                                className="text-primary underline"
                                href={goTarget(e.target)}
                              >
                                {String(e.target_name)}
                              </a>
                            ) : (
                              String(e.target_name ?? "Application / service")
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            <SampleTime value={String(e.occurred_at)} /> ·{" "}
                            {e.mode} · {e.quality} quality
                          </span>
                        </article>
                      ))
                    ) : (
                      <p>
                        No observed events. Absence of evidence is not a secure
                        assessment.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )
          ))}
        {tab === "Asset posture" && (
          <Card>
            <CardHeader>
              <CardTitle>Registered assets and gateways</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {posture.data?.scopeNote}
              </p>
              {posture.isLoading && (
                <p role="status">Loading registered identities…</p>
              )}
              {posture.data?.items.map((i) => (
                <div
                  key={`${i.kind}-${i.id}`}
                  className="space-y-2 rounded border p-3"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <a className="text-primary underline" href={goTarget(i)}>
                      {i.name}
                    </a>
                    <Badge variant="outline">
                      {i.kind} · criticality {i.criticality}
                    </Badge>
                  </div>
                  <p className="break-all text-xs">
                    {i.external_id} · Zone:{" "}
                    {i.review?.zone ?? i.zone ?? "Not reviewed"}
                  </p>
                  <p className="text-sm">
                    Firmware/software: {i.firmware_version ?? "Unknown"} ·{" "}
                    {i.versionBasis}
                  </p>
                  <p className="text-sm">
                    {i.observations.length} observed fact types ·{" "}
                    {i.findings.length} findings in this page
                  </p>
                  {i.declaredConnections.map((c: any) => (
                    <p key={c.id} className="text-xs">
                      Declared connection {c.id}: {c.protocol} ·{" "}
                      {c.transport_declaration} · authentication{" "}
                      {c.authentication} · {time(c.declared_at)}
                    </p>
                  ))}
                  {i.inventories.map((r: any) => (
                    <details key={r.id} className="text-sm">
                      <summary>
                        Imported package versions · {r.mode} ·{" "}
                        {time(r.producedAt)}
                      </summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                        {json(r)}
                      </pre>
                    </details>
                  ))}
                  {i.observations.map((o: any) => (
                    <details key={o.event_type} className="text-sm">
                      <summary>
                        {o.event_type} · {o.mode} · {o.quality} ·{" "}
                        {Date.now() - Date.parse(o.occurred_at) > 86400000
                          ? "stale"
                          : "observed"}{" "}
                        · {time(o.occurred_at)}
                      </summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                        {json(o.fact)}
                      </pre>
                    </details>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFilters({
                        targetKind: i.kind as "asset" | "device",
                        targetId: i.id,
                      });
                      changeTab("Findings");
                    }}
                  >
                    Scoped findings
                  </Button>
                  {access.canEngineer && (
                    <PostureForm
                      target={{ kind: i.kind, id: i.id }}
                      onDone={() => {
                        refresh();
                        setNotice("Reviewed posture saved.");
                      }}
                      onError={setFailure}
                    />
                  )}
                </div>
              ))}
              {posture.data && !posture.data.items.length && (
                <p>No registered assets or gateways are available.</p>
              )}
            </CardContent>
          </Card>
        )}
        {["Events", "Findings", "Incidents"].includes(tab) && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Search evidence
                <Input
                  aria-label="Search security evidence"
                  value={filter.search}
                  onChange={(e) => setFilters({ search: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Source
                <select
                  aria-label="Filter security source"
                  className={`block ${selectClass}`}
                  value={filter.sourceId ?? ""}
                  onChange={(e) =>
                    setFilters({ sourceId: e.target.value || undefined })
                  }
                >
                  <option value="">All sources</option>
                  {sources.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Received / last seen since
                <Input
                  aria-label="Security time filter"
                  type="date"
                  value={filter.since?.slice(0, 10) ?? ""}
                  onChange={(e) =>
                    setFilters({
                      since: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : undefined,
                    })
                  }
                />
              </label>
              {tab !== "Events" && (
                <>
                  <label className="text-sm">
                    Severity
                    <select
                      aria-label="Filter finding severity"
                      className={`block ${selectClass}`}
                      value={filter.severity ?? ""}
                      onChange={(e) =>
                        setFilters({
                          severity: (e.target.value ||
                            undefined) as Filter["severity"],
                        })
                      }
                    >
                      <option value="">All severities</option>
                      {["critical", "high", "medium", "low"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Workflow
                    <select
                      aria-label="Filter investigation status"
                      className={`block ${selectClass}`}
                      value={filter.status ?? ""}
                      onChange={(e) =>
                        setFilters({
                          status: (e.target.value ||
                            undefined) as Filter["status"],
                        })
                      }
                    >
                      <option value="">All states</option>
                      {[
                        "open",
                        "acknowledged",
                        "investigating",
                        "resolved",
                        "accepted_risk",
                        "dismissed",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {filter.targetKind && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setFilters({ targetKind: undefined, targetId: undefined })
                  }
                >
                  Clear asset scope
                </Button>
              )}
            </div>
            <div
              className={
                selected
                  ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,1fr)]"
                  : "space-y-4"
              }
            >
              <div
                className={selected ? "hidden space-y-4 xl:block" : "space-y-4"}
              >
                {tab === "Events" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Security events</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {events.isLoading && (
                        <p role="status">Loading source evidence…</p>
                      )}
                      {events.data?.items.map((e) => (
                        <details
                          key={e.id}
                          className="rounded border p-3 text-sm"
                        >
                          <summary className="cursor-pointer">
                            {e.event_type.replaceAll(/[._]/g, " ")} · {e.mode} ·{" "}
                            {e.quality} · {time(e.occurred_at)}
                          </summary>
                          <p className="my-2">
                            Source: {e.source_name} · received{" "}
                            {time(e.ingested_at)} ·{" "}
                            {e.late ? "out of order" : "ordered"} ·{" "}
                            {e.clock_skew
                              ? "future clock skew"
                              : "no future skew"}
                          </p>
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {json(e.envelope)}
                          </pre>
                          {e.target && (
                            <a
                              href={goTarget(e.target)}
                              className="text-primary underline"
                            >
                              Open registered identity
                            </a>
                          )}
                        </details>
                      ))}
                      {events.data && !events.data.items.length && (
                        <p>
                          No evidence matches these filters. Unobserved controls
                          remain unknown.
                        </p>
                      )}
                      {access.role !== "viewer" && (
                        <div className="flex flex-wrap gap-2">
                          <select
                            aria-label="Security export format"
                            className={selectClass}
                            value={exportFormat}
                            onChange={(e) =>
                              setExportFormat(
                                e.target.value as typeof exportFormat,
                              )
                            }
                          >
                            {["ndjson", "json", "csv"].map((f) => (
                              <option key={f}>{f}</option>
                            ))}
                          </select>
                          <Button
                            variant="outline"
                            onClick={async () => {
                              const r = await exporter.refetch();
                              if (r.data) {
                                download(
                                  `security-evidence.${exportFormat}`,
                                  r.data.body,
                                  exportFormat === "csv"
                                    ? "text/csv"
                                    : "application/x-ndjson",
                                );
                                setNotice(
                                  `Exported this scoped page; ${r.data.omitted} unreviewed/unknown records omitted. ${r.data.reason}`,
                                );
                              } else
                                setFailure(r.error?.message ?? "Export failed");
                            }}
                          >
                            Export scoped page
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                {(tab === "Findings" || tab === "Incidents") && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {tab === "Incidents"
                          ? "Assigned security investigations"
                          : "Evidence-backed findings"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {findings.isLoading && (
                        <p role="status">Loading findings…</p>
                      )}
                      {findings.data?.items.map((f) => (
                        <button
                          type="button"
                          key={f.id}
                          aria-pressed={selected === f.id}
                          onClick={() => select(f.id)}
                          className={`block w-full rounded-md border p-4 text-left hover:bg-accent focus-visible:outline-2 ${selected === f.id ? "border-primary bg-primary/8" : ""}`}
                        >
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong>{f.title}</strong>
                            <Badge variant="outline">
                              {f.severity} · priority {f.priority}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm">
                            {f.mode} · {f.category} · {f.status} ·{" "}
                            {f.confidence} ·{" "}
                            {f.condition_active
                              ? "condition observed"
                              : "condition no longer current"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {sources.data?.items.find(
                              (source: any) => source.id === f.source_id,
                            )?.name ?? "Source details in investigation"}{" "}
                            · {f.assignee ?? "Unassigned"} · last{" "}
                            {time(f.last_seen)}
                          </p>
                        </button>
                      ))}
                      {findings.data && !findings.data.items.length && (
                        <p>
                          No{" "}
                          {tab === "Incidents" ? "investigations" : "findings"}{" "}
                          match these filters. This is not a claim that assets
                          are secure.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={!filter.page}
                    onClick={() => {
                      const p = new URLSearchParams(
                        window.location.hash.split("?")[1] ?? "",
                      );
                      p.set("page", String(Math.max(0, filter.page - 1)));
                      navigate(`/cybersecurity?${p}`);
                    }}
                  >
                    Previous evidence page
                  </Button>
                  <span className="text-sm">Page {filter.page + 1}</span>
                  <Button
                    variant="outline"
                    disabled={
                      filter.page >= 200 ||
                      !(tab === "Events"
                        ? events.data?.hasMore
                        : findings.data?.hasMore)
                    }
                    onClick={() => {
                      const p = new URLSearchParams(
                        window.location.hash.split("?")[1] ?? "",
                      );
                      p.set("page", String(filter.page + 1));
                      navigate(`/cybersecurity?${p}`);
                    }}
                  >
                    Next evidence page
                  </Button>
                </div>
              </div>
              <div className="min-w-0 space-y-3">
                {" "}
                {selected &&
                  finding.data &&
                  filter.mode &&
                  finding.data.mode !== filter.mode && (
                    <p role="status" className="rounded border p-3 text-sm">
                      This finding is outside the selected evidence mode.{" "}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const p = new URLSearchParams(
                            hashLocation.split("?")[1] ?? "",
                          );
                          p.set("mode", finding.data!.mode);
                          navigate(`/cybersecurity?${p}`);
                        }}
                      >
                        Open matching evidence scope
                      </Button>
                    </p>
                  )}
                {selected &&
                  finding.data &&
                  (!filter.mode || finding.data.mode === filter.mode) && (
                    <Card className="min-w-0 self-start xl:sticky xl:top-20">
                      <CardHeader>
                        <Button
                          className="mb-2 xl:hidden"
                          variant="outline"
                          onClick={() => changeTab(tab)}
                        >
                          Return to findings
                        </Button>
                        <CardTitle>{finding.data.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p>
                          <Badge variant="outline">
                            {finding.data.severity}
                          </Badge>{" "}
                          · {finding.data.mode} · {finding.data.status} ·{" "}
                          {finding.data.category} · confidence{" "}
                          {finding.data.confidence}
                        </p>
                        <p className="text-sm">
                          Rule {finding.data.rule_id} v
                          {finding.data.rule_version} · First{" "}
                          {time(finding.data.first_seen)} · Last{" "}
                          {time(finding.data.last_seen)} ·{" "}
                          {finding.data.occurrences} qualifying evaluations ·{" "}
                          {finding.data.recurrences} recurrences
                        </p>
                        <p className="text-sm">
                          Resolving an investigation records a decision; it does
                          not erase evidence or clear an active observed
                          condition.
                        </p>
                        <details className="rounded border p-3">
                          <summary className="cursor-pointer text-sm font-medium">
                            Assessment calculation and rule context
                          </summary>
                          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                            {json(finding.data.explanation)}
                          </pre>
                        </details>
                        {finding.data.target && (
                          <a
                            className="text-primary underline"
                            href={goTarget(finding.data.target)}
                          >
                            Follow affected registered identity
                          </a>
                        )}
                        {finding.data.installed_component_id && (
                          <a
                            className="ml-3 text-primary underline"
                            href={`#/equipment?securityFinding=${selected}`}
                          >
                            Focus mapped equipment component
                          </a>
                        )}
                        <section className="rounded-md border border-info/30 bg-info/5 p-3">
                          <h3 className="text-sm font-semibold">
                            Suggested review steps
                          </h3>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                            {(
                              (finding.data.explanation as any)?.checks ?? []
                            ).map((check: string) => (
                              <li key={check}>{check}</li>
                            ))}
                          </ul>
                        </section>
                        <h3 className="font-semibold">
                          Original normalized evidence
                        </h3>
                        {!finding.data.evidence.length && (
                          <p>Detailed evidence is unavailable to this role.</p>
                        )}
                        {finding.data.evidence.map((e) => (
                          <details
                            key={e.event_id}
                            className="rounded border p-3"
                          >
                            <summary className="cursor-pointer break-all text-sm">
                              {String(
                                (e.snapshot as any)?.type ??
                                  (e.snapshot as any)?.eventType ??
                                  "Source observation",
                              ).replaceAll(/[._]/g, " ")}{" "}
                              ·{" "}
                              {String(
                                (e.snapshot as any)?.mode ?? finding.data.mode,
                              )}
                            </summary>
                            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
                              {json(e.snapshot)}
                            </pre>
                          </details>
                        ))}
                        {access.canReview && (
                          <p className="text-sm">
                            {finding.data.evidence.length} immutable snapshots
                            displayed; at most {finding.data.evidenceLimit} are
                            retained per finding. The occurrence counter counts
                            qualifying evaluations. Raw event retention is
                            separate.
                          </p>
                        )}
                        {access.canReview && (
                          <div className="space-y-3 rounded border p-3">
                            <h3 className="font-semibold">
                              Investigation decision
                            </h3>
                            <label className="block text-sm">
                              Decision
                              <select
                                aria-label="Investigation decision"
                                className={`ml-2 ${selectClass}`}
                                value={decision}
                                onChange={(e) =>
                                  setDecision(e.target.value as typeof decision)
                                }
                              >
                                <option value="acknowledge">Acknowledge</option>
                                {access.canEngineer && (
                                  <>
                                    <option value="assign">Assign</option>
                                    <option value="investigate">
                                      Investigate
                                    </option>
                                    <option value="note">Add note</option>
                                    <option value="resolve">
                                      Resolve with evidence
                                    </option>
                                    <option value="dismiss">
                                      Dismiss / false positive
                                    </option>
                                  </>
                                )}
                                {access.canAdmin && (
                                  <option value="accept_risk">
                                    Accept time-limited risk
                                  </option>
                                )}
                              </select>
                            </label>
                            {decision === "assign" && (
                              <label className="block text-sm">
                                Assign engineer
                                <select
                                  aria-label="Assign security engineer"
                                  className={`ml-2 ${selectClass}`}
                                  value={assignee}
                                  onChange={(e) => setAssignee(e.target.value)}
                                >
                                  <option value="">Assign to me</option>
                                  {assignees.data?.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.name ?? u.id}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {decision === "accept_risk" && (
                              <label className="block text-sm">
                                Risk expiry UTC
                                <Input
                                  aria-label="Risk acceptance expiry"
                                  placeholder="2026-11-01T12:00:00Z"
                                  value={riskUntil}
                                  onChange={(e) => setRiskUntil(e.target.value)}
                                />
                              </label>
                            )}
                            <label className="block text-sm">
                              Evidence and decision reason
                              <Textarea
                                aria-label="Investigation reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                maxLength={2000}
                              />
                            </label>
                            <Button
                              disabled={
                                reason.trim().length < 5 || action.isPending
                              }
                              onClick={() =>
                                action.mutate({
                                  id: selected,
                                  expectedVersion: finding.data.version,
                                  action: decision,
                                  reason,
                                  assignee: assignee
                                    ? Number(assignee)
                                    : undefined,
                                  riskUntil:
                                    decision === "accept_risk"
                                      ? riskUntil
                                      : undefined,
                                  evidenceIds:
                                    decision === "resolve"
                                      ? finding.data.evidence
                                          .slice(0, 20)
                                          .map((e) => e.event_id)
                                      : [],
                                })
                              }
                            >
                              Save investigation decision
                            </Button>
                          </div>
                        )}
                        <h3 className="font-semibold">
                          Investigation timeline
                        </h3>
                        {finding.data.timeline.map((t) => (
                          <div
                            key={t.id}
                            className="rounded border p-2 text-sm"
                          >
                            <p className="font-medium capitalize">
                              {investigationLabels[t.action] ??
                                t.action.replaceAll("_", " ")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {time(t.created_at)}
                            </p>
                            {typeof (t.detail as Record<string, unknown>)
                              ?.reason === "string" && (
                              <p className="mt-2 whitespace-pre-wrap">
                                {String(
                                  (t.detail as Record<string, unknown>).reason,
                                )}
                              </p>
                            )}
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground">
                                Exact decision details
                              </summary>
                              <p className="mt-2 break-all font-mono text-xs">
                                {t.action}
                              </p>
                              <pre className="whitespace-pre-wrap break-all text-xs">
                                {json(t.detail)}
                              </pre>
                            </details>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
              </div>
            </div>
          </>
        )}
        {tab === "Sources and policies" && (
          <SourcePolicies
            sources={sources.data}
            access={access}
            posture={posture.data}
            onDone={(s) => {
              setNotice(s);
              refresh();
            }}
            onError={setFailure}
          />
        )}
      </SectionNav>
    </div>
  );
}
function PostureForm({
  target,
  onDone,
  onError,
}: {
  target: any;
  onDone: () => void;
  onError: (s: string) => void;
}) {
  const [zone, setZone] = useState(""),
    [criticality, setCriticality] = useState<
      "unknown" | "low" | "medium" | "high"
    >("unknown"),
    [reason, setReason] = useState("");
  const review = trpc.security.reviewPosture.useMutation({
    onSuccess: onDone,
    onError: (e) => onError(e.message),
  });
  return (
    <details>
      <summary className="cursor-pointer text-sm">
        Review zone and criticality
      </summary>
      <div className="mt-2 space-y-2">
        <Input
          aria-label={`Reviewed zone ${target.kind}-${target.id}`}
          placeholder="Reviewed zone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        />
        <select
          aria-label={`Criticality ${target.kind}-${target.id}`}
          className={selectClass}
          value={criticality}
          onChange={(e) => setCriticality(e.target.value as typeof criticality)}
        >
          {["unknown", "low", "medium", "high"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <Input
          aria-label={`Posture reason ${target.kind}-${target.id}`}
          placeholder="Review evidence/reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="sm"
          disabled={reason.length < 5}
          onClick={() => review.mutate({ target, zone, criticality, reason })}
        >
          Save reviewed posture
        </Button>
      </div>
    </details>
  );
}
function SourcePolicies({
  sources,
  access,
  posture,
  onDone,
  onError,
}: {
  sources: any;
  access: any;
  posture: any;
  onDone: (s: string) => void;
  onError: (s: string) => void;
}) {
  const [name, setName] = useState(""),
    [namespace, setNamespace] = useState(""),
    [scope, setScope] = useState("application:"),
    [mode, setMode] = useState<"live" | "simulated" | "replay">("live"),
    [expectedInterval, setExpectedInterval] = useState(300),
    [connections, setConnections] = useState(""),
    [inputs, setInputs] = useState("[]"),
    [token, setToken] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [report, setReport] = useState(""),
    [reportMode, setReportMode] = useState("unknown"),
    [reportRun, setReportRun] = useState(""),
    [reportProducer, setReportProducer] = useState("unknown"),
    [baselineSourceId, setBaselineSourceId] = useState(""),
    [baseline, setBaseline] = useState(""),
    [baselineRevision, setBaselineRevision] = useState(""),
    [keys, setKeys] = useState("users.roles,mqtt.transport"),
    [reason, setReason] = useState("");
  const [ruleId, setRuleId] = useState("authentication-burst"),
    [threshold, setThreshold] = useState(5),
    [windowSeconds, setWindowSeconds] = useState(300),
    [ruleEnabled, setRuleEnabled] = useState(true);
  const create = trpc.security.createSource.useMutation({
    onSuccess: (r) => {
      setToken(r.token);
      setSourceId(r.id);
      onDone("Scoped source created. Save its one-time credential securely.");
    },
    onError: (e) => onError(e.message),
  });
  const credential = trpc.security.credential.useMutation({
    onSuccess: (r) => {
      setToken(r.token ?? "");
      onDone("Source credential updated.");
    },
    onError: (e) => onError(e.message),
  });
  const propose = trpc.security.proposeBaseline.useMutation({
    onSuccess: () =>
      onDone("Baseline proposal saved for administrator review."),
    onError: (e) => onError(e.message),
  });
  const approve = trpc.security.approveBaseline.useMutation({
    onSuccess: () => onDone("Baseline approved."),
    onError: (e) => onError(e.message),
  });
  const activate = trpc.security.activateRule.useMutation({
    onSuccess: (r) =>
      onDone(
        `Rule version ${r.version} activated; previous findings retain their original rule version.`,
      ),
    onError: (e) => onError(e.message),
  });
  const purge = trpc.security.purgeExpired.useMutation({
    onSuccess: (r) =>
      onDone(
        `${r.deleted} expired event records deleted; finding snapshots retained.`,
      ),
    onError: (e) => onError(e.message),
  });
  const target = () => {
    const [kind, id] = scope.split(":");
    return {
      kind: kind as "application" | "asset" | "device",
      id: id ? Number(id) : null,
    };
  };
  return (
    <div className="min-w-0 space-y-4">
      <SecurityAdministration
        sources={sources}
        posture={posture}
        canAdmin={access.canAdmin}
        canEngineer={access.canEngineer}
        onDone={onDone}
        onError={onError}
      />
      <Card>
        <CardHeader>
          <CardTitle>Sources and collector health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources?.items.map((s: any) => (
            <div key={s.id} className="space-y-2 rounded border p-3">
              <strong>{sourceLabel(s.name)}</strong>
              <p className="break-all text-xs">
                {s.namespace} · {s.active ? "enabled" : "paused"} · last live
                receipt {time(s.last_received_at)}
              </p>
              <p className="text-sm">
                Modes: {s.policy.modes.join(", ")} · expected interval{" "}
                {s.policy.expectedIntervalSeconds || "not configured"}s
              </p>
              {access.canAdmin && !s.system_key && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      credential.mutate({ id: s.id, action: "rotate" })
                    }
                  >
                    Rotate {s.name} credential
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      credential.mutate({ id: s.id, action: "revoke" })
                    }
                  >
                    Revoke {s.name} credential
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!sources?.items.length && <p>No configured security collectors.</p>}
          {access.canAdmin && token && (
            <div role="status" className="space-y-2 rounded border p-3">
              <strong>One-time ingestion credential</strong>
              <p>
                Keep this in the collector's protected configuration. It grants
                ingestion for this source only.
              </p>
              <code className="block break-all select-all text-xs">
                {token}
              </code>
              <Button variant="outline" onClick={() => setToken("")}>
                Hide credential
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {access.canAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Configure a read-only source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block text-sm">
              Source name
              <Input
                aria-label="Security source name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Producer namespace
              <Input
                aria-label="Security producer namespace"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Authorized identity
              <select
                aria-label="Security source scope"
                className={`ml-2 ${selectClass}`}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="application:">This application</option>
                {posture?.items.map((i: any) => (
                  <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>
                    {i.kind}: {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Evidence mode
              <select
                aria-label="New source mode"
                className={`ml-2 ${selectClass}`}
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                {["live", "simulated", "replay"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Expected collection interval seconds (0 for event-driven)
              <Input
                aria-label="Security source interval"
                type="number"
                min={0}
                max={86400}
                value={expectedInterval}
                onChange={(e) => setExpectedInterval(+e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Configured connection references
              <Input
                aria-label="Configured security connections"
                placeholder="mqtt-cloud, supplied-certificate"
                value={connections}
                onChange={(e) => setConnections(e.target.value)}
              />
            </label>
            <details>
              <summary className="cursor-pointer text-sm">
                Reviewed input allowlists
              </summary>
              <Textarea
                aria-label="Reviewed security inputs"
                value={inputs}
                onChange={(e) => setInputs(e.target.value)}
              />
              <p className="text-xs">
                Array of inputRef and allowedIdentities; identifiers do not
                establish physical device identity.
              </p>
            </details>
            <Button
              disabled={!name || !namespace || create.isPending}
              onClick={() => {
                try {
                  create.mutate({
                    name,
                    namespace,
                    targets: [target()],
                    modes: [mode],
                    types: [
                      "auth.authentication_failed",
                      "auth.authorization_denied",
                      "tls.certificate_observed",
                      "config.changed",
                      "config.drift_observed",
                      "identity.unrecognized",
                      "collector.health",
                      "software.inventory_observed",
                      "integrity.change_observed",
                      "transport.connection_observed",
                      "input.rejected",
                    ],
                    expectedIntervalSeconds: expectedInterval,
                    connections: connections
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    inputs: JSON.parse(inputs),
                  });
                } catch {
                  onError("Provide a valid reviewed allowlist.");
                }
              }}
            >
              Create security source
            </Button>
          </CardContent>
        </Card>
      )}
      {access.canEngineer && (
        <Card>
          <CardHeader>
            <CardTitle>Reviewed imports and baselines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block text-sm">
              Source
              <select
                aria-label="Security import source"
                className={`ml-2 ${selectClass}`}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">Choose configured source</option>
                {sources?.items
                  .filter((s: any) => !s.system_key)
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              Report scope
              <select
                aria-label="Security report scope"
                className={`ml-2 ${selectClass}`}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="application:">This application</option>
                {posture?.items.map((i: any) => (
                  <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>
                    {i.kind}: {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Trivy schema-2 JSON subset
              <Textarea
                aria-label="Security report JSON"
                value={report}
                onChange={(e) => setReport(e.target.value)}
                rows={7}
              />
            </label>
            <p className="text-xs">
              Maximum 4 MiB / 2,000 vulnerabilities. Scanner package/version
              matches remain candidates for applicability review. App-image
              reports apply only to their reviewed scope.
            </p>
            <label className="block text-sm">
              Report evidence mode
              <select
                aria-label="Report evidence mode"
                className={selectClass}
                value={reportMode}
                onChange={(e) => setReportMode(e.target.value)}
              >
                {["unknown", "live", "simulated", "replay"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <Input
              aria-label="Report scenario or replay run"
              placeholder="Required for simulated/replay reports"
              value={reportRun}
              onChange={(e) => setReportRun(e.target.value)}
            />
            <Input
              aria-label="Report producer version"
              placeholder="Scanner version or unknown"
              value={reportProducer}
              onChange={(e) => setReportProducer(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!sourceId || !report}
              onClick={async () => {
                try {
                  const t = target();
                  const response = await fetch(
                    `${resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD)}/security/reports?sourceId=${encodeURIComponent(sourceId)}&mode=${reportMode}&producerVersion=${encodeURIComponent(reportProducer)}${reportRun ? `&runId=${encodeURIComponent(reportRun)}` : ""}&targetKind=${t.kind}${t.id ? `&targetId=${t.id}` : ""}`,
                    {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: report,
                    },
                  );
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error);
                  onDone(`Report ${data.id} stored with original SHA-256.`);
                } catch (e) {
                  onError(
                    e instanceof Error ? e.message : "Report import failed",
                  );
                }
              }}
            >
              Import reviewed report
            </Button>
            <label className="block text-sm">
              Baseline source
              <select
                aria-label="Security baseline source"
                className={selectClass}
                value={baselineSourceId}
                onChange={(e) => setBaselineSourceId(e.target.value)}
              >
                <option value="">Choose source to review</option>
                {sources?.items
                  .filter((s: any) => !s.is_demo)
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              Baseline version
              <Input
                aria-label="Security baseline version"
                value={baselineRevision}
                onChange={(e) => setBaselineRevision(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Expected configuration revision
              <Input
                aria-label="Expected security config revision"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Security-relevant keys
              <Input
                aria-label="Security baseline keys"
                value={keys}
                onChange={(e) => setKeys(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Review reason
              <Input
                aria-label="Security policy reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={
                !baselineSourceId ||
                !baseline ||
                !baselineRevision ||
                reason.length < 5
              }
              onClick={() =>
                propose.mutate({
                  sourceId: baselineSourceId,
                  revision: baselineRevision,
                  configRevision: baseline,
                  relevantKeys: keys
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  reason,
                })
              }
            >
              Propose security baseline
            </Button>
            {sources?.baselines.map((b: any) => (
              <div key={b.id} className="rounded border p-3 text-sm">
                Baseline {b.revision} ·{" "}
                {b.approved_at ? "approved" : "pending review"}
                {access.canAdmin && !b.approved_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approve.mutate({ id: b.id })}
                  >
                    Approve baseline {b.revision}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Versioned deterministic rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources?.rules
            .filter((r: any) => r.active)
            .map((r: any) => (
              <p key={r.id} className="text-sm">
                {r.id} v{r.version} ·{" "}
                {r.settings.enabled ? "active" : "disabled"} · window{" "}
                {r.settings.windowSeconds}s · threshold {r.settings.threshold}
              </p>
            ))}
          {access.canAdmin && (
            <div className="space-y-2">
              <select
                aria-label="Security rule"
                className={selectClass}
                value={ruleId}
                onChange={(e) => setRuleId(e.target.value)}
              >
                {sources?.rules
                  .filter((r: any) => r.active)
                  .map((r: any) => (
                    <option key={r.id}>{r.id}</option>
                  ))}
              </select>
              <label className="block text-sm">
                Threshold
                <Input
                  aria-label="Security rule threshold"
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(+e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Window seconds
                <Input
                  aria-label="Security rule window"
                  type="number"
                  min={60}
                  max={86400}
                  value={windowSeconds}
                  onChange={(e) => setWindowSeconds(+e.target.value)}
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ruleEnabled}
                  onChange={(e) => setRuleEnabled(e.target.checked)}
                />
                Enable rule version
              </label>
              <Button
                disabled={reason.length < 5}
                onClick={() =>
                  activate.mutate({
                    id: ruleId as any,
                    windowSeconds,
                    threshold,
                    enabled: ruleEnabled,
                    reason,
                  })
                }
              >
                Activate reviewed rule version
              </Button>
              <Button
                variant="outline"
                disabled={reason.length < 5}
                onClick={() => purge.mutate({ reason })}
              >
                Purge expired evidence
              </Button>
              <p className="text-xs">
                30-day raw-event retention; at most 1,000 expired records per
                audited deletion. Finding snapshots and investigation history
                remain available.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
