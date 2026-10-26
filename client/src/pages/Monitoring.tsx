import { Link } from "wouter";
import { SampleTime } from "@/components/workspace/Primitives";
import { PageHeader } from "@/components/workspace/Primitives";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { getConnectivityRecordId } from "@/lib/device-display";

type DeviceStatus =
  | "online"
  | "offline"
  | "maintenance"
  | "error"
  | "unknown"
  | "stale";
type DeviceType =
  | "sensor"
  | "actuator"
  | "controller"
  | "gateway"
  | "edge_device";
const PAGE_SIZE = 50;
const statusColors: Record<DeviceStatus, string> = {
  online: "bg-success text-success-foreground",
  offline: "bg-muted text-muted-foreground",
  maintenance: "bg-warning text-warning-foreground",
  error: "bg-destructive text-destructive-foreground",
  stale: "bg-warning/10 text-foreground",
  unknown: "bg-muted text-muted-foreground",
};
const typeColors: Record<DeviceType, string> = {
  sensor: "border-border bg-muted/30 text-foreground",
  actuator: "border-border bg-muted/30 text-foreground",
  controller: "border-border bg-muted/30 text-foreground",
  gateway: "border-border bg-muted/30 text-foreground",
  edge_device: "border-border bg-muted/30 text-foreground",
};

function sensorTypeFor(device: { metadata?: Record<string, unknown> | null }) {
  const sensorType = device.metadata?.sensorType;
  return typeof sensorType === "string" && sensorType.trim()
    ? sensorType.trim()
    : undefined;
}

function hasSensorReadError(device: {
  metadata?: Record<string, unknown> | null;
}) {
  return device.metadata?.sensorStatus === "read_error";
}

export default function Monitoring() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const {
    data: devices,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = trpc.devices.list.useQuery(
    {
      type: typeFilter !== "all" ? (typeFilter as DeviceType) : undefined,
    },
    { refetchInterval: 30000 },
  );
  const filteredDevices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (devices ?? [])
      .map((d) => ({
        ...d,
        status: d.observedStatus === "live" ? "online" : d.observedStatus,
      }))
      .filter((d) => statusFilter === "all" || d.status === statusFilter)
      .filter(
        (device) =>
          !query ||
          [
            device.name,
            getConnectivityRecordId(device),
            device.zone,
            device.location,
            device.type,
            sensorTypeFor(device),
          ].some((value) => value?.toLocaleLowerCase().includes(query)),
      );
  }, [devices, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredDevices.length / PAGE_SIZE));
  const pageDevices = filteredDevices.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  // Query readings for the visible page only so a large fleet does not create an oversized request.
  const deviceIds = pageDevices.map((device) => device.id);
  const {
    data: latestReadings,
    isLoading: readingsLoading,
    isFetching: readingsFetching,
    isError: readingsError,
    refetch: refetchReadings,
  } = trpc.readings.getLatestBatch.useQuery(
    { deviceIds },
    { enabled: deviceIds.length > 0, refetchInterval: 10000 },
  );
  const latestByDeviceId = useMemo(
    () =>
      new Map(
        (latestReadings ?? []).map((reading) => [reading.deviceId, reading]),
      ),
    [latestReadings],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Monitoring"
          description="Connectivity and latest readings."
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([refetch(), refetchReadings()])}
          disabled={isFetching || readingsFetching}
        >
          <RefreshCw
            aria-hidden="true"
            className={`mr-2 h-4 w-4 ${isFetching || readingsFetching ? "animate-spin" : ""}`}
          />
          {isFetching || readingsFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search monitoring sources"
            placeholder="Search device, gateway, sensor type, zone, or location"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value);
            setPage(0);
          }}
        >
          <SelectTrigger
            aria-label="Monitoring status filter"
            className="w-full sm:w-44"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            setTypeFilter(value);
            setPage(0);
          }}
        >
          <SelectTrigger
            aria-label="Monitoring source type filter"
            className="w-full sm:w-44"
          >
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="gateway">Gateways</SelectItem>
            <SelectItem value="sensor">Sensors</SelectItem>
            <SelectItem value="controller">Controllers</SelectItem>
            <SelectItem value="actuator">Actuators</SelectItem>
          </SelectContent>
        </Select>
        {!isLoading && (
          <p
            className="self-center whitespace-nowrap text-sm text-muted-foreground"
            aria-live="polite"
          >
            {filteredDevices.length} source
            {filteredDevices.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {readingsError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Latest device readings could not be loaded. Connectivity information
          may still be current.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div
              role="status"
              className="flex justify-center gap-3 py-12 text-sm text-muted-foreground"
            >
              <RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />
              Loading monitoring sources…
            </div>
          ) : isError ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-3 py-12 text-center"
            >
              <p className="text-sm text-destructive">
                Monitoring sources could not be loaded. {error?.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </div>
          ) : pageDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="mb-4 h-10 w-10 text-muted-foreground" />
              <h2 className="font-semibold">No monitoring sources found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {search || statusFilter !== "all" || typeFilter !== "all"
                  ? "Try changing the search, status, or type filter."
                  : "Register a gateway or ingest an edge-device sample to begin monitoring."}
              </p>
            </div>
          ) : (
            <>
              {" "}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Temperature</TableHead>
                      <TableHead>Humidity</TableHead>
                      <TableHead>Vibration</TableHead>
                      <TableHead>Power</TableHead>
                      <TableHead>Speed</TableHead>
                      <TableHead>Last reading</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageDevices.map((device) => {
                      const reading = latestByDeviceId.get(device.id);
                      const status = device.status as DeviceStatus;
                      const deviceType = device.type as DeviceType;
                      const sensorType = sensorTypeFor(device);
                      const sensorReadError = hasSensorReadError(device);
                      return (
                        <TableRow
                          key={device.id}
                          role="link"
                          tabIndex={0}
                          aria-label={`Open ${device.name}`}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() => setLocation(`/devices/${device.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setLocation(`/devices/${device.id}`);
                            }
                          }}
                        >
                          <TableCell className="min-w-48">
                            <span className="font-medium">{device.name}</span>
                            <span className="block font-mono text-xs text-muted-foreground">
                              {getConnectivityRecordId(device)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {[device.zone, device.location]
                                .filter(Boolean)
                                .join(" · ") || "No location"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="flex min-w-24 flex-col items-start gap-1">
                              <Badge
                                variant="outline"
                                className={typeColors[deviceType]}
                              >
                                {device.type}
                              </Badge>
                              {sensorType && (
                                <Badge variant="outline">{sensorType}</Badge>
                              )}
                              {sensorReadError && (
                                <Badge
                                  variant="outline"
                                  className="border-destructive/40 bg-destructive/10 text-destructive"
                                >
                                  Read error
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                statusColors[status] ?? statusColors.offline
                              }
                              variant="secondary"
                            >
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={
                              sensorReadError ? "text-destructive" : undefined
                            }
                          >
                            {sensorReadError
                              ? "Unavailable"
                              : reading?.temperature == null
                                ? "—"
                                : `${reading.temperature.toFixed(1)} °C`}
                          </TableCell>
                          <TableCell
                            className={
                              sensorReadError ? "text-destructive" : undefined
                            }
                          >
                            {sensorReadError
                              ? "Unavailable"
                              : reading?.humidity == null
                                ? "—"
                                : `${reading.humidity.toFixed(1)}%`}
                          </TableCell>
                          <TableCell
                            className={
                              sensorReadError ? "text-destructive" : undefined
                            }
                          >
                            {sensorReadError
                              ? "Unavailable"
                              : reading?.vibration == null
                                ? "—"
                                : reading.vibration.toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={
                              sensorReadError ? "text-destructive" : undefined
                            }
                          >
                            {sensorReadError
                              ? "Unavailable"
                              : reading?.power == null
                                ? "—"
                                : `${reading.power.toFixed(0)} W`}
                          </TableCell>
                          <TableCell
                            className={
                              sensorReadError ? "text-destructive" : undefined
                            }
                          >
                            {sensorReadError
                              ? "Unavailable"
                              : reading?.rpm == null
                                ? "—"
                                : `${reading.rpm.toFixed(0)} rpm`}
                          </TableCell>
                          <TableCell
                            className={`min-w-36 text-xs ${sensorReadError ? "font-medium text-destructive" : ""}`}
                          >
                            {reading ? (
                              <>
                                {sensorReadError && (
                                  <span className="block">Read failed</span>
                                )}
                                <time
                                  title={new Date(
                                    reading.timestamp,
                                  ).toLocaleString(undefined, {
                                    timeZoneName: "long",
                                  })}
                                  dateTime={new Date(
                                    reading.timestamp,
                                  ).toISOString()}
                                >
                                  {new Date(reading.timestamp).toLocaleString()}
                                </time>
                                <span className="mt-1 block capitalize">
                                  {device.isDemo
                                    ? "Simulated"
                                    : String(
                                        reading.integration?.mode ?? "Unknown",
                                      )}{" "}
                                  evidence
                                </span>
                              </>
                            ) : readingsLoading ? (
                              "Loading…"
                            ) : (
                              "No sample"
                            )}
                          </TableCell>
                          <TableCell className="min-w-36 text-xs">
                            {device.lastSeen
                              ? new Date(device.lastSeen).toLocaleString()
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden">
                {pageDevices.map((d) => (
                  <article key={d.id} className="space-y-2 rounded border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        className="min-w-0 break-words font-medium"
                        href={`/inventory/device:${d.id}/telemetry`}
                      >
                        {d.name}
                      </Link>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/inventory/device:${d.id}/telemetry`}>
                          Open
                        </Link>
                      </Button>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">
                      {d.deviceId} · {d.type}
                    </p>
                    <Badge variant="outline">{d.status}</Badge>
                    <p className="text-xs">
                      <SampleTime
                        value={latestByDeviceId.get(d.id)?.timestamp}
                        historical={d.status !== "online"}
                      />{" "}
                      ·{" "}
                      {String(
                        latestByDeviceId.get(d.id)?.integration?.mode ??
                          (d.isDemo ? "simulated" : "unknown"),
                      )}{" "}
                      evidence
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!isLoading && filteredDevices.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, filteredDevices.length)} of{" "}
            {filteredDevices.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((value) => Math.min(pageCount - 1, value + 1))
              }
              disabled={page >= pageCount - 1}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
