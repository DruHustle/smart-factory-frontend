import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  ArrowLeft,
  Cable,
  Clock3,
  Cpu,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import {
  type ConnectivityObservation,
  type IndustrialConnection,
  type IndustrialConfiguration,
} from "@shared/industrial-connectivity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  EmptyState,
  PageHeader,
  SampleTime,
} from "@/components/workspace/Primitives";
import {
  ConnectionEditor,
  newConnection,
  protocolLabel,
} from "@/components/connectivity/ConnectionEditor";
import { ConnectivityEvidence } from "@/components/connectivity/ConnectivityEvidence";

type Draft = {
  gatewayDeviceId: string;
  expectedRevision: number;
  connections: IndustrialConnection[];
};
type Edit = {
  key: string;
  index: number | null;
  connection: IndustrialConnection;
};
type ObservedTag = ConnectivityObservation["tags"][number] & {
  observedAt: string;
  configurationRevision: number;
};

function acquisitionConfiguration(data?: {
  configuration: IndustrialConfiguration | null;
  activeConfiguration?: IndustrialConfiguration | null;
}) {
  return data?.activeConfiguration === undefined
    ? data?.configuration
    : data.activeConfiguration;
}

function formattedValue(tag: ObservedTag | undefined) {
  if (!tag || tag.value === null) return "—";
  if (typeof tag.value === "boolean") return tag.value ? "True" : "False";
  if (typeof tag.value === "number")
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: 10,
    }).format(tag.value);
  return tag.value;
}

function deliveryMessage(reason: string) {
  if (reason === "delivery_unconfirmed")
    return "Gateway delivery is unconfirmed. A gateway acknowledgement may still arrive; review the reported revision before retrying.";
  if (reason === "provisioner_not_configured")
    return "Gateway provisioning is not configured. Connect the provisioning service before requesting device acquisition.";
  return reason;
}

function tagAddress(
  connection: IndustrialConnection,
  source: IndustrialConnection["tags"][number]["source"],
) {
  if ("nodeId" in source) return source.nodeId;
  if ("address" in source)
    return `${source.registerType.replaceAll("_", " ")} ${source.address} · unit ${source.unitId}`;
  if ("topic" in source)
    return `${source.topic}${source.path ? ` · ${source.path}` : ""}`;
  if ("fieldIndex" in source) return `Data set field ${source.fieldIndex}`;
  return protocolLabel(connection.protocol);
}

function ReportState({
  report,
  intervalMs,
}: {
  report?: ConnectivityObservation;
  intervalMs: number;
}) {
  const stale =
    report &&
    Date.now() - Date.parse(report.observedAt) >
      Math.max(60000, intervalMs * 3);
  const label = !report
    ? "No report"
    : stale
      ? "Report stale"
      : `Reported ${report.state}`;
  const healthy = report?.state === "connected" && !stale;
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${healthy ? "bg-success" : report?.state === "disconnected" ? "bg-destructive" : "bg-muted-foreground"}`}
      />
      {label}
    </Badge>
  );
}

export default function IndustrialConnectivity() {
  const { user } = useAuth();
  const active = useDocumentActive();
  const [location, navigate] = useWorkspaceLocation();
  const requestedGateway =
    new URLSearchParams(location.split("?")[1] ?? "").get("gateway") ?? "";
  const gateways = trpc.connectivity.gateways.useQuery(undefined, {
    staleTime: 30000,
  });
  const drivers = trpc.connectivity.drivers.useQuery(undefined, {
    staleTime: Infinity,
  });
  const gatewayId =
    gateways.data?.find(
      (gateway) => gateway.gatewayDeviceId === requestedGateway,
    )?.gatewayDeviceId ??
    gateways.data?.[0]?.gatewayDeviceId ??
    "";
  const gateway = gateways.data?.find(
    (entry) => entry.gatewayDeviceId === gatewayId,
  );
  const query = trpc.connectivity.get.useQuery(
    { gatewayDeviceId: gatewayId },
    {
      enabled: !!gatewayId,
      refetchInterval: active ? 15000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    },
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [remove, setRemove] = useState<string | null>(null);
  const [discardForGateway, setDiscardForGateway] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const [historyTag, setHistoryTag] = useState("");
  const utils = trpc.useUtils();
  const data = query.data;
  const localDraft = draft?.gatewayDeviceId === gatewayId ? draft : null;
  const connections =
    localDraft?.connections ?? data?.configuration?.connections ?? [];
  const activeConfiguration = acquisitionConfiguration(data);
  const activeConnections = activeConfiguration?.connections ?? [];
  const publishedOnly = activeConnections.filter(
    (connection) =>
      !connections.some(
        (desired) => desired.connectionId === connection.connectionId,
      ),
  );
  const displayConnections = [...connections, ...publishedOnly];
  const selected =
    displayConnections.find(
      (connection) => connection.connectionId === selectedId,
    ) ?? displayConnections[0];
  const selectedDesired = connections.find(
    (connection) => connection.connectionId === selected?.connectionId,
  );
  const selectedActive = activeConnections.find(
    (connection) => connection.connectionId === selected?.connectionId,
  );
  const desiredDiffers =
    JSON.stringify(selectedDesired) !== JSON.stringify(selectedActive);
  const canConfigure =
    !!data?.canConfigure && !!user?.access?.canEngineer && !data.synthetic;
  const changedElsewhere =
    !!localDraft && localDraft.expectedRevision !== data?.revision;
  const observations = useMemo(
    () =>
      (data?.observations ?? [])
        .filter(
          (report) =>
            !report.commandId &&
            report.configurationRevision === activeConfiguration?.revision,
        )
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)),
    [data?.observations, activeConfiguration?.revision],
  );
  const reports = observations.filter(
    (report) => report.connectionId === selected?.connectionId,
  );
  const latest = reports[0];
  const latestTags = useMemo(() => {
    const mapped = new Map<string, ObservedTag>();
    for (const report of reports)
      for (const tag of report.tags)
        if (!mapped.has(tag.tagId))
          mapped.set(tag.tagId, {
            ...tag,
            observedAt: report.observedAt,
            configurationRevision: report.configurationRevision,
          });
    return mapped;
  }, [reports]);
  const fx = reports.find((report) => report.fx)?.fx;
  const tsn = reports.find((report) => report.tsn)?.tsn;
  const history = trpc.connectivity.history.useQuery(
    {
      gatewayDeviceId: gatewayId,
      connectionId: selected?.connectionId ?? "",
      tagId: historyTag,
      limit: 30,
    },
    { enabled: !!gatewayId && !!selected && !!historyTag, retry: false },
  );
  const save = trpc.connectivity.save.useMutation({
    onSuccess: async () => {
      setDraft(null);
      setError("");
      await utils.connectivity.get.invalidate({ gatewayDeviceId: gatewayId });
      toast.success(
        "Configuration saved. Apply it to the gateway to start using it.",
      );
    },
    onError: (e) => setError(e.message),
  });
  const publish = trpc.connectivity.publish.useMutation({
    onSuccess: async (result) => {
      await utils.connectivity.get.invalidate({ gatewayDeviceId: gatewayId });
      if (result.published) {
        setError("");
        toast.success(
          "Configuration sent. Waiting for the gateway to report its applied revision.",
        );
      } else
        setError(
          result.reason === "delivery_unconfirmed"
            ? ""
            : deliveryMessage(
                result.reason ??
                  "The configuration could not be sent to the gateway.",
              ),
        );
    },
    onError: (e) => setError(e.message),
  });
  const probe = trpc.connectivity.probe.useMutation();
  const busy = save.isPending || publish.isPending;
  const deliveryPending =
    data?.publication?.status === "pending" &&
    Date.now() - data.publication.startedAt < 20000;
  const setConnections = (next: IndustrialConnection[]) => {
    setDraft({
      gatewayDeviceId: gatewayId,
      expectedRevision: localDraft?.expectedRevision ?? data?.revision ?? 0,
      connections: next,
    });
    setError("");
  };
  const selectGateway = (id: string) => {
    setDraft(null);
    setSelectedId("");
    setHistoryTag("");
    setError("");
    navigate(`/connectivity?gateway=${encodeURIComponent(id)}`);
  };
  return (
    <div className="min-w-0 space-y-5" data-testid="industrial-connectivity">
      <PageHeader
        title="Industrial device connectivity"
        description="Connect equipment, map signals to assets and inspect acquisition at the edge."
        eyebrow={
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Assets & devices
          </Link>
        }
        action={
          <>
            <Button asChild variant="outline">
              <Link
                href={
                  gatewayId
                    ? `/network?gateway=${encodeURIComponent(gatewayId)}`
                    : "/network"
                }
              >
                <Network className="mr-1.5 size-4" />
                FX & TSN
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh device connectivity"
              disabled={query.isFetching || gateways.isFetching}
              onClick={() => {
                void gateways.refetch();
                if (gatewayId) void query.refetch();
              }}
            >
              <RefreshCw className="size-4" />
            </Button>
          </>
        }
      />

      <div
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Connectivity workflow"
      >
        {(
          [
            [
              Cpu,
              "1. Select a gateway",
              "Choose the edge computer that can reach your equipment.",
            ],
            [
              Cable,
              "2. Configure connections",
              "Select drivers and give each equipment signal its own tag.",
            ],
            [
              Activity,
              "3. Verify acquisition",
              "Inspect reported state, values, quality and timing evidence.",
            ],
          ] as const
        ).map(([Icon, title, description]) => (
          <div
            key={title}
            className="flex min-w-0 gap-3 rounded-xl border bg-card p-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Available protocol drivers{" "}
          <span className="ml-2 font-normal text-muted-foreground">
            OPC UA · Modbus · MQTT · OPC UA FX
          </span>
        </summary>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(drivers.data ?? []).map((driver) => (
            <article key={driver.id} className="min-w-0 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">{driver.label}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {driver.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {driver.capabilities.map((capability) => (
                  <Badge
                    key={capability}
                    variant="outline"
                    className="text-[10px] font-normal"
                  >
                    {capability}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {driver.qualification}
              </p>
            </article>
          ))}
          {drivers.isError && (
            <p role="alert" className="text-sm">
              Driver information is unavailable. Refresh the page to try again.
            </p>
          )}
        </div>
      </details>

      {gateways.isPending ? (
        <EmptyState title="Loading gateways…" />
      ) : gateways.isError ? (
        <EmptyState
          error
          title="Gateways unavailable"
          description={gateways.error.message}
          action={
            <Button variant="outline" onClick={() => void gateways.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !gatewayId ? (
        <EmptyState
          title="Register an edge gateway to get started"
          description="Connections run on a registered gateway. Add your gateway in Assets & devices, then return here to configure the equipment it can reach."
          action={
            <Button asChild variant="outline">
              <Link href="/inventory?view=gateways">Open gateways</Link>
            </Button>
          }
        />
      ) : (
        <>
          <section
            className="space-y-4 rounded-xl border bg-card p-4"
            aria-label="Gateway configuration"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5 text-sm sm:max-w-sm">
                <label
                  htmlFor="connectivity-gateway"
                  className="block font-medium"
                >
                  Edge gateway
                </label>
                <select
                  id="connectivity-gateway"
                  className="workspace-control w-full"
                  value={gatewayId}
                  disabled={busy || !!editing}
                  onChange={(e) =>
                    localDraft
                      ? setDiscardForGateway(e.target.value)
                      : selectGateway(e.target.value)
                  }
                >
                  {gateways.data?.map((entry) => (
                    <option
                      key={entry.gatewayDeviceId}
                      value={entry.gatewayDeviceId}
                    >
                      {entry.name} · {entry.gatewayDeviceId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                {canConfigure && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!localDraft || busy || changedElsewhere}
                      onClick={() => localDraft && save.mutate(localDraft)}
                    >
                      <Save className="mr-1.5 size-4" />
                      {save.isPending ? "Saving…" : "Save configuration"}
                    </Button>
                    <Button
                      disabled={
                        !!localDraft ||
                        busy ||
                        deliveryPending ||
                        !data?.revision
                      }
                      onClick={() =>
                        publish.mutate({
                          gatewayDeviceId: gatewayId,
                          expectedRevision: data!.revision,
                        })
                      }
                    >
                      <Send className="mr-1.5 size-4" />
                      {publish.isPending ? "Sending…" : "Apply to gateway"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {data && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                <span>
                  Saved revision{" "}
                  <strong className="ml-1 font-semibold text-foreground">
                    {data.revision || "None"}
                  </strong>
                </span>
                <span>
                  Sent revision{" "}
                  <strong className="ml-1 font-semibold text-foreground">
                    {data.publishedRevision ?? "None"}
                  </strong>
                </span>
                <span>
                  Gateway applied revision{" "}
                  <strong className="ml-1 font-semibold text-foreground">
                    {data.reportedRevision ?? "Unknown"}
                  </strong>
                </span>
                {localDraft && (
                  <span className="font-medium text-foreground">
                    Unsaved draft
                  </span>
                )}
                {data.lastReceivedAt && (
                  <span className="inline-flex items-center gap-1.5">
                    Last receipt <SampleTime value={data.lastReceivedAt} />
                  </span>
                )}
              </div>
            )}
            {data?.synthetic && (
              <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
                Simulated connection examples. Configuration changes and
                physical gateway tests are unavailable in this walkthrough.
              </p>
            )}
            {data?.publication && (
              <p
                role="status"
                className="rounded-lg border border-warning/35 bg-warning/5 p-3 text-sm"
              >
                {data.publication.status === "pending"
                  ? `Delivery of revision ${data.publication.revision} is pending.`
                  : `Delivery of revision ${data.publication.revision} is unconfirmed. A gateway acknowledgement may still arrive.`}
                <span className="mt-1 block text-xs text-muted-foreground">
                  Started <SampleTime value={data.publication.startedAt} />.
                  Published observations retain their existing mappings while
                  delivery is unresolved.
                </span>
              </p>
            )}
            {data && !data.synthetic && !canConfigure && (
              <p className="text-xs text-muted-foreground">
                Read-only view. An engineer can configure connections and apply
                them to a gateway.
              </p>
            )}
            {changedElsewhere && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
              >
                <p>
                  A newer configuration was saved. Your draft is preserved;
                  reload the saved version before making further changes.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDiscardForGateway(gatewayId)}
                >
                  Reload saved configuration
                </Button>
              </div>
            )}
            {(error ||
              (data?.lastError &&
                data.lastError !== "delivery_unconfirmed")) && (
              <p
                role="alert"
                className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
              >
                {error || deliveryMessage(data?.lastError ?? "")}
              </p>
            )}
          </section>
          {query.isPending ? (
            <EmptyState title="Loading connection configuration…" />
          ) : query.isError ? (
            <EmptyState
              error
              title="Connection configuration unavailable"
              description={query.error.message}
              action={
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  Connections{" "}
                  <span className="font-normal text-muted-foreground">
                    · {connections.length}/16
                  </span>
                </h2>
                {canConfigure && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      connections.length >= 16 || busy || changedElsewhere
                    }
                    onClick={() =>
                      setEditing({
                        key: crypto.randomUUID(),
                        index: null,
                        connection: newConnection(displayConnections),
                      })
                    }
                  >
                    <Plus className="mr-1.5 size-4" />
                    Add connection
                  </Button>
                )}
              </div>
              {publishedOnly.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {publishedOnly.length} connection
                  {publishedOnly.length === 1 ? " is" : "s are"} still published
                  but removed from the desired configuration. Acquisition
                  changes after the revised configuration is applied.
                </p>
              )}
              {!displayConnections.length ? (
                <EmptyState
                  title="No equipment connections configured"
                  description={`Choose a protocol and enter the device address reachable from ${gateway?.name ?? "this gateway"}. You can test and discover OPC UA tags before applying a configuration.`}
                />
              ) : (
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
                  <nav
                    className="min-w-0 space-y-2"
                    aria-label="Equipment connections"
                  >
                    {displayConnections.map((connection) => {
                      const report = observations.find(
                        (entry) =>
                          entry.connectionId === connection.connectionId,
                      );
                      return (
                        <button
                          key={connection.connectionId}
                          type="button"
                          aria-current={
                            selected?.connectionId === connection.connectionId
                              ? "true"
                              : undefined
                          }
                          onClick={() => {
                            setSelectedId(connection.connectionId);
                            setHistoryTag("");
                          }}
                          className={`block w-full min-w-0 rounded-xl border p-4 text-left transition-colors ${selected?.connectionId === connection.connectionId ? "border-primary/60 bg-primary/5" : "bg-card hover:bg-muted/40"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Cable className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 break-words text-sm font-semibold">
                              {connection.name}
                            </span>
                          </div>
                          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                            {connection.connectionId}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {protocolLabel(connection.protocol)} ·{" "}
                            {connection.tags.length} tags
                          </p>
                          <div className="mt-3">
                            <ReportState
                              report={report}
                              intervalMs={
                                activeConnections.find(
                                  (active) =>
                                    active.connectionId ===
                                    connection.connectionId,
                                )?.intervalMs ?? connection.intervalMs
                              }
                            />
                          </div>
                          {!connection.enabled && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Acquisition configured off
                            </p>
                          )}
                          {connection.mode === "simulated" && (
                            <Badge
                              variant="outline"
                              className="mt-2 font-normal"
                            >
                              Simulated source
                            </Badge>
                          )}
                          {!connections.some(
                            (desired) =>
                              desired.connectionId === connection.connectionId,
                          ) && (
                            <Badge
                              variant="outline"
                              className="mt-2 font-normal"
                            >
                              Published only
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </nav>
                  {selected && (
                    <div className="min-w-0 space-y-4">
                      <section
                        className="min-w-0 rounded-xl border bg-card p-4"
                        aria-label="Selected connection"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="break-words font-semibold">
                              {selected.name}
                            </h3>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {selected.endpoint}
                            </p>
                          </div>
                          {canConfigure && selectedDesired && (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy || changedElsewhere}
                                onClick={() =>
                                  setEditing({
                                    key: crypto.randomUUID(),
                                    index: connections.indexOf(selected),
                                    connection: selected,
                                  })
                                }
                              >
                                <Pencil className="mr-1.5 size-3.5" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${selected.name}`}
                                disabled={busy || changedElsewhere}
                                onClick={() => setRemove(selected.connectionId)}
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </div>
                        {canConfigure && !selectedDesired && selectedActive && (
                          <Button
                            className="mt-3"
                            size="sm"
                            variant="outline"
                            disabled={
                              busy ||
                              changedElsewhere ||
                              connections.length >= 16
                            }
                            onClick={() =>
                              setConnections([
                                ...connections,
                                structuredClone(selectedActive),
                              ])
                            }
                          >
                            Restore to desired configuration
                          </Button>
                        )}
                        {desiredDiffers && (
                          <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                            {selectedActive
                              ? `Desired settings differ from published revision ${activeConfiguration?.revision}. Observations below retain the published tag mappings.`
                              : "This connection has not been published. Save and apply its configuration to begin acquisition."}
                          </p>
                        )}
                        {desiredDiffers && selectedDesired && (
                          <details className="mt-3 rounded-lg border p-3 text-xs">
                            <summary className="cursor-pointer font-medium">
                              Review desired tag mappings ·{" "}
                              {selectedDesired.tags.length}
                            </summary>
                            {selectedDesired.tags.length ? (
                              <ul className="mt-3 space-y-3">
                                {selectedDesired.tags.map((tag) => (
                                  <li
                                    key={tag.tagId}
                                    className="min-w-0 space-y-1"
                                  >
                                    <p className="font-medium">{tag.name}</p>
                                    <p className="break-all text-muted-foreground">
                                      {tag.tagId} · {tag.dataType}
                                      {tag.unit ? ` · ${tag.unit}` : ""}
                                    </p>
                                    <p className="break-all text-muted-foreground">
                                      {tagAddress(selectedDesired, tag.source)}
                                    </p>
                                    {tag.assetId && (
                                      <p className="break-all text-muted-foreground">
                                        {tag.assetId}
                                        {tag.property
                                          ? ` · ${tag.property}`
                                          : ""}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-2 text-muted-foreground">
                                No desired tags configured.
                              </p>
                            )}
                          </details>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                          <ReportState
                            report={latest}
                            intervalMs={
                              selectedActive?.intervalMs ?? selected.intervalMs
                            }
                          />
                          <span>
                            {(
                              selectedActive?.intervalMs ?? selected.intervalMs
                            ).toLocaleString()}{" "}
                            ms acquisition interval
                          </span>
                          <span>Read access</span>
                          {(selectedActive ?? selected).mode ===
                            "simulated" && (
                            <Badge variant="outline" className="font-normal">
                              Simulated source
                            </Badge>
                          )}
                          {latest && (
                            <span className="inline-flex items-center gap-1.5">
                              Report <SampleTime value={latest.observedAt} />
                            </span>
                          )}
                        </div>
                        {latest?.errorCode && (
                          <p
                            role="status"
                            className="mt-3 break-all text-xs text-muted-foreground"
                          >
                            Gateway diagnostic: {latest.errorCode}
                          </p>
                        )}
                      </section>
                      <section
                        className="min-w-0 rounded-xl border bg-card"
                        aria-labelledby="connectivity-tag-values"
                      >
                        <div className="border-b px-4 py-3">
                          <h3
                            id="connectivity-tag-values"
                            className="text-sm font-semibold"
                          >
                            Tag observations
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Latest reported values retain their quality, source
                            time and configuration revision.
                          </p>
                          {selectedActive && (
                            <p className="mt-2 break-all text-xs text-muted-foreground">
                              Published revision {activeConfiguration?.revision}{" "}
                              · {selectedActive.endpoint}
                              <span className="mt-1 block">
                                {data?.reportedRevision ===
                                activeConfiguration?.revision
                                  ? `Gateway reported revision ${data?.reportedRevision} applied.`
                                  : "Waiting for the gateway to acknowledge this published revision."}
                              </span>
                            </p>
                          )}
                        </div>
                        {selectedActive?.tags.length ? (
                          <div
                            className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            tabIndex={0}
                            aria-label="Tag values and timestamps"
                          >
                            <table className="min-w-[640px] w-full text-left text-sm">
                              <thead className="bg-muted/40 text-xs text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-3 font-medium">Tag</th>
                                  <th className="px-4 py-3 font-medium">
                                    Value
                                  </th>
                                  <th className="px-4 py-3 font-medium">
                                    Quality
                                  </th>
                                  <th className="px-4 py-3 font-medium">
                                    Source time
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {selectedActive.tags.map((tag) => {
                                  const observation = latestTags.get(tag.tagId);
                                  const historical =
                                    !!observation &&
                                    (observation.configurationRevision !==
                                      activeConfiguration?.revision ||
                                      Date.now() -
                                        Date.parse(observation.observedAt) >
                                        Math.max(
                                          60000,
                                          selectedActive.intervalMs * 3,
                                        ));
                                  return (
                                    <tr key={tag.tagId}>
                                      <td className="max-w-[240px] px-4 py-3 align-top">
                                        <button
                                          className="break-words text-left font-medium hover:underline"
                                          onClick={() =>
                                            setHistoryTag(
                                              historyTag === tag.tagId
                                                ? ""
                                                : tag.tagId,
                                            )
                                          }
                                          aria-expanded={
                                            historyTag === tag.tagId
                                          }
                                        >
                                          {tag.name}
                                        </button>
                                        <div className="mt-1 break-all text-xs text-muted-foreground">
                                          {tag.tagId} · {tag.dataType}
                                        </div>
                                        <details className="mt-1 text-xs text-muted-foreground">
                                          <summary className="cursor-pointer">
                                            Source & binding
                                          </summary>
                                          <p className="mt-1 break-all">
                                            {tagAddress(
                                              selectedActive,
                                              tag.source,
                                            )}
                                          </p>
                                          <p className="mt-1 break-all">
                                            {tag.assetId
                                              ? `${data?.assets.find((asset) => asset.assetId === tag.assetId)?.name ?? tag.assetId}${tag.property ? ` · ${tag.property}` : ""}`
                                              : "Unassigned signal"}
                                          </p>
                                        </details>
                                      </td>
                                      <td className="max-w-[220px] break-words px-4 py-3 align-top font-medium tabular-nums">
                                        {formattedValue(observation)}
                                        {observation?.value !== null &&
                                          observation?.value !== undefined &&
                                          observation.unit && (
                                            <span className="text-xs font-normal text-muted-foreground">
                                              {" "}
                                              {observation.unit}
                                            </span>
                                          )}
                                        {observation &&
                                          observation.configurationRevision !==
                                            activeConfiguration?.revision && (
                                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                              Revision{" "}
                                              {
                                                observation.configurationRevision
                                              }
                                            </span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3 align-top">
                                        <Badge
                                          variant="outline"
                                          className="font-normal"
                                        >
                                          {observation?.quality ??
                                            "No observation"}
                                        </Badge>
                                        {historical && (
                                          <p className="mt-1 text-[11px] text-muted-foreground">
                                            Historical observation
                                          </p>
                                        )}
                                        {observation?.qualityBasis && (
                                          <p className="mt-1 text-[11px] text-muted-foreground">
                                            {observation.qualityBasis.replaceAll(
                                              "_",
                                              " ",
                                            )}
                                          </p>
                                        )}
                                        {observation?.nativeStatus && (
                                          <p className="mt-1 max-w-40 break-all text-[11px] text-muted-foreground">
                                            {observation.nativeStatus}
                                          </p>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                                        {observation?.sourceTimestamp ? (
                                          <SampleTime
                                            value={observation.sourceTimestamp}
                                          />
                                        ) : (
                                          "Not supplied"
                                        )}
                                        {observation && (
                                          <p className="mt-1">
                                            Observed{" "}
                                            <SampleTime
                                              value={observation.observedAt}
                                              historical={historical}
                                            />
                                          </p>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                            <Unplug className="size-5" />
                            {selectedActive
                              ? "No tags are configured in the published connection."
                              : "No published tag mappings for this connection yet."}
                          </div>
                        )}
                      </section>
                      {historyTag && (
                        <section
                          className="min-w-0 rounded-xl border bg-card p-4"
                          aria-label="Tag history"
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold">
                              Recent observations ·{" "}
                              {
                                selectedActive?.tags.find(
                                  (tag) => tag.tagId === historyTag,
                                )?.name
                              }
                            </h3>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setHistoryTag("")}
                            >
                              Close
                            </Button>
                          </div>
                          {history.isPending ? (
                            <p className="text-sm text-muted-foreground">
                              Loading recent observations…
                            </p>
                          ) : history.isError ? (
                            <p role="alert" className="text-sm">
                              {history.error.message}
                            </p>
                          ) : (
                            <HistoryRows rows={history.data ?? []} />
                          )}
                        </section>
                      )}
                      <ConnectivityEvidence
                        fx={fx}
                        tsn={tsn}
                        gatewayDeviceId={gatewayId}
                      />
                      {(selected.fx || selected.tsn) && !fx && !tsn && (
                        <div className="flex items-start gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                          <Clock3 className="mt-0.5 size-4 shrink-0" />
                          <p>
                            Waiting for FX or TSN evidence from this gateway.
                            Configuration alone does not establish model
                            compatibility, clock synchronization or
                            deterministic timing.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {editing && (
        <ConnectionEditor
          key={editing.key}
          initial={editing.connection}
          assets={data?.assets ?? []}
          open
          onClose={() => setEditing(null)}
          probeResult={data?.probe?.result}
          probeStatus={data?.probe}
          onProbe={async (connection) => {
            if (!canConfigure || changedElsewhere)
              throw Error(
                "Reload the configuration before testing a connection.",
              );
            const response = await probe.mutateAsync({
              gatewayDeviceId: gatewayId,
              expectedRevision: data?.revision ?? 0,
              connection,
            });
            if (
              !response.published &&
              response.reason === "provisioner_not_configured"
            )
              throw Error(deliveryMessage(response.reason));
            await utils.connectivity.get.invalidate({
              gatewayDeviceId: gatewayId,
            });
            return { commandId: response.commandId };
          }}
          onSave={(connection) => {
            if (
              connections.some(
                (entry, index) =>
                  entry.connectionId === connection.connectionId &&
                  index !== editing.index,
              )
            ) {
              toast.error(
                "Choose a connection ID that is unique on this gateway.",
              );
              return;
            }
            setConnections(
              editing.index === null
                ? [...connections, connection]
                : connections.map((entry, index) =>
                    index === editing.index ? connection : entry,
                  ),
            );
            setSelectedId(connection.connectionId);
            setHistoryTag("");
            setEditing(null);
          }}
        />
      )}

      <AlertDialog
        open={remove !== null}
        onOpenChange={(open) => !open && setRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this connection?</AlertDialogTitle>
            <AlertDialogDescription>
              The connection will be removed from your draft. Acquisition
              changes after you save and apply the revised configuration.
              Equipment and asset records remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConnections(
                  connections.filter((entry) => entry.connectionId !== remove),
                );
                setRemove(null);
                setHistoryTag("");
              }}
            >
              Remove from draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={discardForGateway !== null}
        onOpenChange={(open) => !open && setDiscardForGateway(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard the unsaved connection draft?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your saved gateway configuration is unchanged. Discarding removes
              only the edits currently held in this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = discardForGateway!;
                setDiscardForGateway(null);
                selectGateway(next);
              }}
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HistoryRows({
  rows,
}: {
  rows: Array<
    ConnectivityObservation["tags"][number] & {
      eventId: string;
      observedAt: string;
      configurationRevision: number;
      currentEligible: boolean;
    }
  >;
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No retained observations for this tag yet.
      </p>
    );
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            <th className="pb-2 font-medium">Observed</th>
            <th className="pb-2 font-medium">Value</th>
            <th className="pb-2 font-medium">Quality</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((entry) => {
            return (
              <tr key={entry.eventId}>
                <td className="py-2 pr-3">
                  <SampleTime value={entry.observedAt} />
                  <span className="mt-1 block text-muted-foreground">
                    Revision {entry.configurationRevision}
                    {!entry.currentEligible ? " · Historical" : ""}
                  </span>
                </td>
                <td className="max-w-40 break-all py-2 pr-3 tabular-nums">
                  {entry.value === null ? "—" : String(entry.value)}
                  {entry.value !== null && entry.unit ? ` ${entry.unit}` : ""}
                </td>
                <td className="py-2">{entry.quality}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
