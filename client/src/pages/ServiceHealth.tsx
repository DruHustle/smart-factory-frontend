import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  Activity,
  Server,
  Database,
  Radio,
  ArrowRight,
  RefreshCw,
  X,
  ShieldCheck,
  CircleHelp,
} from "lucide-react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { trpc } from "@/lib/trpc";
import {
  PageHeader,
  SectionNav,
  EmptyState,
  CopyIdentifier,
} from "@/components/workspace/Primitives";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  ageSnapshot,
  type HealthState,
  type HealthSnapshot,
  type ServiceEvidence,
  type InfrastructureView,
  type ResourceEvidence,
} from "@shared/infrastructure";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "resources", label: "Resources" },
  { id: "queues", label: "Queues" },
  { id: "history", label: "History" },
];
const colour = (s: HealthState) =>
  s === "healthy"
    ? "var(--success)"
    : s === "unavailable"
      ? "var(--destructive)"
      : s === "degraded" || s === "stale"
        ? "var(--warning)"
        : "var(--muted-foreground)";
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const when = (s: string | null) =>
  s
    ? new Date(s).toLocaleString(undefined, { timeZoneName: "short" })
    : "No observation";
function State({ state }: { state: HealthState }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <i
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: colour(state) }}
      />
      {label(state)}
    </span>
  );
}
function Glyph({ id }: { id: string }) {
  const Icon = /database/.test(id)
    ? Database
    : /mqtt/.test(id)
      ? Radio
      : /worker/.test(id)
        ? Activity
        : Server;
  return <Icon aria-hidden className="size-4 text-info" strokeWidth={1.75} />;
}
function value(r: ResourceEvidence) {
  if (r.value == null) return "Unknown";
  return `${(r.unit === "bytes" ? r.value / 1048576 : r.value).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${r.unit === "bytes" ? "MiB" : r.unit}`;
}

function DependencyDiagram({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: HealthSnapshot;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const connected = new Set(
      snapshot.dependencies.flatMap((d) => [d.from, d.to]),
    ),
    nodes = snapshot.services.filter((s) => connected.has(s.id)),
    levels = new Map(nodes.map((s) => [s.id, 0]));
  // The recorded graph is bounded; cap passes to remain safe even for a configured cycle.
  for (let i = 0; i < nodes.length; i++) {
    let change = false;
    for (const edge of snapshot.dependencies) {
      const a = levels.get(edge.from) ?? 0,
        b = levels.get(edge.to) ?? 0;
      if (b <= a && a < 4) {
        levels.set(edge.to, a + 1);
        change = true;
      }
    }
    if (!change) break;
  }
  // Place a root beside the other direct parents of its child. Long edges must
  // not pass through unrelated nodes and visually imply an unrecorded link.
  for (const node of nodes) {
    if (snapshot.dependencies.some((e) => e.to === node.id)) continue;
    const children = snapshot.dependencies.filter((e) => e.from === node.id);
    if (children.length) {
      const nearest =
        Math.min(...children.map((e) => levels.get(e.to) ?? 1)) - 1;
      if (nearest > 0) levels.set(node.id, nearest);
    }
  }
  const max = Math.max(0, ...levels.values()),
    columns = Array.from({ length: max + 1 }, (_, level) =>
      nodes.filter((n) => levels.get(n.id) === level),
    ),
    height = Math.max(220, ...columns.map((c) => c.length * 100 + 30)),
    width = (max + 1) * 200;
  const position = new Map(
    columns.flatMap((col, x) =>
      col.map((s, y) => [s.id, { x: x * 200 + 12, y: y * 100 + 25 }] as const),
    ),
  );
  return (
    <figure aria-label="Configured logical dependencies" className="min-w-0">
      {nodes.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-md border bg-info/5 p-2 md:block">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="min-w-[640px] w-full"
              role="group"
              aria-label="Interactive configured service dependency diagram"
            >
              <defs>
                <marker
                  id="health-edge-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0,0 L7,3.5 L0,7" fill="var(--info)" />
                </marker>
              </defs>
              {snapshot.dependencies.map((e, i) => {
                const a = position.get(e.from),
                  b = position.get(e.to);
                return a && b ? (
                  <path
                    key={i}
                    d={`M${a.x + 168},${a.y + 32} C${a.x + 190},${a.y + 32} ${b.x - 20},${b.y + 32} ${b.x - 3},${b.y + 32}`}
                    fill="none"
                    stroke="var(--info)"
                    opacity=".65"
                    markerEnd="url(#health-edge-arrow)"
                  >
                    <title>{e.label}</title>
                  </path>
                ) : null;
              })}
              {nodes.map((s) => {
                const p = position.get(s.id)!;
                return (
                  <g
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${s.name}, ${label(s.state)}; inspect evidence`}
                    aria-pressed={selected === s.id}
                    onClick={() => onSelect(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(s.id);
                      }
                    }}
                    className="cursor-pointer focus:outline-2 focus:outline-primary"
                  >
                    <rect
                      x={p.x}
                      y={p.y}
                      width="168"
                      height="64"
                      rx="6"
                      fill="var(--card)"
                      stroke={
                        selected === s.id ? "var(--primary)" : "var(--border)"
                      }
                      strokeWidth={selected === s.id ? 2 : 1}
                    />
                    <circle
                      cx={p.x + 14}
                      cy={p.y + 18}
                      r="4"
                      fill={colour(s.state)}
                    />
                    <text
                      x={p.x + 26}
                      y={p.y + 22}
                      fill="var(--foreground)"
                      fontSize="12"
                      fontWeight="600"
                    >
                      {s.name.length > 22 ? s.name.slice(0, 20) + "…" : s.name}
                    </text>
                    <text
                      x={p.x + 14}
                      y={p.y + 46}
                      fill="var(--muted-foreground)"
                      fontSize="11"
                    >
                      {label(s.state)} · {s.dimension}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="grid gap-2 md:hidden">
            {columns.map((col, i) => (
              <div key={i} className="space-y-2">
                {i > 0 && (
                  <ArrowRight
                    aria-hidden
                    className="mx-auto size-4 rotate-90 text-info"
                  />
                )}
                {col.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    aria-pressed={selected === s.id}
                    onClick={() => onSelect(s.id)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-md border bg-card px-3 py-2 text-left ${selected === s.id ? "border-primary" : "border-border"}`}
                  >
                    <Glyph id={s.id} />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">
                      {s.name}
                    </span>
                    <State state={s.state} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="No configured dependency relationships"
          description="A service list remains available. Connections are drawn only from the installation's configuration."
        />
      )}
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        {snapshot.synthetic
          ? "Illustrative simulation relationships."
          : "Lines represent configured software dependencies."}{" "}
        Selecting a service opens its evidence. Arrows do not imply equipment
        movement or successful delivery.
      </figcaption>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Recorded relationships · text alternative
        </summary>
        <ul className="mt-2 space-y-2">
          {snapshot.dependencies.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                className="text-primary underline"
                onClick={() => onSelect(e.from)}
              >
                {snapshot.services.find((s) => s.id === e.from)?.name}
              </button>{" "}
              →{" "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => onSelect(e.to)}
              >
                {snapshot.services.find((s) => s.id === e.to)?.name}
              </button>{" "}
              · {e.label}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
function plot(data: InfrastructureView, id: string, queue = false) {
  const start = Date.parse(data.historyWindow.from),
    end = Date.parse(data.historyWindow.to),
    step = Math.max(
      data.snapshot.coverage.intervalSeconds * 1000,
      Math.ceil((end - start) / 120 / 60000) * 60000,
    );
  const bins = new Map<number, number | null>();
  for (const h of data.history) {
    const item = queue
      ? h.queues.find((r) => r.id === id)
      : h.resources.find((r) => r.id === id);
    bins.set(
      Math.floor((Date.parse(h.at) - start) / step),
      item
        ? queue
          ? (item as { pending: number | null }).pending
          : (item as { value: number | null }).value
        : null,
    );
  }
  return Array.from(
    { length: Math.min(121, Math.floor((end - start) / step) + 1) },
    (_, i) => ({ at: start + i * step, value: bins.get(i) ?? null }),
  );
}
function Trend({
  data,
  id,
  queue = false,
}: {
  data: InfrastructureView;
  id: string;
  queue?: boolean;
}) {
  const r = data.snapshot.resources.find((r) => r.id === id),
    q = data.snapshot.queues.find((r) => r.id === id),
    points = plot(data, id, queue),
    name = queue ? q?.name : r?.name,
    unit = queue ? "records" : r?.unit === "bytes" ? "MiB" : r?.unit;
  const values = points.map((p) => ({
    ...p,
    value: p.value != null && r?.unit === "bytes" ? p.value / 1048576 : p.value,
  }));
  return (
    <figure className="min-w-0 space-y-3" aria-label={`${name ?? id} history`}>
      <figcaption className="flex flex-wrap justify-between gap-2 text-sm">
        <strong className="font-semibold">{name}</strong>
        <span className="tabular-nums text-xs text-muted-foreground">
          {queue
            ? q?.pending == null
              ? "Unknown"
              : `${q.pending} pending`
            : r
              ? value(r)
              : "Unknown"}
        </span>
      </figcaption>
      {values.some((p) => p.value != null) ? (
        <>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={values}
                margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="at"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                  minTickGap={45}
                  tick={{ fontSize: 11 }}
                />
                <YAxis width={45} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  formatter={(v) => [
                    `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`,
                    name,
                  ]}
                  contentStyle={{
                    fontSize: 12,
                    background: "var(--card)",
                    borderColor: "var(--border)",
                  }}
                />
                <Line
                  dataKey="value"
                  type="linear"
                  connectNulls={false}
                  dot={values.filter((p) => p.value != null).length < 3}
                  stroke={queue ? "var(--primary)" : "var(--info)"}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Recorded values and gaps · {unit}
            </summary>
            <div className="mt-2 max-h-36 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Collected</th>
                    <th>Value · {unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((p) => (
                    <tr key={p.at}>
                      <td>{new Date(p.at).toLocaleTimeString()}</td>
                      <td className="tabular-nums">
                        {p.value == null
                          ? "No sample"
                          : p.value.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <EmptyState
          title="No collected history"
          description={
            r?.explanation ??
            "No current queue receipt is available. Unknown does not mean zero."
          }
        />
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        {queue ? q?.scope : r?.scope} · {unit}. Gaps remain empty.{" "}
        {data.historyWindow.expected > 120
          ? "Each displayed bucket retains its latest collected sample."
          : ""}
      </p>
    </figure>
  );
}
function Evidence({
  service,
  snapshot,
  onClose,
}: {
  service: ServiceEvidence;
  snapshot: HealthSnapshot;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2>{service.name}</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close service evidence"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <State state={service.state} />
      <p className="text-sm leading-6">{service.explanation}</p>
      <dl className="space-y-3 text-xs">
        {[
          ["Evidence dimension", service.dimension],
          ["Source", service.source],
          ["Measurement scope", service.scope],
          ["Observed", when(service.observedAt)],
          ["Collected", when(service.collectedAt)],
          ["Last successful check", when(service.lastSuccessAt)],
          ["Freshness policy", `${service.freshForSeconds} seconds`],
          [
            "Check duration",
            service.latencyMs == null
              ? "Not measured"
              : `${service.latencyMs.toFixed(1)} ms`,
          ],
          ["Reason", service.reason],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="mb-1 text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
        {snapshot.synthetic
          ? "Simulated example. No production evidence is shown."
          : "Private endpoints, connection strings and raw dependency errors are withheld."}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/administration/integrations">Review integrations</Link>
      </Button>
    </div>
  );
}
function ReleaseRecovery({ snapshot }: { snapshot: HealthSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Release & recovery evidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 text-xs sm:grid-cols-2">
          {[
            ["Frontend build", snapshot.release.frontend],
            ["API source", snapshot.release.api],
            ["Backend source", snapshot.release.backend],
            ["Applied database revision", snapshot.release.schema],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="mb-1 text-muted-foreground">{k}</dt>
              <dd>
                {v ? <CopyIdentifier value={v} /> : "No verified identity"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs">
          Contract compatibility:{" "}
          {snapshot.release.compatible == null
            ? "Unknown"
            : snapshot.release.compatible
              ? "Compatible with the available contract evidence"
              : "Needs review"}
        </p>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          {(["backup", "restore"] as const).map((kind) => {
            const receipt = snapshot.recovery.find(
              (r) => r.kind === kind && r.outcome === "verified",
            );
            return (
              <div key={kind} className="text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldCheck aria-hidden className="size-4 text-info" />
                  <strong className="font-medium">
                    {kind === "backup"
                      ? "Last verified backup receipt"
                      : "Last verified restore test"}
                  </strong>
                </div>
                {receipt ? (
                  <>
                    <p className="text-xs">{when(receipt.observedAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {receipt.scope.replaceAll("-", " ")} ·{" "}
                      {receipt.source.replaceAll("-", " ")}
                    </p>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer">
                        Receipt identity
                      </summary>
                      <p className="mt-2 break-all">{receipt.receiptId}</p>
                      <CopyIdentifier value={receipt.artifactSha256} />
                    </details>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No verified receipt
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Backup archive verification and a successful disposable restore are
          separate evidence. Qualified edge source identifies protocol code, not
          the binary installed on physical equipment.
        </p>
      </CardContent>
    </Card>
  );
}

export default function ServiceHealth() {
  const { user } = useAuth(),
    active = useDocumentActive(),
    wide = useMediaQuery("(min-width:1280px)"),
    { section = "overview" } = useParams<{ section?: string }>(),
    [location, navigate] = useWorkspaceLocation(),
    params = new URLSearchParams(location.split("?")[1] ?? ""),
    range = params.get("range") === "24h" ? "24h" : "2h",
    scenario = (
      ["normal", "failure", "recovery"].includes(params.get("scenario") ?? "")
        ? params.get("scenario")
        : "normal"
    ) as "normal" | "failure" | "recovery",
    selected = params.get("service") ?? undefined;
  const permitted =
      !!user && (user.access?.demoOnly || user.access?.canAdminister),
    query = trpc.system.infrastructure.useQuery(
      { range, scenario },
      {
        enabled: permitted,
        staleTime: 30000,
        refetchInterval: (q) =>
          active
            ? Math.min(300000, 30000 * 2 ** q.state.fetchFailureCount)
            : false,
        refetchIntervalInBackground: false,
        retry: 1,
      },
    );
  const [resourceId, setResourceId] = useState("api-rss");
  const update = (values: Record<string, string>, tab = section) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) v ? p.set(k, v) : p.delete(k);
    navigate(`/infrastructure/service-health/${tab}${p.size ? "?" + p : ""}`);
  };
  if (
    !permitted ||
    ["FORBIDDEN", "UNAUTHORIZED"].includes(query.error?.data?.code ?? "")
  )
    return (
      <EmptyState
        title="Service health is restricted"
        description="Use an individual administrator account for detailed operating evidence, or the isolated demonstration workspace."
      />
    );
  const raw = query.data,
    data = raw
      ? {
          ...raw,
          snapshot: raw.snapshot.synthetic
            ? raw.snapshot
            : ageSnapshot(raw.snapshot),
        }
      : null,
    snapshot = data?.snapshot,
    service = snapshot?.services.find((s) => s.id === selected),
    attention =
      snapshot?.services.filter((s) =>
        ["degraded", "unavailable", "stale"].includes(s.state),
      ) ?? [];
  return (
    <div className="space-y-[var(--workspace-gap)]">
      <PageHeader
        title="Service health"
        description="Application dependencies, delivery and recovery evidence."
        action={
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={`size-4 ${query.isFetching && active ? "motion-safe:animate-spin" : ""}`}
            />
            Refresh view
          </Button>
        }
      />
      {snapshot?.synthetic && (
        <p className="rounded-md border border-info/40 bg-info/5 p-3 text-sm">
          <strong>Simulated infrastructure</strong> · Recorded examples only. No
          production probes, restarts, queue changes or email requests.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-36 flex-col gap-1.5 text-xs">
          History window
          <select
            className="workspace-control"
            aria-label="Infrastructure history window"
            value={range}
            onChange={(e) => update({ range: e.target.value })}
          >
            <option value="2h">Last 2 hours</option>
            <option value="24h">Last 24 hours</option>
          </select>
        </label>
        {snapshot?.synthetic && (
          <label className="flex min-w-44 flex-col gap-1.5 text-xs">
            Recorded scenario
            <select
              className="workspace-control"
              aria-label="Infrastructure simulation scenario"
              value={scenario}
              onChange={(e) => update({ scenario: e.target.value })}
            >
              <option value="normal">Normal collection</option>
              <option value="failure">Subscription failure</option>
              <option value="recovery">Recovered delivery</option>
            </select>
          </label>
        )}
        <p className="pb-2 text-xs text-muted-foreground">
          {snapshot
            ? `${snapshot.synthetic ? "Example recorded" : "Last collected"} · ${when(snapshot.collectedAt)}`
            : "Waiting for evidence"}
        </p>
      </div>
      <SectionNav
        label="Service health views"
        sections={sections}
        value={section}
        onChange={(v) => update({}, v)}
      >
        {!sections.some((s) => s.id === section) ? (
          <EmptyState title="Section unavailable" />
        ) : query.isLoading ? (
          <EmptyState
            title="Collecting permitted service evidence…"
            description="Configured checks have independent timeouts; optional dependencies do not make the installation unavailable."
          />
        ) : !data || !snapshot ? (
          <EmptyState
            error
            title="Infrastructure evidence unavailable"
            description="No authorized snapshot could be read. A missing check is not a healthy result."
          />
        ) : (
          <>
            {(query.error || snapshot.stale) && (
              <p
                role="alert"
                className="mb-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
              >
                Last-known authorized evidence · {when(snapshot.collectedAt)}.{" "}
                {query.error
                  ? "The latest refresh failed."
                  : "The collection freshness policy has expired."}{" "}
                Timestamps and stale worker counts are retained.
              </p>
            )}
            <div
              className={`grid min-w-0 gap-[var(--workspace-gap)] ${service && wide ? "xl:grid-cols-[minmax(0,1fr)_19rem]" : ""}`}
            >
              <div className="min-w-0 space-y-[var(--workspace-gap)]">
                {section === "overview" && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Logical service dependencies</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DependencyDiagram
                          snapshot={snapshot}
                          selected={selected}
                          onSelect={(id) => update({ service: id })}
                        />
                      </CardContent>
                    </Card>
                    <div className="grid min-w-0 gap-[var(--workspace-gap)] lg:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Process resources</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Trend data={data} id="api-rss" />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Delivery backlog</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Trend data={data} id="telemetry" queue />
                        </CardContent>
                      </Card>
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle>Needs attention</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {attention.length ? (
                          <ul className="divide-y">
                            {attention.map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  className="flex min-h-12 w-full flex-wrap items-center gap-3 py-3 text-left text-sm"
                                  onClick={() => update({ service: s.id })}
                                >
                                  <Glyph id={s.id} />
                                  <strong className="min-w-0 flex-1 font-medium">
                                    {s.name}
                                  </strong>
                                  <State state={s.state} />
                                  <ArrowRight
                                    aria-hidden
                                    className="size-4 text-primary"
                                  />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No observed service is currently in an attention
                            state. Unknown and unconfigured coverage remain
                            visible in Services.
                          </p>
                        )}
                        <p className="mt-3 text-xs text-muted-foreground">
                          Infrastructure incidents use their own category. They
                          are separate from process alerts and cybersecurity
                          findings.
                        </p>
                      </CardContent>
                    </Card>
                    <ReleaseRecovery snapshot={snapshot} />
                  </>
                )}
                {section === "services" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Services & evidence dimensions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="divide-y">
                        {snapshot.services.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              onClick={() => update({ service: s.id })}
                              className="grid min-h-16 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left"
                            >
                              <Glyph id={s.id} />
                              <span className="min-w-0">
                                <strong className="block text-sm font-medium">
                                  {s.name}
                                </strong>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {s.dimension} ·{" "}
                                  {s.observedAt
                                    ? when(s.observedAt)
                                    : "No observed evidence"}
                                </span>
                              </span>
                              <State state={s.state} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
                {section === "resources" && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Measured resources</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <label className="flex max-w-sm flex-col gap-1.5 text-xs">
                          Metric and scope
                          <select
                            className="workspace-control"
                            aria-label="Infrastructure resource metric"
                            value={resourceId}
                            onChange={(e) => setResourceId(e.target.value)}
                          >
                            {snapshot.resources.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} · {r.scope}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Trend data={data} id={resourceId} />
                        <p className="text-xs text-muted-foreground">
                          {
                            snapshot.resources.find((r) => r.id === resourceId)
                              ?.explanation
                          }
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Collector coverage</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="grid gap-4 sm:grid-cols-2">
                          {snapshot.resources.map((r) => (
                            <div key={r.id} className="text-xs">
                              <dt className="text-muted-foreground">
                                {r.name} · {r.scope}
                              </dt>
                              <dd className="mt-1 font-medium tabular-nums">
                                {value(r)}
                              </dd>
                              <dd className="mt-1 text-muted-foreground">
                                {r.value == null
                                  ? "Not connected / unknown"
                                  : when(r.observedAt)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </CardContent>
                    </Card>
                  </>
                )}
                {section === "queues" && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Queues & acceptance age</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-5">
                          {snapshot.queues.map((q) => {
                            const max = Math.max(
                              1,
                              ...snapshot.queues.map((v) => v.pending ?? 0),
                            );
                            return (
                              <li key={q.id} className="space-y-2">
                                <div className="flex flex-wrap justify-between gap-2 text-sm">
                                  <strong className="font-medium">
                                    {q.name}
                                  </strong>
                                  <State state={q.state} />
                                </div>
                                <div
                                  className="h-3 overflow-hidden rounded bg-muted"
                                  role="img"
                                  aria-label={`${q.name}: ${q.pending == null ? "unknown depth" : q.pending + " pending records"}; relative depth across observed queues`}
                                >
                                  <div
                                    className="h-full bg-info"
                                    style={{
                                      width: `${q.pending == null ? 0 : (100 * q.pending) / max}%`,
                                    }}
                                  />
                                </div>
                                <p className="text-xs tabular-nums">
                                  {q.pending ?? "Unknown"} pending ·{" "}
                                  {q.quarantined ?? "Unknown"} quarantined ·{" "}
                                  {q.failed ?? "Unknown"} with failures · Oldest
                                  accepted:{" "}
                                  {q.oldestAgeSeconds == null
                                    ? "Unknown"
                                    : `${Math.floor(q.oldestAgeSeconds)} s ago`}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Observed {when(q.observedAt)} · {q.scope}
                                </p>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  {q.explanation}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>
                    {snapshot.queues.map((q) => (
                      <Card key={q.id}>
                        <CardContent>
                          <Trend data={data} id={q.id} queue />
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
                {(section === "overview" || section === "history") && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {section === "overview"
                          ? "Recent health events"
                          : "Health history & collection coverage"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {section === "history" && (
                        <>
                          <div
                            className="flex h-8 gap-px overflow-hidden rounded border"
                            role="img"
                            aria-label={`${data.historyWindow.returned} collected snapshots; ${data.historyWindow.gaps} expected collection slots without evidence. Availability percentage is not established.`}
                          >
                            {plot(data, "api-rss").map((p) => (
                              <span
                                key={p.at}
                                className="min-w-0 flex-1"
                                style={{
                                  background:
                                    p.value == null
                                      ? "var(--muted)"
                                      : "var(--info)",
                                }}
                                title={`${new Date(p.at).toLocaleString()}: ${p.value == null ? "Collection gap" : "Collected evidence"}`}
                              />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {data.historyWindow.returned} collected /{" "}
                            {data.historyWindow.expected} expected slots ·{" "}
                            {data.historyWindow.gaps} gaps.{" "}
                            {snapshot.coverage.mode === "demand"
                              ? "Demand-driven checks are not a continuous uptime monitor."
                              : "Recorded observations do not establish independent availability."}{" "}
                            No availability percentage is inferred.
                          </p>
                        </>
                      )}
                      {data.events.length ? (
                        <ol className="space-y-4 border-l-2 border-info/30 pl-4">
                          {data.events
                            .slice(0, section === "overview" ? 5 : 100)
                            .map((e) => (
                              <li key={e.id} className="space-y-1 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    className="font-medium text-primary underline"
                                    onClick={() =>
                                      update({ service: e.serviceId })
                                    }
                                  >
                                    {e.name}
                                  </button>
                                  <State state={e.state} />
                                  <Badge variant="outline">{e.kind}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {when(e.at)} ·{" "}
                                  {e.reason.replaceAll("_", " ").toLowerCase()}
                                </p>
                              </li>
                            ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No retained transitions in this window. This is not
                          proof that no outage occurred outside collection
                          coverage.
                        </p>
                      )}
                      <p className="text-xs leading-5 text-muted-foreground">
                        Alerts require {data.policy.alertAfterSeconds}s of an
                        observed attention condition; recovery requires{" "}
                        {data.policy.recoveryAfterSeconds}s. Repeated alerts are
                        deduplicated. Up to 100 events are shown; snapshots
                        retain 24 hours and events up to seven days / 500
                        entries.
                      </p>
                    </CardContent>
                  </Card>
                )}
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {snapshot.coverage.explanation} Checks are cached for at least
                  60 seconds across viewers. Independent monitoring coverage:{" "}
                  {snapshot.coverage.independentMonitor === "configured"
                    ? "configuration present; verified external coverage still required"
                    : "unknown"}
                  .
                </p>
              </div>
              {service && wide && (
                <aside
                  aria-label="Service evidence"
                  className="self-start rounded-lg border bg-card p-4"
                >
                  <Evidence
                    service={service}
                    snapshot={snapshot}
                    onClose={() => update({ service: "" })}
                  />
                </aside>
              )}
            </div>
            {service && !wide && (
              <Sheet
                open
                onOpenChange={(open) => {
                  if (!open) update({ service: "" });
                }}
              >
                <SheetContent
                  side="bottom"
                  className="max-h-[85dvh] overflow-y-auto rounded-t-xl"
                >
                  <SheetHeader>
                    <SheetTitle>Service evidence</SheetTitle>
                    <SheetDescription>
                      Read-only observations and freshness for this service.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="p-4">
                    <Evidence
                      service={service}
                      snapshot={snapshot}
                      onClose={() => update({ service: "" })}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </>
        )}
      </SectionNav>
    </div>
  );
}
