import { PageHeader } from "@/components/workspace/Primitives";
import { useMemo, useState } from "react";
import { endOfDay, format } from "date-fns";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, AlertTriangle, BarChart3, CalendarIcon, Info, RefreshCw, Thermometer, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportButton } from "@/components/ExportButton";
import { trpc } from "@/lib/trpc";

type TimeRange = "24h" | "7d" | "30d" | "custom";
type GroupBy = "assetType" | "zone" | "location" | "manufacturer" | "lifecycleStage";

const GROUP_FIELDS: Record<GroupBy, string> = {
  assetType: "Asset type",
  zone: "Zone",
  location: "Location",
  manufacturer: "Manufacturer",
  lifecycleStage: "Lifecycle stage",
};

function groupValue(asset: { assetType: string; zone: string | null; location: string | null; manufacturer: string | null; lifecycleStage: string }, field: GroupBy) {
  if (field === "assetType" && asset.assetType === "wind_turbine") return "Wind turbine generator";
  return (asset[field] || "Unassigned").replaceAll("_", " ");
}

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [customDateRange, setCustomDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [scope, setScope] = useState<"asset" | "group">("group");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("assetType");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [analysisTime, setAnalysisTime] = useState(() => Date.now());

  const assetsQuery = trpc.assets.list.useQuery();
  const assets = assetsQuery.data ?? [];
  const groupOptions = useMemo(() => Array.from(new Set(assets.map((asset) => groupValue(asset, groupBy)))).sort(), [assets, groupBy]);
  const selectedAssets = useMemo(() => {
    if (scope === "asset") return assets.filter((asset) => asset.assetId === selectedAssetId);
    return assets.filter((asset) => selectedGroup === "all" || groupValue(asset, groupBy) === selectedGroup);
  }, [assets, scope, selectedAssetId, selectedGroup, groupBy]);

  const { startTime, endTime } = useMemo(() => {
    const now = analysisTime;
    if (timeRange === "custom" && customDateRange.from && customDateRange.to) {
      return { startTime: customDateRange.from.getTime(), endTime: endOfDay(customDateRange.to).getTime() };
    }
    const durations: Record<TimeRange, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      custom: 7 * 24 * 60 * 60 * 1000,
    };
    return { startTime: now - durations[timeRange], endTime: now };
  }, [timeRange, customDateRange, analysisTime]);

  const intervalMs = timeRange === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const analyticsInput = { assetIds: selectedAssets.map((asset) => asset.assetId), startTime, endTime, intervalMs };
  const analyticsQuery = trpc.analytics.getAssetTelemetry.useQuery(analyticsInput, { enabled: selectedAssets.length > 0 });
  const coverageQuery = trpc.analytics.getCoverage.useQuery(analyticsInput, { enabled: selectedAssets.length > 0 });
  const analytics = analyticsQuery.data;
  const exportMutation = trpc.export.analyticsReport.useMutation();

  const timeline = useMemo(() => (analytics?.timeline ?? []).map((item) => ({
    ...item,
    time: format(new Date(item.timestamp), timeRange === "24h" ? "HH:mm" : "MMM d"),
    avgTemperature: item.avgTemperature === null ? null : Number(item.avgTemperature.toFixed(1)),
    avgHumidity: item.avgHumidity === null ? null : Number(item.avgHumidity.toFixed(1)),
    avgPower: item.avgPower === null ? null : Math.round(item.avgPower),
    avgVibration: item.avgVibration === null ? null : Number(item.avgVibration.toFixed(2)),
    avgPressure: item.avgPressure === null ? null : Number(item.avgPressure.toFixed(2)),
    avgRpm: item.avgRpm === null ? null : Math.round(item.avgRpm),
  })), [analytics, timeRange]);

  const groupedPower = useMemo(() => {
    const summaryByGroup = new Map<string, { sum: number; count: number; assets: number }>();
    for (const asset of analytics?.assets ?? []) {
      const key = groupValue(asset, groupBy);
      const current = summaryByGroup.get(key) ?? { sum: 0, count: 0, assets: 0 };
      current.assets += 1;
      if (asset.avgPower !== null) {
        // This comparison uses a mean of per-asset means so one fast-reporting asset
        // cannot dominate the group solely because it sends more samples.
        current.sum += asset.avgPower;
        current.count += 1;
      }
      summaryByGroup.set(key, current);
    }
    return Array.from(summaryByGroup, ([name, values]) => ({
      name,
      avgPower: values.count ? Math.round(values.sum / values.count) : null,
      assets: values.assets,
    })).sort((left, right) => left.name.localeCompare(right.name));
  }, [analytics, groupBy]);

  const assetSignalRows = useMemo(() => (analytics?.assets ?? []).flatMap((asset) =>
    asset.assetSignals.map((signal) => ({ ...signal, assetId: asset.assetId, assetName: asset.name })),
  ), [analytics]);

  const selectedLabel = scope === "asset"
    ? selectedAssets[0]?.name ?? "Select an asset"
    : selectedGroup === "all" ? `All assets · grouped by ${GROUP_FIELDS[groupBy].toLowerCase()}` : `${GROUP_FIELDS[groupBy]} · ${selectedGroup}`;
  const latestReading = Math.max(0, ...(analytics?.assets.map((asset) => asset.latestReadingAt ?? 0) ?? []));
  const activeAlerts = (analytics?.overall.alerts.activeCritical ?? 0) + (analytics?.overall.alerts.activeWarning ?? 0);
  const isSingleAsset = analytics?.assets.length === 1;
  const assetsWithVibration = analytics?.assets.filter((asset) => asset.peakVibration !== null).length ?? 0;
  const assetsWithPressure = analytics?.assets.filter((asset) => asset.avgPressure !== null).length ?? 0;
  const isLoading = assetsQuery.isLoading || analyticsQuery.isLoading;

  const handleExport = () => exportMutation.mutateAsync(analyticsInput);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader title="Analytics" description="Analyze telemetry for assets and groups."/>
        <div className="flex flex-wrap gap-2">
          <ExportButton onExportHtml={handleExport} label="Export Report" />
          <Button variant="outline" size="sm" onClick={() => { setAnalysisTime(Date.now()); void assetsQuery.refetch(); void analyticsQuery.refetch(); void coverageQuery.refetch(); }} disabled={isLoading || !selectedAssets.length}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Analysis scope</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select value={scope} onValueChange={(value) => setScope(value as "asset" | "group")}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Analytics scope"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="asset">Single asset</SelectItem><SelectItem value="group">Asset group</SelectItem></SelectContent>
          </Select>
          {scope === "asset" ? (
            <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
              <SelectTrigger className="w-full sm:w-64" aria-label="Choose asset"><SelectValue placeholder="Choose an asset" /></SelectTrigger>
              <SelectContent>{assets.map((asset) => <SelectItem key={asset.assetId} value={asset.assetId}>{asset.name} · {groupValue(asset, "assetType")}</SelectItem>)}</SelectContent>
            </Select>
          ) : <>
            <Select value={groupBy} onValueChange={(value) => { setGroupBy(value as GroupBy); setSelectedGroup("all"); }}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Group assets by"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(GROUP_FIELDS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Choose asset group"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All groups</SelectItem>{groupOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
          </>}
          <Select value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Time range"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="24h">Last 24 hours</SelectItem><SelectItem value="7d">Last 7 days</SelectItem><SelectItem value="30d">Last 30 days</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent>
          </Select>
          {timeRange === "custom" && <Popover>
            <PopoverTrigger asChild><Button variant="outline" className="w-full sm:w-auto"><CalendarIcon className="mr-2 h-4 w-4" />{customDateRange.from && customDateRange.to ? `${format(customDateRange.from, "MMM d")} – ${format(customDateRange.to, "MMM d")}` : "Choose dates"}</Button></PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start"><Calendar mode="range" selected={{ from: customDateRange.from, to: customDateRange.to }} onSelect={(range) => setCustomDateRange({ from: range?.from, to: range?.to })} numberOfMonths={2} disabled={{ after: new Date() }} /></PopoverContent>
          </Popover>}
        </CardContent>
      </Card>

      {(assetsQuery.isError || analyticsQuery.isError) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">Analytics could not be loaded: {assetsQuery.error?.message ?? analyticsQuery.error?.message}. Refresh or select a smaller scope.</div>}
      {!assetsQuery.isLoading && !assetsQuery.isError && assets.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No AAS assets are registered yet. Create or import an asset to analyze its telemetry.</CardContent></Card>}
      {assets.length > 0 && selectedAssets.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">Choose an asset to view its telemetry.</CardContent></Card>}

      {selectedAssets.length > 0 && !analyticsQuery.isError && <>
        <p className="text-xs text-muted-foreground">Historical operational scope: live and unclassified legacy samples. Explicit simulation and replay streams remain excluded; demonstration records are labelled separately.</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{selectedLabel}</span>
          <span>{selectedAssets.every((asset) => asset.isDemo) ? "Simulated data" : selectedAssets.some((asset) => asset.isDemo) ? "Includes simulated data" : "Registered asset data"}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Assets in scope" value={analytics?.assets.length ?? selectedAssets.length} helper="AAS identities" icon={<BarChart3 className="h-4 w-4" />} />
          <MetricCard label="Telemetry samples" value={analytics?.overall.sampleCount ?? 0} helper="In selected period" icon={<BarChart3 className="h-4 w-4" />} />
          <MetricCard label="Mean / peak power" value={analytics?.overall.avgPower === null || analytics?.overall.avgPower === undefined ? "—" : `${Math.round(analytics.overall.avgPower)} / ${analytics.overall.peakPower === null ? "—" : Math.round(analytics.overall.peakPower)} W`} helper="Reported electrical power" icon={<Zap className="h-4 w-4" />} />
          <MetricCard label="Average temperature" value={analytics?.overall.avgTemperature === null || analytics?.overall.avgTemperature === undefined ? "—" : `${analytics.overall.avgTemperature.toFixed(1)} °C`} helper={latestReading ? `Latest sample ${format(new Date(latestReading), "MMM d, HH:mm")}` : "No attributed samples"} icon={<Thermometer className="h-4 w-4" />} />
            <MetricCard label={isSingleAsset ? "Mean pressure" : "Assets reporting pressure"} value={isSingleAsset ? (analytics?.assets[0]?.avgPressure === null || analytics?.assets[0]?.avgPressure === undefined ? "—" : analytics.assets[0].avgPressure.toFixed(2)) : `${assetsWithPressure} / ${analytics?.assets.length ?? 0}`} helper="Pressure stays per asset because mapped units can differ" icon={<Activity className="h-4 w-4" />} />
          <MetricCard label="Mean / peak speed" value={analytics?.overall.avgRpm === null || analytics?.overall.avgRpm === undefined ? "—" : `${Math.round(analytics.overall.avgRpm)} / ${analytics.overall.peakRpm === null ? "—" : Math.round(analytics.overall.peakRpm)} rpm`} helper="Reported rotation speed" icon={<Activity className="h-4 w-4" />} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Condition and maintenance signals</CardTitle>
            <p className="text-sm text-muted-foreground">Rule alerts and observed sensor movement for the selected period. Trends are screening indicators, not failure predictions.</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Open critical incidents" value={analytics?.overall.alerts.activeCritical ?? 0} helper="Includes acknowledged incidents" icon={<AlertTriangle className="h-4 w-4" />} />
            <MetricCard label="Open warning incidents" value={analytics?.overall.alerts.activeWarning ?? 0} helper="Includes acknowledged incidents" icon={<AlertTriangle className="h-4 w-4" />} />
            <MetricCard label={isSingleAsset ? "Peak vibration" : "Assets reporting vibration"} value={isSingleAsset ? (analytics?.assets[0]?.peakVibration === null || analytics?.assets[0]?.peakVibration === undefined ? "—" : analytics.assets[0].peakVibration.toFixed(2)) : `${assetsWithVibration} / ${analytics?.assets.length ?? 0}`} helper="Vibration units are device profile dependent; compare per asset" icon={<Activity className="h-4 w-4" />} />
            <MetricCard label="Peak temperature" value={analytics?.overall.peakTemperature === null || analytics?.overall.peakTemperature === undefined ? "—" : `${analytics.overall.peakTemperature.toFixed(1)} °C`} helper="Observed in selected period" icon={<Thermometer className="h-4 w-4" />} />
          </CardContent>
          <CardContent className="overflow-x-auto pt-0">
            <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-4">Asset</th><th className="py-2 pr-4">Active alerts</th><th className="py-2 pr-4">Temperature shift</th><th className="py-2 pr-4">Vibration shift</th><th className="py-2">Period alert events</th></tr></thead><tbody>
              {(analytics?.assets ?? []).map((asset) => <tr key={asset.assetId} className="border-b last:border-0"><td className="py-3 pr-4 font-medium">{asset.name}</td><td className="py-3 pr-4">{asset.alerts.activeCritical} critical · {asset.alerts.activeWarning} warning</td><td className="py-3 pr-4">{formatShift(asset.trends.temperature?.changePercent)}</td><td className="py-3 pr-4">{formatShift(asset.trends.vibration?.changePercent)}</td><td className="py-3">{asset.alerts.eventsInPeriod}</td></tr>)}
            </tbody></table>
            {activeAlerts > 0 && <p className="mt-3 text-xs text-muted-foreground">Summary counts each incident once. Gateway-wide incidents appear on every linked asset; asset-specific incidents appear only on their source asset.</p>}
          </CardContent>
        </Card>

        {scope === "group" && selectedGroup === "all" && <Card>
          <CardHeader><CardTitle>Average power by {GROUP_FIELDS[groupBy].toLowerCase()}</CardTitle></CardHeader>
          <CardContent className="h-72">
            {groupedPower.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={groupedPower} margin={{ bottom: 24 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="name" angle={-20} textAnchor="end" height={60} stroke="var(--muted-foreground)" fontSize={12} /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Bar dataKey="avgPower" name="Mean power (W)" fill="var(--primary)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-muted-foreground">No asset telemetry in this period.</div>}
          </CardContent>
        </Card>}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-chart-5" />Power telemetry · {selectedLabel}</CardTitle></CardHeader>
          <CardContent className="h-[350px]">
            {isLoading ? <ChartLoading /> : timeline.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Line type="monotone" dataKey="avgPower" name="Mean power (W)" stroke="#eab308" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer> : <NoReadings />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Thermometer className="h-5 w-5 text-chart-2" />Environmental telemetry · {selectedLabel}</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            {isLoading ? <ChartLoading /> : timeline.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} /><YAxis yAxisId="temperature" stroke="#f97316" /><YAxis yAxisId="humidity" orientation="right" stroke="#3b82f6" /><Tooltip /><Legend /><Line yAxisId="temperature" type="monotone" dataKey="avgTemperature" name="Mean temperature (°C)" stroke="#f97316" strokeWidth={2} dot={false} connectNulls /><Line yAxisId="humidity" type="monotone" dataKey="avgHumidity" name="Mean humidity (%)" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer> : <NoReadings />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-chart-4" />Vibration trend · {selectedLabel}</CardTitle>
            <p className="text-sm text-muted-foreground">Observed average vibration readings. Compare against asset-specific limits and verify signal units before using for maintenance decisions.</p>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? <ChartLoading /> : !isSingleAsset ? <AssetScopedMetricHint metric="vibration" /> : timeline.some((item) => item.avgVibration !== null) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Line type="monotone" dataKey="avgVibration" name="Mean vibration" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer> : <NoReadings />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pressure trend · {selectedLabel}</CardTitle><p className="text-sm text-muted-foreground">Values use the unit provided by each asset mapping. Avoid cross-asset comparison until units are normalized.</p></CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? <ChartLoading /> : !isSingleAsset ? <AssetScopedMetricHint metric="pressure" /> : timeline.some((item) => item.avgPressure !== null) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Line type="monotone" dataKey="avgPressure" name="Mean pressure (asset unit)" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer> : <NoReadings />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rotational speed · {selectedLabel}</CardTitle><p className="text-sm text-muted-foreground">Reported revolutions per minute (rpm).</p></CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? <ChartLoading /> : timeline.some((item) => item.avgRpm !== null) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={12} /><YAxis stroke="var(--muted-foreground)" /><Tooltip /><Legend /><Line type="monotone" dataKey="avgRpm" name="Mean speed (rpm)" stroke="#14b8a6" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer> : <NoReadings />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Energy and sustainability</CardTitle><p className="text-sm text-muted-foreground">Power samples show instantaneous readings; verified interval energy and emissions inputs are not recorded yet.</p></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <ReadinessItem title="Energy consumed (kWh)" needs="A calibrated energy meter or validated integration using canonical power units and sample intervals." />
            <ReadinessItem title="Energy per production unit" needs="Verified energy consumption and good-unit production counts for the same asset and time window." />
            <ReadinessItem title="Carbon emissions" needs="Energy by source plus the applicable, versioned emissions factor for the site and reporting period." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" />Advanced analytics data readiness</CardTitle>
            <p className="text-sm text-muted-foreground">These results need more than the telemetry currently stored. They remain unavailable until the required operating and lifecycle records are connected.</p>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <ReadinessItem title="Predictive maintenance and RUL" needs="Time-aligned condition signals, failure labels, repair history, and a validated asset-specific model." />
            <ReadinessItem title="Degradation curves" needs="A commissioning baseline, stable signal units, operating context, and a longer verified history." />
            <ReadinessItem title="OEE and capacity utilization" needs="Planned production time, run/stop state, rated throughput, actual cycles, and good/rejected counts." />
            <ReadinessItem title="Root-cause analysis" needs="Process state, batch/material, shift, event timestamps, and enough linked signals to validate causal relationships." />
            <ReadinessItem title="TCO, MTBF, and maintenance cost" needs="Purchase and operating costs, work orders, failure/repair timestamps, downtime cost, and energy tariffs." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Asset telemetry coverage</CardTitle><p className="text-sm text-muted-foreground">Pressure and vibration values retain each asset's mapped scale; compare those values within an asset unless units have been normalized.</p></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-4">Asset</th><th className="py-2 pr-4">Group</th><th className="py-2 pr-4">Samples</th><th className="py-2 pr-4">Mean power</th><th className="py-2 pr-4">Mean temperature</th><th className="py-2 pr-4">Mean pressure</th><th className="py-2 pr-4">Mean speed</th><th className="py-2">Last reading</th></tr></thead><tbody>
              {(analytics?.assets ?? []).map((asset) => <tr key={asset.assetId} className="border-b last:border-0"><td className="py-3 pr-4"><span className="font-medium">{asset.name}</span><span className="block max-w-64 truncate font-mono text-xs text-muted-foreground">{asset.assetId}</span></td><td className="py-3 pr-4">{groupValue(asset, groupBy)}</td><td className="py-3 pr-4">{asset.sampleCount}</td><td className="py-3 pr-4">{asset.avgPower === null ? "—" : `${Math.round(asset.avgPower)} W`}</td><td className="py-3 pr-4">{asset.avgTemperature === null ? "—" : `${asset.avgTemperature.toFixed(1)} °C`}</td><td className="py-3 pr-4">{asset.avgPressure === null ? "—" : asset.avgPressure.toFixed(2)}</td><td className="py-3 pr-4">{asset.avgRpm === null ? "—" : `${Math.round(asset.avgRpm)} rpm`}</td><td className="py-3">{asset.latestReadingAt ? format(new Date(asset.latestReadingAt), "MMM d, HH:mm") : "No readings"}</td></tr>)}
            </tbody></table>
            {!analyticsQuery.isLoading && analytics?.assets.every((asset) => asset.sampleCount === 0) && <p className="py-5 text-center text-muted-foreground">No readings are attributed to these AAS assets for the selected period.</p>}
          </CardContent>
        </Card>

        {coverageQuery.error && <p role="alert" className="text-sm text-destructive">Detailed sample coverage is unavailable. Retry to verify data gaps.</p>}
        {coverageQuery.data?.configured && <Card>
          <CardHeader><CardTitle>Sample coverage and gaps</CardTitle><p className="text-sm text-muted-foreground">Missing signals can limit comparisons. Gaps describe telemetry arrival, and do not measure factory downtime or production availability.</p></CardHeader>
          <CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Asset</th><th className="p-2">Readings</th><th className="p-2">Longest gap</th><th className="p-2">Signals present in readings</th></tr></thead><tbody>
            {coverageQuery.data.assets.map(asset => <tr key={asset.assetId} className="border-b"><td className="p-2">{assets.find(item => item.assetId === asset.assetId)?.name ?? asset.assetId}</td><td className="p-2">{asset.samples}</td><td className="p-2">{asset.longestGapMs === null ? "Needs two samples" : `${(asset.longestGapMs / 60000).toFixed(1)} min`}</td><td className="p-2">{asset.metrics.filter(metric => metric.samples > 0).map(metric => `${metric.metric}: ${Math.round(100 * metric.samples / asset.samples)}%`).join(" · ") || "No standard metrics"}</td></tr>)}
          </tbody></table>{!coverageQuery.data.assets.length && <p className="py-4">No readings in this period.</p>}</CardContent>
        </Card>}
        {assetSignalRows.length > 0 && <Card>
          <CardHeader>
            <CardTitle>Asset-specific signals</CardTitle>
            <p className="text-sm text-muted-foreground">Named signals are preserved from the gateway payload and aggregated per AAS asset. Units are included in the signal name when supplied by the device profile.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-4">Asset</th><th className="py-2 pr-4">Signal</th><th className="py-2 pr-4">Latest</th><th className="py-2 pr-4">Mean</th><th className="py-2">Latest sample</th></tr></thead><tbody>
              {assetSignalRows.map((signal) => <tr key={`${signal.assetId}:${signal.name}`} className="border-b last:border-0"><td className="py-3 pr-4">{signal.assetName}</td><td className="py-3 pr-4 font-mono text-xs">{signal.name}</td><td className="py-3 pr-4">{signal.latest.toFixed(2)}</td><td className="py-3 pr-4">{signal.average.toFixed(2)}</td><td className="py-3">{signal.latestAt ? format(new Date(signal.latestAt), "MMM d, HH:mm") : "—"}</td></tr>)}
            </tbody></table>
          </CardContent>
        </Card>}
      </>}
    </div>
  );
}

function MetricCard({ label, value, helper, icon }: { label: string; value: string | number; helper: string; icon: React.ReactNode }) {
  return <Card><CardContent className="flex items-start justify-between gap-3 p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{helper}</p></div><span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span></CardContent></Card>;
}

function formatShift(changePercent: number | null | undefined) {
  if (changePercent === null || changePercent === undefined || !Number.isFinite(changePercent)) return "Not enough samples";
  return `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(1)}%`;
}

function ReadinessItem({ title, needs }: { title: string; needs: string }) {
  return <div className="rounded-lg border p-4"><h3 className="font-medium">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{needs}</p><p className="mt-3 text-xs font-medium text-muted-foreground">Not calculated from current data</p></div>;
}

function AssetScopedMetricHint({ metric }: { metric: "pressure" | "vibration" }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">Select one asset to chart {metric}. Its engineering unit or scale can differ from other assets.</div>;
}

function ChartLoading() {
  return <div className="flex h-full items-center justify-center text-muted-foreground"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Loading telemetry…</div>;
}

function NoReadings() {
  return <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground"><BarChart3 className="h-10 w-10" /><p>No asset-attributed telemetry in the selected period.</p></div>;
}
