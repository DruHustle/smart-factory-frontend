import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  Network,
  Clock3,
  Upload,
  Download,
  RefreshCw,
  ArrowRight,
  Radio,
} from "lucide-react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import {
  networkSnapshot,
  networkScenarios,
  type NetworkSnapshot,
} from "@shared/network-diagnostics";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  PageHeader,
  SampleTime,
} from "@/components/workspace/Primitives";

function TimingGraph({
  samples,
  kind,
  deadline,
}: {
  samples: NetworkSnapshot["streams"][number]["samples"];
  kind: "clock" | "stream";
  deadline?: number | null;
}) {
  const clock = kind === "clock";
  return (
    <div
      className="h-56"
      role="img"
      aria-label={
        clock
          ? "Reported clock offset in nanoseconds"
          : "Reported stream latency and jitter in microseconds"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={samples}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="at"
            tickFormatter={(s) => String(s).slice(11, 19)}
            minTickGap={40}
            tick={{ fontSize: 10 }}
          />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip labelFormatter={(s) => `${s} UTC`} />
          {!clock && deadline != null && (
            <ReferenceLine
              y={deadline}
              stroke="var(--destructive)"
              strokeDasharray="4 3"
            />
          )}
          <Line
            dataKey={clock ? "offsetNs" : "latencyUs"}
            name={clock ? "Offset (ns)" : "Latency (µs)"}
            stroke="var(--chart-1)"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {!clock && (
            <Line
              dataKey="jitterUs"
              name="Jitter (µs)"
              stroke="var(--chart-4)"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function NetworkDiagnostics() {
  const { user } = useAuth(),
    active = useDocumentActive(),
    file = useRef<HTMLInputElement>(null);
  const [location, navigate] = useWorkspaceLocation(),
    [streamId, setStreamId] = useState(""),
    [gatewayId, setGatewayId] = useState("");
  const params = new URLSearchParams(location.split("?")[1] ?? ""),
    timing = params.get("tab") === "timing";
  const scenario = networkScenarios.includes(
    params.get("scenario") as (typeof networkScenarios)[number],
  )
    ? (params.get("scenario") as (typeof networkScenarios)[number])
    : "normal";
  const update = (values: Record<string, string>) => {
    const q = new URLSearchParams(params);
    Object.entries(values).forEach(([k, v]) => (v ? q.set(k, v) : q.delete(k)));
    navigate(`/network${q.size ? `?${q}` : ""}`);
  };
  const query = trpc.networkDiagnostics.overview.useQuery(
    { scenario },
    {
      staleTime: 15000,
      refetchInterval: active ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const utils = trpc.useUtils();
  const upload = trpc.networkDiagnostics.importSnapshot.useMutation({
    onSuccess: () => {
      toast.success("Diagnostics snapshot imported");
      void utils.networkDiagnostics.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const data = query.data,
    snapshots = data?.snapshots ?? [],
    snapshot = snapshots.find((s) => s.gatewayId === gatewayId) ?? snapshots[0];
  const components = snapshot?.components ?? [],
    connections = snapshot?.connections ?? [],
    ports = snapshot?.ports ?? [],
    streams = snapshot?.streams ?? [];
  const stream = streams.find((s) => s.id === streamId) ?? streams[0],
    connection = connections.find((c) => c.id === stream?.connectionId);
  const exportSnapshot = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `smart-factory-network-${data?.synthetic ? "simulation" : "snapshot"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="FX & TSN"
        description="Automation components, data connections and Ethernet timing evidence."
        action={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh network diagnostics"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className="size-4" />
            </Button>
            {user?.access?.canEngineer && (
              <Button
                variant="outline"
                onClick={() => file.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="size-4" />
                Import snapshot
              </Button>
            )}
            <Button
              variant="outline"
              onClick={exportSnapshot}
              disabled={!snapshot}
            >
              <Download className="size-4" />
              Export snapshot
            </Button>
          </>
        }
      />
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import network diagnostics snapshot"
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected) return;
          if (selected.size > 1500000) {
            toast.error("Select a diagnostics JSON file smaller than 1.5 MB.");
            return;
          }
          try {
            const result = networkSnapshot.safeParse(
              JSON.parse(await selected.text()),
            );
            if (!result.success)
              throw Error(
                "The snapshot has invalid identities, timing evidence or unsupported fields.",
              );
            upload.mutate({ ...result.data, source: "operator-import" });
          } catch (e) {
            toast.error(
              e instanceof Error ? e.message : "Invalid diagnostics file",
            );
          }
        }}
      />
      {data?.synthetic && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
          <span>
            <strong>Read-only FX / TSN simulation.</strong> Values illustrate
            behaviours; no physical TSN network was measured.
          </span>
          <select
            aria-label="Network demonstration scenario"
            className="workspace-control max-w-48"
            value={scenario}
            onChange={(e) => update({ scenario: e.target.value })}
          >
            {networkScenarios.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </div>
      )}
      {data?.stale && (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          Collector evidence is stale. Reported operational states do not
          establish current connectivity.
        </p>
      )}
      {data?.coverage && data.coverage.returned < data.coverage.total && (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 p-3 text-sm"
        >
          Showing {data.coverage.returned} of {data.coverage.total} gateway
          reports. Overview network totals cover these reports only.
        </p>
      )}
      {snapshots.length > 1 && (
        <label className="flex flex-wrap items-center gap-3 text-sm">
          Diagnostics gateway
          <select
            aria-label="Diagnostics gateway"
            className="workspace-control max-w-sm"
            value={snapshot?.gatewayId ?? ""}
            onChange={(e) => {
              setGatewayId(e.target.value);
              setStreamId("");
            }}
          >
            {snapshots.map((s) => (
              <option key={s.gatewayId} value={s.gatewayId}>
                {s.gatewayId}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        role="tablist"
        aria-label="Network diagnostics sections"
        className="flex flex-wrap gap-2 border-b pb-2"
      >
        <Button
          role="tab"
          aria-selected={!timing}
          variant={!timing ? "secondary" : "ghost"}
          onClick={() => update({ tab: "" })}
        >
          <Network className="size-4" />
          Components & connections
        </Button>
        <Button
          role="tab"
          aria-selected={timing}
          variant={timing ? "secondary" : "ghost"}
          onClick={() => update({ tab: "timing" })}
        >
          <Clock3 className="size-4" />
          Timing & diagnostics
        </Button>
      </div>
      {query.isLoading ? (
        <EmptyState title="Loading network diagnostics…" />
      ) : query.error ? (
        <EmptyState
          error
          title="Network diagnostics unavailable"
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      ) : !snapshot ? (
        <EmptyState
          title="No FX / TSN collector connected"
          description="Commission a read-only collector for a registered gateway, or import its diagnostics snapshot. Existing OPC UA and MQTT devices continue to appear on the factory floor."
          action={
            <Button asChild variant="outline">
              <Link href="/inventory">
                Open assets & devices <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Automation components", components.length],
              ["Data connections", connections.length],
              [
                "Reported locked clocks",
                `${ports.filter((p) => p.syncState === "locked").length}/${ports.length}`,
              ],
              ["Timing streams", streams.length],
            ].map(([name, value]) => (
              <Card key={name}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{name}</p>
                  <strong className="mt-2 block text-2xl tabular-nums">
                    {value}
                  </strong>
                </CardContent>
              </Card>
            ))}
          </div>
          {!timing ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Automation components</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul
                    className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                    aria-label="FX automation components"
                  >
                    {components.map((component) => (
                      <li
                        key={component.id}
                        className="min-w-0 rounded-lg border p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Radio className="size-5 text-info" />
                          <Badge variant="outline">{component.health}</Badge>
                        </div>
                        <h3 className="mt-3 break-words text-sm font-semibold">
                          {component.name}
                        </h3>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          FX {component.modelVersion}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Monitoring:{" "}
                          {component.monitoring.replaceAll("-", " ")}
                        </p>
                        <ul className="mt-3 space-y-2 border-t pt-3">
                          {component.functionalEntities.map((fn) => (
                            <li key={fn.id}>
                              <strong className="text-xs font-medium">
                                {fn.name}
                              </strong>
                              <p className="text-[11px] text-muted-foreground">
                                {fn.inputs.length} inputs · {fn.outputs.length}{" "}
                                outputs
                              </p>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Logical data connections</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3" aria-label="FX logical connections">
                    {connections.map((c) => (
                      <li key={c.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                            <span>
                              {components.find((p) => p.id === c.publisher)
                                ?.name ?? c.publisher}
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-info" />
                            <span>
                              {components.find((p) => p.id === c.subscriber)
                                ?.name ?? c.subscriber}
                            </span>
                          </div>
                          <Badge variant="outline">{c.state}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {c.transport.toUpperCase()} · cycle{" "}
                          {c.publishingIntervalUs ?? "Unknown"} µs · configured
                          deadline {c.deadlineUs ?? "Unknown"} µs
                        </p>
                        {c.diagnostics.map((d) => (
                          <p
                            className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-xs"
                            key={d}
                          >
                            {d}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Clock and port quality</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          {[
                            "Port",
                            "Link",
                            "Synchronisation",
                            "Offset (ns)",
                            "Timestamping",
                            "Reported features",
                          ].map((h) => (
                            <th
                              key={h}
                              className="whitespace-nowrap p-3 font-medium"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ports.map((port) => (
                          <tr key={port.id} className="border-b last:border-0">
                            <td className="p-3 font-medium">{port.name}</td>
                            <td className="p-3">{port.link}</td>
                            <td className="p-3">
                              <Badge variant="outline">{port.syncState}</Badge>
                              <span className="mt-1 block text-muted-foreground">
                                Domain {port.clockDomain ?? "unknown"}
                              </span>
                            </td>
                            <td className="p-3 tabular-nums">
                              {port.offsetNs ?? "Unavailable"}
                            </td>
                            <td className="p-3">{port.timestamping}</td>
                            <td className="p-3">
                              {port.features.join(", ") || "Not reported"}
                              <span className="mt-1 block text-muted-foreground">
                                {port.scheduleConfigured
                                  ? "Schedule configured"
                                  : "Schedule not reported"}{" "}
                                ·{" "}
                                {port.scheduleHardwareVerified &&
                                !data?.synthetic
                                  ? "hardware enforcement reported"
                                  : "hardware enforcement unverified"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
                  <CardTitle>Stream timing</CardTitle>
                  <select
                    aria-label="Timing stream"
                    className="workspace-control max-w-full sm:max-w-sm"
                    value={stream?.id ?? ""}
                    onChange={(e) => setStreamId(e.target.value)}
                  >
                    {streams.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </CardHeader>
                <CardContent>
                  {!stream ? (
                    <EmptyState title="No timing measurements reported" />
                  ) : (
                    <>
                      <div className="mb-4 flex flex-wrap gap-5 text-sm">
                        <span>
                          Packets:{" "}
                          <strong>{stream.packets ?? "Unknown"}</strong>
                        </span>
                        <span>
                          Lost: <strong>{stream.lost ?? "Unknown"}</strong>
                        </span>
                        <span>
                          Deadline misses:{" "}
                          <strong>
                            {stream.deadlineMisses ?? "Unavailable"}
                          </strong>
                        </span>
                        <Badge variant="outline">
                          {data?.synthetic
                            ? "Simulated timing"
                            : stream.latencyEvidence}
                        </Badge>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <h3 className="mb-3 text-xs font-medium">
                            Clock offset · nanoseconds
                          </h3>
                          {stream.samples.some((s) => s.offsetNs !== null) ? (
                            <TimingGraph
                              samples={stream.samples}
                              kind="clock"
                            />
                          ) : (
                            <EmptyState title="Clock offset unavailable" />
                          )}
                        </div>
                        <div>
                          <h3 className="mb-3 text-xs font-medium">
                            Latency and jitter · microseconds
                          </h3>
                          {stream.latencyEvidence === "unavailable" ? (
                            <EmptyState
                              title="One-way latency unavailable"
                              description="Both endpoint clocks must have valid synchronised timestamp evidence. No latency or deadline result is inferred."
                            />
                          ) : (
                            <TimingGraph
                              samples={stream.samples}
                              kind="stream"
                              deadline={connection?.deadlineUs}
                            />
                          )}
                        </div>
                      </div>
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-medium">
                          Accessible timing data
                        </summary>
                        <div className="max-h-72 overflow-auto">
                          <table className="mt-3 w-full text-left text-xs">
                            <thead>
                              <tr>
                                <th className="p-2">UTC sample</th>
                                <th className="p-2">Offset ns</th>
                                <th className="p-2">Jitter µs</th>
                                <th className="p-2">Latency µs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stream.samples.map((s) => (
                                <tr key={s.at} className="border-t">
                                  <td className="p-2">{s.at}</td>
                                  <td className="p-2">
                                    {s.offsetNs ?? "Unavailable"}
                                  </td>
                                  <td className="p-2">
                                    {s.jitterUs ?? "Unavailable"}
                                  </td>
                                  <td className="p-2">
                                    {s.latencyUs ?? "Unavailable"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Source: {data?.provenance.replaceAll("-", " ")} · Recorded{" "}
            <SampleTime value={snapshot.observedAt} historical /> · Reported
            capabilities and configured schedules are distinct from tested
            end-to-end TSN guarantees.
          </p>
        </>
      )}
    </div>
  );
}
