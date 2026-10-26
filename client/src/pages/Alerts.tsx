import { PageHeader } from "@/components/workspace/Primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  MoreVertical,
  RefreshCw,
  Eye,
  Check,
  XCircle,
  CalendarIcon,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { hasMinimumRole } from "@/lib/access";
import { format, endOfDay } from "date-fns";
import { ExportButton } from "@/components/ExportButton";
import type { Alert } from "../../../drizzle/schema";

type AlertStatus = "active" | "acknowledged" | "resolved";
type AlertSeverity = "info" | "warning" | "critical";

const statusColors: Record<AlertStatus, string> = {
  active: "bg-destructive text-destructive-foreground",
  acknowledged: "bg-warning text-warning-foreground",
  resolved: "bg-success text-success-foreground",
};

const severityColors: Record<AlertSeverity, string> = {
  info: "bg-primary/20 text-primary border-primary/30",
  warning: "bg-warning/20 text-warning border-warning/30",
  critical: "bg-destructive/20 text-destructive border-destructive/30",
};

const severityIcons: Record<AlertSeverity, React.ElementType> = {
  info: Clock,
  warning: AlertTriangle,
  critical: XCircle,
};

export default function Alerts() {
  const [, setLocation] = useLocation();
  const { eventId } = useParams<{ eventId?: string }>();
  const utils = trpc.useUtils();
  useEffect(() => {
    const id = Number(eventId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    void utils.alerts.getById.fetch({ id }).then(event => {
      if (event) setSelectedAlert(event);
      else toast.error("Event no longer exists");
    }).catch(() => toast.error("Unable to load this event"));
  }, [eventId, utils]);
  const { user } = useAuth();
  const [selectedEvent, setSelectedAlert] = useState<(Alert & { assignedToName?: string | null }) | null>(null);
  const eventQuery = trpc.alerts.getById.useQuery({ id: selectedEvent?.id ?? 1 }, {
    enabled: selectedEvent !== null,
    refetchInterval: 15_000,
  });
  const selectedAlert = eventQuery.data ?? selectedEvent;
  const canRespond = hasMinimumRole(user?.role, "operator");
  const canManageIncidents = hasMinimumRole(user?.role, "engineer");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });

  const { data: alerts, isLoading, isError, refetch } = trpc.alerts.list.useQuery({
    status: statusFilter !== "all" && statusFilter !== "open" ? (statusFilter as AlertStatus) : undefined,
    openOnly: statusFilter === "open",
    severity: severityFilter !== "all" ? (severityFilter as AlertSeverity) : undefined,
    startTime: dateRange.from?.getTime(),
    endTime: dateRange.to ? endOfDay(dateRange.to).getTime() : undefined,
    limit: 500,
  }, { refetchInterval: 30_000 });

  const { data: alertStats } = trpc.alerts.getStats.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: assignees } = trpc.alerts.assignees.useQuery(undefined, { enabled: canManageIncidents });

  const { data: devices } = trpc.devices.list.useQuery();

  const refreshIncidentData = () => {
    void utils.alerts.list.invalidate();
    void utils.alerts.getById.invalidate();
    void utils.alerts.getStats.invalidate();
    void utils.analytics.getOverview.invalidate();
    void utils.analytics.getAssetTelemetry.invalidate();
  };

  const updateStatusMutation = trpc.alerts.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Alert status updated");
      refreshIncidentData();
    },
    onError: (error) => {
      toast.error(`Failed to update alert: ${error.message}`);
    },
  });

  const assignMutation = trpc.alerts.assign.useMutation({
    onSuccess: () => {
      toast.success("Technician assignment updated");
      refreshIncidentData();
    },
    onError: (error) => toast.error(`Could not assign technician: ${error.message}`),
  });
  const startDowntimeMutation = trpc.alerts.startDowntime.useMutation({
    onSuccess: () => {
      toast.success("Downtime start recorded");
      refreshIncidentData();
    },
    onError: (error) => toast.error(`Could not record downtime: ${error.message}`),
  });
  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => {
      toast.success("Incident resolved");
      refreshIncidentData();
    },
    onError: (error) => toast.error(`Could not resolve incident: ${error.message}`),
  });

  const getDeviceName = (deviceId: number) => {
    const device = devices?.find((d) => d.id === deviceId);
    return device?.name ?? `Device ${deviceId}`;
  };

  const filteredAlerts = useMemo(() => (alerts ?? []).filter((alert) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || alert.message.toLowerCase().includes(query)
      || alert.type.toLowerCase().includes(query) || alert.errorCode.toLowerCase().includes(query)
      || getDeviceName(alert.deviceId).toLowerCase().includes(query);
    const timestamp = new Date(alert.createdAt).getTime();
    const matchesStart = !dateRange.from || timestamp >= dateRange.from.getTime();
    const matchesEnd = !dateRange.to || timestamp <= endOfDay(dateRange.to).getTime();
    return matchesSearch && matchesStart && matchesEnd;
  }), [alerts, search, dateRange, devices]);

  const alertHistoryExport = trpc.export.alertHistoryReport.useMutation();
  const handleExport = async () => alertHistoryExport.mutateAsync({
    startTime: dateRange.from?.getTime() ?? Date.now() - 30 * 24 * 60 * 60 * 1000,
    endTime: dateRange.to ? endOfDay(dateRange.to).getTime() : Date.now(),
    severity: severityFilter !== "all" ? severityFilter as AlertSeverity : undefined,
  });

  const handleAcknowledge = (alertId: number) => {
    updateStatusMutation.mutate({ id: alertId, status: "acknowledged" });
  };

  const technicianName = (userId: number | null) => {
    if (!userId) return "Unassigned";
    const person = assignees?.find((candidate) => candidate.id === userId);
    return person?.name || person?.email || `Technician ${userId}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Alerts" description="Review active events and incident history."/>
        <div className="flex gap-2">
        <ExportButton onExportHtml={handleExport} label="Export History" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Card className={alertStats?.critical && alertStats.critical > 0 ? "card-glow-error" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Critical</p>
                <p className="text-2xl font-bold text-destructive">
                  {alertStats?.critical ?? 0}
                </p>
              </div>
              <XCircle className="h-8 w-8 text-destructive/50" />
            </div>
          </CardContent>
        </Card>
        <Card className={alertStats?.warning && alertStats.warning > 0 ? "card-glow-warning" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Warning</p>
                <p className="text-2xl font-bold text-warning">
                  {alertStats?.warning ?? 0}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-warning/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Acknowledged</p>
                <p className="text-2xl font-bold">{alertStats?.acknowledged ?? 0}</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Resolved</p>
                <p className="text-2xl font-bold text-success">
                  {alertStats?.resolved ?? 0}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-success/50" />
            </div>
          </CardContent>
        </Card>
        <Card className={alertStats?.activeDowntime ? "border-rose-300 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20" : ""}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active downtime</p>
                <p className="text-2xl font-bold">{alertStats?.activeDowntime ?? 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">{alertStats?.longestActiveDowntimeSeconds == null ? "No outage clock running" : `Longest ${formatDuration(alertStats.longestActiveDowntimeSeconds)}`}</p>
              </div>
              <Clock className="h-8 w-8 text-rose-600/60 dark:text-rose-300/70" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Mean downtime to resolution</p>
                <p className="text-2xl font-bold">{alertStats?.averageDowntimeToResolutionSeconds == null ? "—" : formatDuration(alertStats.averageDowntimeToResolutionSeconds)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{alertStats?.resolvedDowntimeCount ?? 0} completed downtime incidents</p>
              </div>
              <CheckCircle className="h-8 w-8 text-emerald-600/60 dark:text-emerald-300/70" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Search alerts" placeholder="Search message, source, or type…" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Alert status filter" className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open incidents</SelectItem>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger aria-label="Alert severity filter" className="w-full sm:w-40">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" className="w-full sm:w-auto"><CalendarIcon className="mr-2 h-4 w-4" />{dateRange.from && dateRange.to ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}` : "Date range"}</Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="range" selected={{ from: dateRange.from, to: dateRange.to }} onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })} numberOfMonths={2} disabled={{ after: new Date() }} />
                {(dateRange.from || dateRange.to) && <div className="border-t p-3"><Button variant="outline" size="sm" className="w-full" onClick={() => setDateRange({ from: undefined, to: undefined })}>Clear dates</Button></div>}
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Events ({filteredAlerts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
              <RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />
              Loading events…
            </div>
          ) : isError ? (
            <p role="alert" className="py-8 text-center text-destructive">Events could not be loaded. Refresh to retry.</p>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <CheckCircle className="h-12 w-12 text-success mb-4" />
              <h3 className="text-lg font-semibold mb-2">No alerts</h3>
              <p className="text-muted-foreground text-center">
                {search || dateRange.from || dateRange.to || statusFilter !== "all" || severityFilter !== "all"
                  ? "No alerts match your filters"
                  : "All systems operating normally"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Error code</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Downtime / resolution</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((alert) => {
                    const SeverityIcon = severityIcons[alert.severity as AlertSeverity];
                    return (
                      <TableRow
                        key={alert.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        aria-label={`Open details for ${alert.errorCode}`}
                        onClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest("button,[role='combobox'],[data-radix-collection-item]")) return;
                          setSelectedAlert(alert);
                        }}
                        onKeyDown={(event) => {
                          if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                            event.preventDefault();
                            setSelectedAlert(alert);
                          }
                        }}
                      >
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={severityColors[alert.severity as AlertSeverity]}
                          >
                            <SeverityIcon className="h-3 w-3 mr-1" />
                            {alert.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="link"
                            className="p-0 h-auto"
                            onClick={() => setLocation(`/devices/${alert.deviceId}`)}
                          >
                            {getDeviceName(alert.deviceId)}
                          </Button>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="whitespace-nowrap font-mono text-xs">{alert.errorCode}</Badge></TableCell>
                        <TableCell>
                          <p className="max-w-xs min-w-48 truncate" title={alert.message}>{alert.message}</p>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm capitalize">
                            {alert.type.replace(/_/g, " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {canManageIncidents ? <Select
                            value={alert.assignedToId ? String(alert.assignedToId) : "unassigned"}
                            onValueChange={(value) => assignMutation.mutate({ id: alert.id, assignedToId: value === "unassigned" ? null : Number(value) })}
                            disabled={alert.status === "resolved" || assignMutation.isPending}
                          >
                            <SelectTrigger className="h-8 min-w-40" aria-label={`Assign technician for ${alert.errorCode}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {(assignees ?? []).map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name || person.email || `Technician ${person.id}`}</SelectItem>)}
                            </SelectContent>
                          </Select> : <span className="whitespace-nowrap text-sm">{alert.assignedToName || technicianName(alert.assignedToId)}</span>}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[alert.status as AlertStatus]}>
                            {alert.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-44 whitespace-nowrap text-sm">
                          {alert.downtimeStartedAt ? <span title={`Downtime started ${new Date(alert.downtimeStartedAt).toLocaleString()}`}>
                            {alert.status === "resolved" && alert.resolvedAt
                              ? `Resolved in ${formatDuration(Math.max(0, Math.round((new Date(alert.resolvedAt).getTime() - new Date(alert.downtimeStartedAt).getTime()) / 1000)))}`
                              : `Ongoing · ${formatDuration(Math.max(0, Math.round((Date.now() - new Date(alert.downtimeStartedAt).getTime()) / 1000)))}`}
                          </span> : <span className="text-muted-foreground">Not recorded</span>}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(alert.createdAt).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`View event details for ${alert.errorCode}`}
                            onClick={(event) => { event.stopPropagation(); setSelectedAlert(alert); }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Actions for ${alert.errorCode}`}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setLocation(`/devices/${alert.deviceId}`)}
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                View Device
                              </DropdownMenuItem>
                              {!canManageIncidents && alert.status !== "resolved" && <DropdownMenuItem onClick={() => toast.error("Assigning a technician requires engineer or administrator access. Ask your administrator to update your role.")}>Assign technician</DropdownMenuItem>}
                              {canRespond && alert.status === "active" && (
                                <DropdownMenuItem
                                  onClick={() => handleAcknowledge(alert.id)}
                                >
                                  <Clock className="h-4 w-4 mr-2" />
                                  Acknowledge
                                </DropdownMenuItem>
                              )}
                              {canManageIncidents && alert.status !== "resolved" && alert.assignedToId && (alert.assignedToId === user?.id || user?.role === "admin") && !alert.downtimeStartedAt && (
                                <DropdownMenuItem onClick={() => startDowntimeMutation.mutate({ id: alert.id })}>
                                  <Clock className="h-4 w-4 mr-2" />Record downtime start
                                </DropdownMenuItem>
                              )}
                              {canManageIncidents && alert.status !== "resolved" && (alert.assignedToId === user?.id || user?.role === "admin") && (
                                <DropdownMenuItem
                                  onClick={() => resolveMutation.mutate({ id: alert.id })}
                                >
                                  <Check className="h-4 w-4 mr-2" />
                                  Resolve
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={selectedAlert !== null} onOpenChange={(open) => { if (!open) setSelectedAlert(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {selectedAlert && <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                Event {selectedAlert.errorCode}
              </DialogTitle>
              <DialogDescription>Incident details, technician ownership, and downtime timing.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <EventDetail label="Device" value={`${getDeviceName(selectedAlert.deviceId)} · ${selectedAlert.deviceId}`} />
              <EventDetail label="Severity" value={selectedAlert.severity} />
              <EventDetail label="Type" value={selectedAlert.type.replace(/_/g, " ")} />
              <EventDetail label="Status" value={selectedAlert.status} />
              <EventDetail label="Technician" value={selectedAlert.assignedToName || technicianName(selectedAlert.assignedToId)} />
              {selectedAlert.metric && <EventDetail label="Measured metric" value={selectedAlert.metric} />}
              {selectedAlert.value !== null && <EventDetail label="Reported value" value={String(selectedAlert.value)} />}
              {selectedAlert.threshold !== null && <EventDetail label="Configured threshold" value={String(selectedAlert.threshold)} />}
              <EventDetail label="Event recorded" value={formatEventTime(selectedAlert.createdAt)} />
              <EventDetail label="Acknowledged" value={selectedAlert.acknowledgedAt ? formatEventTime(selectedAlert.acknowledgedAt) : "Not acknowledged"} />
              <EventDetail label="Downtime started" value={selectedAlert.downtimeStartedAt ? formatEventTime(selectedAlert.downtimeStartedAt) : "Not recorded"} />
              <EventDetail label="Resolved" value={selectedAlert.resolvedAt ? formatEventTime(selectedAlert.resolvedAt) : "Still open"} />
              {selectedAlert.downtimeStartedAt && <EventDetail
                label="Downtime to resolution"
                value={selectedAlert.resolvedAt
                  ? formatDuration(Math.max(0, Math.round((new Date(selectedAlert.resolvedAt).getTime() - new Date(selectedAlert.downtimeStartedAt).getTime()) / 1000)))
                  : `Ongoing · ${formatDuration(Math.max(0, Math.round((Date.now() - new Date(selectedAlert.downtimeStartedAt).getTime()) / 1000)))}`}
              />}
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Event message</p>
              <p className="whitespace-pre-wrap break-words text-sm">{selectedAlert.message}</p>
            </div>
            {eventQuery.isError && <p role="alert" className="text-sm text-destructive">The latest event details could not be loaded. These details may be out of date.</p>}
            {selectedAlert.status !== "resolved" && <div className="space-y-3 border-t pt-4">
              {canManageIncidents ? <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="event-technician">Assign technician</label>
                <Select value={selectedAlert.assignedToId ? String(selectedAlert.assignedToId) : "unassigned"}
                  disabled={assignMutation.isPending}
                  onValueChange={(value) => assignMutation.mutate({ id: selectedAlert.id, assignedToId: value === "unassigned" ? null : Number(value) })}>
                  <SelectTrigger id="event-technician"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{(assignees ?? []).map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name || person.email || `Technician ${person.id}`}</SelectItem>)}</SelectContent>
                </Select>
              </div> : <p className="text-sm text-muted-foreground">Assigning a technician requires engineer or administrator access. Ask your administrator to update your role.</p>}
              <div className="flex flex-wrap gap-2">
                {canRespond && selectedAlert.status === "active" && <Button variant="outline" disabled={updateStatusMutation.isPending} onClick={() => handleAcknowledge(selectedAlert.id)}>Acknowledge</Button>}
                {canManageIncidents && (selectedAlert.assignedToId === user?.id || user?.role === "admin") && <>
                  {!selectedAlert.downtimeStartedAt && <Button variant="outline" disabled={startDowntimeMutation.isPending} onClick={() => startDowntimeMutation.mutate({ id: selectedAlert.id })}>Record downtime start</Button>}
                  <Button disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate({ id: selectedAlert.id })}>Resolve incident</Button>
                </>}
              </div>
              {canManageIncidents && selectedAlert.assignedToId !== user?.id && user?.role !== "admin" && <p className="text-sm text-muted-foreground">The assigned technician or an administrator can record downtime and resolve this incident.</p>}
            </div>}
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium capitalize">{value}</p></div>;
}

function formatEventTime(value: Date | string) {
  return format(new Date(value), "PPpp");
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
