import { PageHeader } from "@/components/workspace/Primitives";
import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Clock,
  Factory,
  Layers,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { canViewEngineering } from "@/lib/access";
import { toast } from "sonner";

const statusStyles: Record<string, string> = {
  online:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  offline:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300",
  maintenance:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  error:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
};

const lifecycleStyles: Record<string, string> = {
  commissioning:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
  operation:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  maintenance:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  decommissioned:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300",
};

export default function Home() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const demoData = trpc.system.demoData.useQuery();
  const setDemoData = trpc.system.setDemoData.useMutation({
    onSuccess: async ({ enabled }) => {
      await Promise.all([
        utils.system.demoData.invalidate(),
        utils.analytics.invalidate(),
        utils.devices.invalidate(),
        utils.assets.invalidate(),
        utils.alerts.invalidate(),
        utils.notifications.invalidate(),
      ]);
      toast.success(enabled ? "Demo data enabled" : "Demo data hidden");
    },
    onError: (error) =>
      toast.error(`Demo data could not be changed: ${error.message}`),
  });
  const overview = trpc.analytics.getOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const devicesQuery = trpc.devices.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const assetsQuery = trpc.assets.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const activeAlertsQuery = trpc.alerts.list.useQuery(
    { openOnly: true, limit: 5 },
    { refetchInterval: 15_000 },
  );

  const devices = devicesQuery.data ?? [];
  const gateways = devices.filter((device) => device.type === "gateway");
  const edgeDevices = devices.filter((device) => device.type !== "gateway");
  const assets = assetsQuery.data ?? [];
  const activeAlerts = activeAlertsQuery.data ?? [];
  const onlineGateways = gateways.filter(
    (gateway) => gateway.observedStatus === "live",
  ).length;
  const onlineEdgeDevices = edgeDevices.filter(
    (device) => device.observedStatus === "live",
  ).length;
  const maintenanceAssets = assets.filter(
    (asset) => asset.lifecycleStage === "maintenance",
  ).length;
  const canControlDemoData = canViewEngineering(user?.role);
  const isLoading =
    overview.isLoading || devicesQuery.isLoading || assetsQuery.isLoading;
  const hasError =
    overview.isError ||
    devicesQuery.isError ||
    assetsQuery.isError ||
    activeAlertsQuery.isError;

  const gatewayStatus = useMemo(
    () => [
      {
        label: "Online",
        value: gateways.filter((gateway) => gateway.observedStatus === "live")
          .length,
        icon: Wifi,
      },
      {
        label: "Offline",
        value: gateways.filter(
          (gateway) => gateway.observedStatus === "offline",
        ).length,
        icon: WifiOff,
      },
      {
        label: "Stale",
        value: gateways.filter((d) => d.observedStatus === "stale").length,
        icon: Clock,
      },
      {
        label: "Unknown",
        value: gateways.filter((d) => d.observedStatus === "unknown").length,
        icon: WifiOff,
      },
      {
        label: "Maintenance",
        value: gateways.filter((gateway) => gateway.status === "maintenance")
          .length,
        icon: Activity,
      },
      {
        label: "Error",
        value: gateways.filter((gateway) => gateway.status === "error").length,
        icon: AlertTriangle,
      },
    ],
    [gateways],
  );

  const edgeDeviceStatus = useMemo(
    () => [
      {
        label: "Online",
        value: edgeDevices.filter((device) => device.observedStatus === "live")
          .length,
        icon: Wifi,
      },
      {
        label: "Offline",
        value: edgeDevices.filter(
          (device) => device.observedStatus === "offline",
        ).length,
        icon: WifiOff,
      },
      {
        label: "Stale",
        value: edgeDevices.filter((d) => d.observedStatus === "stale").length,
        icon: Clock,
      },
      {
        label: "Unknown",
        value: edgeDevices.filter((d) => d.observedStatus === "unknown").length,
        icon: WifiOff,
      },
      {
        label: "Maintenance",
        value: edgeDevices.filter((device) => device.status === "maintenance")
          .length,
        icon: Activity,
      },
      {
        label: "Error",
        value: edgeDevices.filter((device) => device.status === "error").length,
        icon: AlertTriangle,
      },
    ],
    [edgeDevices],
  );

  const refresh = async () => {
    await Promise.all([
      overview.refetch(),
      devicesQuery.refetch(),
      assetsQuery.refetch(),
      activeAlertsQuery.refetch(),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary/10 p-3 text-primary">
            <Factory className="h-6 w-6" />
          </span>
          <div>
            <PageHeader
              title="Overview"
              description="Asset status, connectivity, open incidents and confirmed downtime."
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border bg-background/70 px-3 py-2 text-sm">
            <Switch
              aria-label="Show demo data"
              checked={demoData.data?.enabled ?? false}
              disabled={
                !canControlDemoData ||
                demoData.isLoading ||
                setDemoData.isPending
              }
              onCheckedChange={(enabled) => setDemoData.mutate({ enabled })}
            />
            <span>Demo data</span>
            {!canControlDemoData && (
              <span className="sr-only">Engineer access required</span>
            )}
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh data
          </Button>
        </div>
      </div>

      {hasError && (
        <Card role="alert" className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">
            Some dashboard data could not be loaded. Refresh the page or check
            the API connection.
          </CardContent>
        </Card>
      )}
      {assets.length > 0 && assets.every((asset) => asset.isDemo) && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          This is API-provided simulated asset and telemetry data. Replace it
          with registered equipment when ready.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard
          accent="indigo"
          title="Industrial assets"
          value={isLoading ? "…" : assets.length}
          detail="AAS-backed equipment records"
          icon={<Factory className="h-5 w-5" />}
          onClick={() => setLocation("/inventory?view=assets")}
        />
        <SummaryCard
          accent="emerald"
          title="Online gateways"
          value={isLoading ? "…" : `${onlineGateways} / ${gateways.length}`}
          detail="Edge gateways"
          icon={<Wifi className="h-5 w-5" />}
          onClick={() => setLocation("/inventory?view=devices")}
        />
        <SummaryCard
          accent="emerald"
          title="Online edge devices"
          value={
            isLoading ? "…" : `${onlineEdgeDevices} / ${edgeDevices.length}`
          }
          detail="Connected edge devices"
          icon={<Wifi className="h-5 w-5" />}
          onClick={() => setLocation("/inventory?view=devices")}
        />
        <SummaryCard
          accent="rose"
          title="Open incidents"
          value={overview.data?.alerts.open ?? "—"}
          detail={`${overview.data?.alerts.critical ?? 0} critical · ${overview.data?.alerts.warning ?? 0} warning`}
          icon={<Bell className="h-5 w-5" />}
          onClick={() => setLocation("/alerts")}
        />
        <SummaryCard
          accent="rose"
          title="Active downtime"
          value={overview.data?.alerts.activeDowntime ?? "—"}
          detail={`${
            overview.data?.alerts.longestActiveDowntimeSeconds == null
              ? "No active outage"
              : `Longest ${formatDuration(overview.data.alerts.longestActiveDowntimeSeconds)}`
          } · Mean resolution ${overview.data?.alerts.averageDowntimeToResolutionSeconds == null ? "no history" : formatDuration(overview.data.alerts.averageDowntimeToResolutionSeconds)}`}
          icon={<Clock className="h-5 w-5" />}
          onClick={() => setLocation("/alerts")}
        />
        <SummaryCard
          accent="amber"
          title="In maintenance"
          value={isLoading ? "…" : maintenanceAssets}
          detail="Assets in maintenance lifecycle stage"
          icon={<Activity className="h-5 w-5" />}
          onClick={() => setLocation("/inventory?view=assets")}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-6">
        <ConnectivityCard
          title="Gateway connectivity"
          records={gateways}
          emptyText="No gateway records yet. Register an edge gateway under Devices."
          action="Open gateways"
          statuses={gatewayStatus}
          onOpen={() => setLocation("/inventory?view=devices")}
        />
        <ConnectivityCard
          title="Edge device connectivity"
          records={edgeDevices}
          emptyText="No edge device records yet. Register an edge device under Devices."
          action="Open edge devices"
          statuses={edgeDeviceStatus}
          onOpen={() => setLocation("/inventory?view=devices")}
        />

        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Open incidents</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/alerts")}
            >
              View queue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {activeAlertsQuery.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading alerts…
              </p>
            ) : activeAlerts.length === 0 ? (
              <EmptyState text="No open incidents require attention." />
            ) : (
              <div className="space-y-3">
                {activeAlerts.map((alert) => {
                  const source = [...gateways, ...edgeDevices].find(
                    (device) => device.id === alert.deviceId,
                  );
                  return (
                    <button
                      key={alert.id}
                      className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40"
                      onClick={() => setLocation("/alerts")}
                    >
                      <AlertTriangle
                        className={`mt-0.5 h-4 w-4 shrink-0 ${alert.severity === "critical" ? "text-destructive" : alert.severity === "warning" ? "text-warning" : "text-primary"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {alert.message}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {source?.name ??
                            `Connectivity source ${alert.deviceId}`}{" "}
                          · {new Date(alert.createdAt).toLocaleString()}
                        </span>
                      </span>
                      <Badge
                        variant="outline"
                        className={`capitalize ${alert.severity === "critical" ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300" : alert.severity === "warning" ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300" : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"}`}
                      >
                        {alert.severity}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Asset portfolio</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/inventory?view=assets")}
          >
            All assets
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <EmptyState
              text="No industrial assets are registered. Create an AAS for each machine or import its vendor package."
              action={
                canViewEngineering(user?.role) ? "Create an asset" : undefined
              }
              onClick={
                canViewEngineering(user?.role)
                  ? () => setLocation("/inventory?view=assets")
                  : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Industrial asset portfolio
                </caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Zone / location</th>
                    <th className="py-2 pr-4">Lifecycle</th>
                    <th className="py-2">AAS revision</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.slice(0, 6).map((asset) => {
                    const destination = canViewEngineering(user?.role)
                      ? `/assets/${asset.id}/aas`
                      : "/assets";
                    return (
                      <tr
                        key={asset.id}
                        aria-label={`Open ${asset.name}`}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        role="link"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setLocation(destination);
                          }
                        }}
                        onClick={() => setLocation(destination)}
                      >
                        <td className="py-3 pr-4">
                          <span className="font-medium">{asset.name}</span>
                          {asset.isDemo && (
                            <Badge
                              variant="outline"
                              className="ml-2 border-violet-200 bg-violet-50 text-[10px] text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300"
                            >
                              Demo
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 pr-4 capitalize">
                          {asset.assetType}
                        </td>
                        <td className="py-3 pr-4">
                          {asset.zone ?? "—"} · {asset.location ?? "—"}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={`capitalize ${lifecycleStyles[asset.lifecycleStage.toLowerCase()] ?? "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300"}`}
                          >
                            {asset.lifecycleStage}
                          </Badge>
                        </td>
                        <td className="py-3">v{asset.aasVersion}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink
          title="Live monitoring"
          detail="Inspect current gateway readings"
          tone="cyan"
          icon={<Activity className="h-4 w-4" />}
          onClick={() => setLocation("/monitoring")}
        />
        <QuickLink
          title="Asset engineering"
          detail="Create, import, and manage AAS"
          tone="violet"
          icon={<Layers className="h-4 w-4" />}
          onClick={() => setLocation("/inventory?view=assets")}
        />
        <QuickLink
          title="Asset analytics"
          detail="Compare telemetry by asset group"
          tone="amber"
          icon={<Factory className="h-4 w-4" />}
          onClick={() => setLocation("/analytics")}
        />
      </div>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function SummaryCard({
  accent,
  title,
  value,
  detail,
  icon,
  onClick,
}: {
  accent: "indigo" | "emerald" | "rose" | "amber";
  title: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const accentStyles = {
    indigo: "border-t-border bg-card",
    emerald: "border-t-border bg-card",
    rose: "border-t-border bg-card",
    amber: "border-t-border bg-card",
  }[accent];
  const iconStyles = {
    indigo: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  }[accent];
  return (
    <Card className={`border-t-2 ${accentStyles}`}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <button
          aria-label={`Open ${title}`}
          className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClick}
        >
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </button>
        <span aria-hidden="true" className={`rounded-md p-2 ${iconStyles}`}>
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

function ConnectivityCard({
  title,
  records,
  emptyText,
  action,
  statuses,
  onOpen,
}: {
  title: string;
  records: unknown[];
  emptyText: string;
  action: string;
  statuses: Array<{
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
  }>;
  onOpen: () => void;
}) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <EmptyState text={emptyText} action={action} onClick={onOpen} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {statuses.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className={`rounded-lg border p-4 ${statusStyles[label.toLowerCase()] ?? ""}`}
              >
                <div className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-2 text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  text,
  action,
  onClick,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
      <p>{text}</p>
      {action && onClick && (
        <Button variant="outline" size="sm" onClick={onClick}>
          {action}
        </Button>
      )}
    </div>
  );
}

function QuickLink({
  title,
  detail,
  tone,
  icon,
  onClick,
}: {
  title: string;
  detail: string;
  tone: "cyan" | "violet" | "amber";
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const toneStyles = {
    cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300",
    violet:
      "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
    amber:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  }[tone];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className={`rounded-md p-2 ${toneStyles}`}>
        {icon}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
