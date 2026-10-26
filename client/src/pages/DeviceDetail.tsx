import SecuritySummary from "@/components/SecuritySummary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Thermometer,
  Droplets,
  Activity,
  Zap,
  Lightbulb,
  MousePointerClick,
  CalendarIcon,
  RefreshCw,
  Settings,
  Layers,
  Cpu,
  ChevronRight,
  CircleCheck,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import ThresholdConfigDialog from "@/components/ThresholdConfigDialog";
import { ExportButton } from "@/components/ExportButton";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canViewEngineering, hasMinimumRole } from "@/lib/access";
import { getConnectivityRecordId } from "@/lib/device-display";

type DeviceStatus = "online" | "offline" | "maintenance" | "error";

const statusColors: Record<DeviceStatus, string> = {
  online: "bg-success text-success-foreground",
  offline: "bg-muted text-muted-foreground",
  maintenance: "bg-warning text-warning-foreground",
  error: "bg-destructive text-destructive-foreground",
};

const metricColors = {
  temperature: "var(--series-temperature)",
  humidity: "var(--series-humidity)",
  vibration: "var(--series-vibration)",
  power: "var(--series-power)",
  rpm: "var(--series-rpm)",
  pressure: "var(--series-pressure)",
};

const metricUnits: Record<keyof typeof metricColors, string> = {
  temperature: "°C",
  humidity: "% RH",
  vibration: "mm/s",
  power: "W",
  rpm: "rpm",
  pressure: "asset unit",
};

const metricAxisPadding: Record<keyof typeof metricColors, number> = {
  temperature: 0.5,
  humidity: 1,
  vibration: 0.1,
  power: 10,
  rpm: 10,
  pressure: 0.1,
};

type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

function telemetrySampleDate(timestamp: number | null | undefined) {
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function telemetryFreshness(timestamp: number) {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "Updated just now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `Updated ${elapsedHours} hr${elapsedHours === 1 ? "" : "s"} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Updated ${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

export default function DeviceDetail({
  itemId,
  section = "overview",
  embedded = false,
}: { itemId?: number; section?: string; embedded?: boolean } = {}) {
  const params = useParams<{ id: string }>();
  const deviceId = itemId ?? parseInt(params.id ?? "0");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({ from: undefined, to: undefined });
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    "temperature",
    "humidity",
    "power",
  ]);
  const [thresholdDialogOpen, setThresholdDialogOpen] = useState(false);

  const { startTime, endTime } = useMemo(() => {
    const now = Date.now();
    if (timeRange === "custom" && customDateRange.from && customDateRange.to) {
      return {
        startTime: customDateRange.from.getTime(),
        endTime: customDateRange.to.getTime(),
      };
    }
    const ranges: Record<TimeRange, number> = {
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      custom: 24 * 60 * 60 * 1000,
    };
    return { startTime: now - ranges[timeRange], endTime: now };
  }, [timeRange, customDateRange]);

  const {
    data: device,
    isLoading: deviceLoading,
    isError: deviceError,
    refetch: refetchDevice,
  } = trpc.devices.getById.useQuery(
    {
      id: deviceId,
    },
    { refetchInterval: 10000 },
  );
  const { data: linkedAssets = [] } = trpc.assets.getAllForDevice.useQuery(
    { devicePk: deviceId },
    { enabled: !!device && (!embedded || section === "connectivity") },
  );

  const asset = linkedAssets[0]; // Compatibility only for existing export title. Relationship UI lists every link.
  const {
    data: readings,
    isLoading: readingsLoading,
    isError: readingsError,
    refetch,
  } = trpc.readings.getForDevice.useQuery(
    { deviceId, startTime, endTime },
    { enabled: !!device && (!embedded || section === "telemetry") },
  );

  const { data: thresholds } = trpc.thresholds.getForDevice.useQuery(
    { deviceId },
    {
      enabled:
        !!device &&
        canViewEngineering(user?.role) &&
        (!embedded || section === "thresholds"),
    },
  );

  const isWrover = device?.deviceId === "esp32-wrover-01";
  const { data: latestReading } = trpc.readings.getLatest.useQuery(
    { deviceId },
    {
      enabled:
        !!device &&
        (!embedded || ["telemetry", "diagnostics"].includes(section)),
      refetchInterval: isWrover ? 1000 : 10000,
    },
  );
  const {
    data: connectedDevices = [],
    isLoading: connectedDevicesLoading,
    isError: connectedDevicesError,
    refetch: refetchConnectedDevices,
  } = trpc.devices.getConnectedDevices.useQuery(
    { id: deviceId },
    {
      enabled:
        device?.type === "gateway" && (!embedded || section === "connected"),
      refetchInterval: 10000,
    },
  );
  const {
    data: connectedAssets = [],
    isLoading: connectedAssetsLoading,
    isError: connectedAssetsError,
    refetch: refetchConnectedAssets,
  } = trpc.devices.getConnectedAssets.useQuery(
    { id: deviceId },
    {
      enabled:
        device?.type === "gateway" && (!embedded || section === "connected"),
      refetchInterval: 10000,
    },
  );
  const pulseIndicator = trpc.devices.pulseIndicator.useMutation({
    onSuccess: () =>
      toast.success("LED command published", {
        description:
          "GPIO18 will light for up to two seconds. Broker acceptance is not physical-state feedback.",
      }),
    onError: (error) =>
      toast.error("LED command failed", { description: error.message }),
  });
  const signals = latestReading?.assetSignals as
    | Record<string, number>
    | null
    | undefined;
  const buttonPressed = signals?.buttonPressed === 1;
  const buttonPressCount = signals?.buttonPressCount;
  const [recentButtonPress, setRecentButtonPress] = useState(false);
  const observedButtonPressCount = useRef<number | null>(null);
  useEffect(() => {
    if (typeof buttonPressCount !== "number") return;
    const previous = observedButtonPressCount.current;
    observedButtonPressCount.current = buttonPressCount;
    if (previous === null || buttonPressCount <= previous) return;
    setRecentButtonPress(true);
    const releaseIndicator = window.setTimeout(
      () => setRecentButtonPress(false),
      1500,
    );
    return () => window.clearTimeout(releaseIndicator);
  }, [buttonPressCount]);
  const displayedButtonPressed = buttonPressed || recentButtonPress;
  const wroverGatewayId =
    typeof device?.metadata?.gatewayId === "string"
      ? device.metadata.gatewayId
      : null;
  const wroverSensorReadError = device?.metadata?.sensorStatus === "read_error";
  const latestSampleAt = telemetrySampleDate(latestReading?.timestamp);
  const wroverSampleFresh =
    latestSampleAt !== null && Date.now() - latestSampleAt.getTime() <= 120_000;
  const wroverHealth = !isWrover
    ? null
    : device?.status !== "online" || !wroverSampleFresh
      ? "offline"
      : wroverSensorReadError || !wroverGatewayId
        ? "degraded"
        : "healthy";

  const chartData = useMemo(() => {
    if (!readings) return [];
    return readings.map((r) => ({
      timestamp: r.timestamp,
      time: format(new Date(r.timestamp), "HH:mm"),
      date: format(new Date(r.timestamp), "MMM dd"),
      temperature: r.temperature,
      humidity: r.humidity,
      vibration: r.vibration,
      power: r.power,
      rpm: r.rpm,
      pressure: r.pressure,
    }));
  }, [readings]);

  const toggleMetric = (metric: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric)
        ? prev.filter((m) => m !== metric)
        : [...prev, metric],
    );
  };

  const exportMutation = trpc.export.deviceReport.useMutation();

  const handleExport = async () => {
    const result = await exportMutation.mutateAsync({
      deviceId,
      startTime,
      endTime,
    });
    return result;
  };

  if (deviceLoading) {
    return (
      <div
        className="flex items-center justify-center gap-3 h-64"
        role="status"
      >
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading device details…</span>
      </div>
    );
  }

  if (deviceError) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 h-64 text-center"
        role="alert"
      >
        <h1 className="text-xl font-semibold">Device details unavailable</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The connectivity record could not be loaded. Check the service
          connection and try again.
        </p>
        <Button variant="outline" onClick={() => void refetchDevice()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <h1 className="text-xl font-semibold mb-2">Device not found</h1>
        <Button variant="outline" onClick={() => setLocation("/devices")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Devices
        </Button>
      </div>
    );
  }

  const status = device.status as DeviceStatus;

  return (
    <div className="space-y-6">
      {!embedded && <SecuritySummary kind="device" id={device.id} />}
      {!embedded && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <Button
                aria-label="Back to connectivity records"
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/devices")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="break-words text-2xl font-bold tracking-tight">
                    {device.name}
                  </h1>
                  <Badge className={statusColors[status]}>{status}</Badge>
                </div>
                <p className="break-words text-sm text-muted-foreground sm:text-base">
                  {getConnectivityRecordId(device)} • {device.zone ?? "No zone"}{" "}
                  • {device.location ?? "No location"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canViewEngineering(user?.role) &&
                linkedAssets.map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setLocation(`/inventory/asset:${a.id}/overview`)
                    }
                  >
                    <Layers className="mr-2 h-4 w-4" />
                    {a.name} · AAS
                  </Button>
                ))}
              {canViewEngineering(user?.role) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setThresholdDialogOpen(true)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Thresholds
                </Button>
              )}
              <ExportButton onExportHtml={handleExport} label="Export Report" />
            </div>
          </div>
        </>
      )}
      {isWrover && wroverHealth === "healthy" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              WROVER healthy
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fresh telemetry and sensor reads are arriving through gateway{" "}
              <span className="font-mono">{wroverGatewayId}</span>.{" "}
              {latestSampleAt && telemetryFreshness(latestSampleAt.getTime())}.
            </p>
          </div>
        </div>
      )}

      {isWrover && wroverHealth === "degraded" && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">WROVER health degraded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {wroverSensorReadError
                ? "The latest DHT11 read failed. Check sensor power, data wiring, and its pull-up resistor."
                : "No parent gateway is recorded for this WROVER."}
            </p>
          </div>
        </div>
      )}

      {isWrover && wroverHealth === "offline" && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">WROVER offline</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {latestSampleAt
                ? `No fresh telemetry. ${telemetryFreshness(latestSampleAt.getTime())}.`
                : "No telemetry has been received."}{" "}
              Check WROVER power, Wi-Fi, and its Pi-local MQTT connection
              {wroverGatewayId ? ` through ${wroverGatewayId}` : ""}.
            </p>
          </div>
        </div>
      )}

      {device.type === "gateway" && (!embedded || section === "connected") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Connected equipment (
              {connectedAssets.length + connectedDevices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connectedDevicesLoading || connectedAssetsLoading ? (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading connected equipment…
              </div>
            ) : connectedDevicesError || connectedAssetsError ? (
              <div
                className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
                role="alert"
              >
                <p className="font-medium">
                  Connected equipment could not be loaded
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The gateway is available, but its child devices and assigned
                  assets could not be retrieved.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void Promise.all([
                      refetchConnectedDevices(),
                      refetchConnectedAssets(),
                    ])
                  }
                >
                  Try again
                </Button>
              </div>
            ) : connectedDevices.length === 0 &&
              connectedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No AAS assets are assigned and no child devices have reported
                telemetry through this gateway.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {connectedAssets.map((connectedAsset) =>
                  (() => {
                    const connectionSeenAt = connectedAsset.lastSeen
                      ? new Date(connectedAsset.lastSeen).getTime()
                      : Number.NaN;
                    const physicallyConnected =
                      Number.isFinite(connectionSeenAt) &&
                      Date.now() - connectionSeenAt <= 120_000;
                    return (
                      <button
                        key={`asset-${connectedAsset.id}`}
                        type="button"
                        onClick={() =>
                          setLocation(`/assets/${connectedAsset.id}/aas`)
                        }
                        className="rounded-lg border border-primary/25 bg-card p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Layers className="h-4 w-4 text-primary" />
                              <Badge variant="outline">AAS asset</Badge>
                              {connectedAsset.protocol ===
                                "ada031_v4_serial" && (
                                <Badge
                                  className={
                                    physicallyConnected
                                      ? "bg-success text-success-foreground"
                                      : "bg-muted text-muted-foreground"
                                  }
                                >
                                  {physicallyConnected
                                    ? "Connected"
                                    : "Offline"}
                                </Badge>
                              )}
                            </div>
                            <p className="truncate font-semibold">
                              {connectedAsset.name}
                            </p>
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {connectedAsset.assetId}
                            </p>
                          </div>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-md bg-muted/50 p-3">
                            <p className="text-muted-foreground">Protocol</p>
                            <p className="mt-1 font-medium">
                              {connectedAsset.protocol}
                            </p>
                          </div>
                          <div className="rounded-md bg-muted/50 p-3">
                            <p className="text-muted-foreground">
                              Last telemetry
                            </p>
                            <p className="mt-1 font-medium">
                              {connectedAsset.lastSeen
                                ? new Date(
                                    connectedAsset.lastSeen,
                                  ).toLocaleString()
                                : "Not received"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })(),
                )}
                {connectedDevices.map((child) => {
                  const sampleDate = telemetrySampleDate(
                    child.latestReading?.timestamp,
                  );
                  const sensorType =
                    typeof child.metadata?.sensorType === "string" &&
                    child.metadata.sensorType.trim()
                      ? child.metadata.sensorType.trim()
                      : null;
                  const hasReadError =
                    child.metadata?.sensorStatus === "read_error";
                  return (
                    <button
                      aria-label={`Open ${child.name} details`}
                      key={child.id}
                      type="button"
                      onClick={() => setLocation(`/devices/${child.id}`)}
                      className="min-w-0 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{child.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {child.deviceId}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasReadError && (
                            <Badge variant="destructive">
                              Sensor read error
                            </Badge>
                          )}
                          <Badge
                            className={`${statusColors[child.status as DeviceStatus]} capitalize`}
                          >
                            {child.status}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-md bg-muted/50 p-3">
                          <p className="text-xs text-muted-foreground">
                            {sensorType
                              ? `${sensorType} temperature`
                              : "Temperature"}
                          </p>
                          <p className="text-xl font-bold">
                            {child.latestReading?.temperature != null
                              ? `${child.latestReading.temperature.toFixed(1)}°C`
                              : "—"}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-3">
                          <p className="text-xs text-muted-foreground">
                            {sensorType
                              ? `${sensorType} relative humidity`
                              : "Relative humidity"}
                          </p>
                          <p className="text-xl font-bold">
                            {child.latestReading?.humidity != null
                              ? `${child.latestReading.humidity.toFixed(1)}%`
                              : "—"}
                          </p>
                        </div>
                      </div>
                      {hasReadError && (
                        <p
                          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                          role="status"
                        >
                          The latest sensor read failed. Check the sensor wiring
                          and gateway log.
                        </p>
                      )}
                      {sampleDate ? (
                        <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                          <p>{telemetryFreshness(sampleDate.getTime())}</p>
                          <time
                            className="mt-0.5 block"
                            dateTime={sampleDate.toISOString()}
                          >
                            {sampleDate.toLocaleString()}
                          </time>
                        </div>
                      ) : (
                        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                          No telemetry sample received
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {device.type !== "gateway" && (!embedded || section === "telemetry") && (
        <>
          {/* Current Readings */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {isWrover && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <Lightbulb className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Indicator LED</p>
                      <p className="text-xs text-muted-foreground">
                        GPIO18 · two-second pulse
                      </p>
                    </div>
                  </div>
                  {hasMinimumRole(user?.role, "operator") && (
                    <Button
                      size="sm"
                      disabled={
                        pulseIndicator.isPending || wroverHealth !== "healthy"
                      }
                      onClick={() => pulseIndicator.mutate({ id: deviceId })}
                    >
                      {pulseIndicator.isPending ? "Sending…" : "Pulse GPIO18"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
            {isWrover && buttonPressCount !== undefined && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div
                      className={`rounded-lg p-2 transition-colors duration-150 ${displayedButtonPressed ? "bg-primary" : "bg-primary/10"}`}
                    >
                      <MousePointerClick
                        className={`h-5 w-5 transition-colors duration-150 ${displayedButtonPressed ? "text-primary-foreground" : "text-primary"}`}
                      />
                    </div>
                    <div aria-live="polite">
                      <p className="text-2xl font-bold">
                        {displayedButtonPressed ? "Pressed" : "Released"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Physical button · {buttonPressCount} press
                        {buttonPressCount === 1 ? "" : "es"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {latestReading?.temperature !== null &&
              latestReading?.temperature !== undefined && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-chart-2/10">
                        <Thermometer className="h-5 w-5 text-chart-2" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {latestReading.temperature.toFixed(1)}°C
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Temperature
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            {latestReading?.humidity !== null &&
              latestReading?.humidity !== undefined && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-chart-1/10">
                        <Droplets className="h-5 w-5 text-chart-1" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {latestReading.humidity.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Humidity
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            {latestReading?.power !== null &&
              latestReading?.power !== undefined && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-chart-5/10">
                        <Zap className="h-5 w-5 text-chart-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {latestReading.power.toFixed(0)}W
                        </p>
                        <p className="text-xs text-muted-foreground">Power</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            {latestReading?.vibration !== null &&
              latestReading?.vibration !== undefined && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-chart-4/10">
                        <Activity className="h-5 w-5 text-chart-4" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {latestReading.vibration.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Vibration (mm/s)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
          </div>

          <p className="rounded border p-3 text-xs text-muted-foreground">
            {device.isDemo
              ? "Simulated device data"
              : `Latest evidence mode: ${String(latestReading?.integration?.mode ?? "unknown")}`}{" "}
            · Historical charts include live and unclassified legacy samples;
            explicit simulation and replay remain in their separate observation
            streams. Past values do not prove current connectivity.
          </p>
          {/* Historical Data */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <CardTitle>Historical Data</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={timeRange}
                    onValueChange={(v) => setTimeRange(v as TimeRange)}
                  >
                    <SelectTrigger
                      aria-label="Telemetry time range"
                      className="w-36"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Last 1 hour</SelectItem>
                      <SelectItem value="6h">Last 6 hours</SelectItem>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="custom">Custom range</SelectItem>
                    </SelectContent>
                  </Select>

                  {timeRange === "custom" && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-auto">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {customDateRange.from && customDateRange.to
                            ? `${format(customDateRange.from, "MMM dd")} - ${format(customDateRange.to, "MMM dd")}`
                            : "Pick dates"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="range"
                          selected={{
                            from: customDateRange.from,
                            to: customDateRange.to,
                          }}
                          onSelect={(range) =>
                            setCustomDateRange({
                              from: range?.from,
                              to: range?.to,
                            })
                          }
                          numberOfMonths={1}
                        />
                      </PopoverContent>
                    </Popover>
                  )}

                  <Button
                    aria-label="Refresh telemetry"
                    variant="outline"
                    size="icon"
                    disabled={readingsLoading}
                    onClick={() => void refetch()}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${readingsLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Metric Toggles */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(metricColors).map(([metric, color]) => (
                  <Button
                    key={metric}
                    variant={
                      selectedMetrics.includes(metric) ? "default" : "outline"
                    }
                    size="sm"
                    aria-pressed={selectedMetrics.includes(metric)}
                    onClick={() => toggleMetric(metric)}
                    style={{
                      backgroundColor: selectedMetrics.includes(metric)
                        ? color
                        : undefined,
                      borderColor: color,
                    }}
                  >
                    {metric.charAt(0).toUpperCase() + metric.slice(1)}
                  </Button>
                ))}
              </div>

              {/* Chart */}
              {readingsLoading ? (
                <div
                  className="flex items-center justify-center gap-3 h-80"
                  role="status"
                >
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  <span className="sr-only">Loading telemetry history…</span>
                </div>
              ) : readingsError ? (
                <div
                  className="flex h-80 flex-col items-center justify-center gap-3 text-center"
                  role="alert"
                >
                  <p className="font-medium">
                    Telemetry history could not be loaded
                  </p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    The latest values may still be available above. Try loading
                    the historical series again.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-80 text-muted-foreground">
                  <Activity className="h-12 w-12 mb-4" />
                  <p>No data available for the selected time range</p>
                </div>
              ) : (
                <div
                  role="img"
                  aria-label={`Telemetry history chart showing ${selectedMetrics.join(", ") || "no selected metrics"}`}
                >
                  <ResponsiveContainer width="100%" height={400}>
                    <AreaChart data={chartData}>
                      <defs>
                        {Object.entries(metricColors).map(([metric, color]) => (
                          <linearGradient
                            key={metric}
                            id={`gradient-${metric}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor={color}
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor={color}
                              stopOpacity={0}
                            />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                      />
                      <XAxis
                        dataKey={
                          timeRange === "7d" || timeRange === "30d"
                            ? "date"
                            : "time"
                        }
                        stroke="var(--muted-foreground)"
                        fontSize={12}
                      />
                      {selectedMetrics.map((metric, index) => {
                        const key = metric as keyof typeof metricColors;
                        const padding = metricAxisPadding[key];
                        return (
                          <YAxis
                            key={metric}
                            yAxisId={metric}
                            orientation={index === 1 ? "right" : "left"}
                            hide={index > 1}
                            stroke={metricColors[key]}
                            fontSize={12}
                            width={64}
                            domain={[
                              (minimum: number) => minimum - padding,
                              (maximum: number) => maximum + padding,
                            ]}
                            tickFormatter={(value: number) =>
                              `${Number(value.toFixed(1))}`
                            }
                            label={
                              index < 2
                                ? {
                                    value: metricUnits[key],
                                    angle: index === 1 ? 90 : -90,
                                    position:
                                      index === 1
                                        ? "insideRight"
                                        : "insideLeft",
                                    fill: metricColors[key],
                                  }
                                : undefined
                            }
                          />
                        );
                      })}
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                        }}
                        labelStyle={{ color: "var(--foreground)" }}
                      />
                      <Legend />
                      {selectedMetrics.map((metric) => (
                        <Area
                          key={metric}
                          yAxisId={metric}
                          type="monotone"
                          dataKey={metric}
                          stroke={
                            metricColors[metric as keyof typeof metricColors]
                          }
                          fill={`url(#gradient-${metric})`}
                          strokeWidth={2}
                          dot={false}
                          name={`${metric.charAt(0).toUpperCase() + metric.slice(1)} (${metricUnits[metric as keyof typeof metricUnits]})`}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Device Info */}
      {(!embedded ||
        ["connectivity", "diagnostics", "thresholds", "activity"].includes(
          section,
        )) && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Device Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Connectivity ID</dt>
                  <dd className="font-mono">
                    {getConnectivityRecordId(device)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="capitalize">{device.type}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Firmware</dt>
                  <dd className="font-mono">{device.firmwareVersion ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Zone</dt>
                  <dd>{device.zone ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{device.location ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last Seen</dt>
                  <dd>
                    {device.lastSeen
                      ? new Date(device.lastSeen).toLocaleString()
                      : "Never"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {(!embedded || section === "thresholds") && (
            <Card>
              <CardHeader>
                <CardTitle>Alert Thresholds</CardTitle>
              </CardHeader>
              <CardContent>
                {thresholds && thresholds.length > 0 ? (
                  <dl className="space-y-3">
                    {thresholds.map((t) => (
                      <div
                        key={t.id}
                        className="flex justify-between items-center"
                      >
                        <dt className="text-muted-foreground capitalize">
                          {t.metric}
                        </dt>
                        <dd className="text-sm">
                          {t.enabled ? (
                            <span>
                              {t.minValue ?? "—"} - {t.maxValue ?? "—"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Disabled
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">
                    No thresholds configured
                  </p>
                )}
                {canViewEngineering(user?.role) && (
                  <Button
                    variant="outline"
                    className="w-full mt-4"
                    onClick={() => setThresholdDialogOpen(true)}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Configure Thresholds
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {!!linkedAssets.length && (!embedded || section === "connectivity") && (
        <section className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">
            Linked assets ({linkedAssets.length})
          </h2>
          {linkedAssets.map((a) => (
            <a
              className="block break-all text-sm text-primary underline"
              key={a.id}
              href={`#/inventory/asset:${a.id}/overview`}
            >
              {a.name} · {a.assetId}
            </a>
          ))}
        </section>
      )}
      {/* Threshold Dialog */}
      {canViewEngineering(user?.role) && (
        <ThresholdConfigDialog
          deviceId={deviceId}
          open={thresholdDialogOpen}
          onOpenChange={setThresholdDialogOpen}
        />
      )}
    </div>
  );
}
