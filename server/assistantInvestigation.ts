import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  investigationContext,
  type InvestigationContext,
} from "../shared/assistant-investigation";
import { canonicalUnits, metrics, type Metric } from "../shared/measurements";
import type {
  AssistantSource,
  AssistantTrendSnapshot,
} from "../shared/assistant";
import { getDb, getDeviceById, getAlertById, getAssetsForDevice } from "./db";
import { demoOnlyRead, visibleRecordSql } from "./demoData";
import { snapshot as factorySnapshot } from "./factories";
import { observationTrend } from "./trends";
import { operationsSummary } from "./operations/store";
import { inventoryItemsByRefs } from "./inventory";
import { observationHref } from "../shared/inventory";
import { alarmConditionReasonLabel } from "../shared/alarm-condition";

/** Separate current condition from the last verified observation and review. */
export function incidentSourceSummary(incident: {
  currentCondition?: string;
  sourceCondition?: string;
  acknowledged?: boolean;
  conditionReason?: string | null;
  conditionValidUntil?: Date | string | null;
  conditionEvidence?: { occurredAt: number; value: number; unit: string } | null;
}) {
  const parts = [
    `Current source condition: ${incident.currentCondition ?? "unknown"}`,
    `acknowledgement: ${incident.acknowledged ? "acknowledged" : "unacknowledged"}`,
  ];
  const reason = alarmConditionReasonLabel(incident.conditionReason);
  if (reason) parts.push(reason);
  const proof = incident.conditionEvidence;
  const observedAt = proof ? new Date(proof.occurredAt) : null;
  if (proof && observedAt && Number.isFinite(observedAt.getTime()) && Number.isFinite(proof.value)) {
    parts.push(`Last verified source evidence: ${proof.value} ${proof.unit} at ${observedAt.toISOString()} (${incident.sourceCondition ?? "unknown"})`);
  } else parts.push("No verified source observation is recorded");
  if (incident.conditionValidUntil) {
    const time = new Date(incident.conditionValidUntil);
    if (Number.isFinite(time.getTime())) parts.push(`Evidence validity ends ${time.toISOString()}`);
  }
  return parts.join(". ") + ".";
}

export type InvestigationEvidence = {
  request: InvestigationContext;
  name: string;
  assetId?: string;
  deviceId?: number;
  incidentId?: number;
  from: number;
  to: number;
  scope: "operational" | "live" | "simulated" | "replay" | "unknown" | "all";
  metric: Metric;
  sources: Array<AssistantSource & { kind: "live-data" | "documentation" }>;
  trend: AssistantTrendSnapshot;
};
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "The investigation source is unavailable in this workspace.",
  });
const mismatch = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message:
      "The incident, equipment and factory selections do not refer to the same source.",
  });

async function loadScenarioEvidence(
  input: InvestigationContext,
): Promise<InvestigationEvidence> {
  if (!demoOnlyRead())
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Recorded scenario investigations are available in Demo mode.",
    });
  if (input.metric && !["pressure", "vibration"].includes(input.metric))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This recorded scenario has pressure and vibration evidence.",
    });
  if ((input.endTime ?? 0) > Date.now() + 60_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A recorded scenario window cannot be in the future.",
    });
  const operations = await operationsSummary({
    scenario: input.scenario,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  const evidence = operations.evidence;
  if (!evidence) throw unavailable();
  const from = operations.analysis.startTime,
    to = operations.analysis.endTime;
  const metric =
    input.metric ??
    (["pump-warning", "recovery"].includes(evidence.scenario)
      ? "vibration"
      : "pressure");
  const buckets = evidence.signals.map((point) => {
    const value =
      metric === "pressure"
        ? point.pressureBar == null
          ? null
          : point.pressureBar * 100_000
        : point.vibrationMmS;
    return { timestamp: point.at, value, count: value == null ? 0 : 1 };
  });
  const observed = buckets.filter(
    (point): point is typeof point & { value: number } => point.value != null,
  );
  const values = observed.map((point) => point.value),
    latest = observed.at(-1);
  const trend: AssistantTrendSnapshot = {
    scope: "simulated",
    metric,
    unit: canonicalUnits[metric],
    startTime: from,
    endTime: to,
    intervalMs: Math.max(1000, Math.floor((to - from) / 12)),
    total: buckets.length,
    verified: values.length,
    unverified: buckets.length - values.length,
    statisticsComplete: true,
    truncated: false,
    buckets,
    summary: {
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      average: values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : null,
      latest: latest?.value ?? null,
      latestAt: latest?.timestamp ?? null,
    },
  };
  const item = evidence.assetRef
    ? (await inventoryItemsByRefs([evidence.assetRef]))[0]
    : undefined;
  const assetId = item?.kind === "asset" ? item.identifier : undefined;
  const params = new URLSearchParams({
    otScenario: evidence.scenario,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });
  const analysis = operations.analysis;
  const show = (value: number | null, suffix: string) =>
    value == null ? "unavailable" : `${Number(value.toFixed(3))}${suffix}`;
  const sources: InvestigationEvidence["sources"] = [
    {
      title: evidence.title + " — recorded simulation",
      section: "Scenario evidence",
      path: "operations:scenario:" + evidence.scenario,
      href: "/analytics?" + params,
      timestamp: new Date(to).toISOString(),
      kind: "live-data",
      excerpt: `${new Date(from).toISOString()} – ${new Date(to).toISOString()}. Simulated scenario, separate from stored baseline telemetry. ${evidence.explanation} Operating state: ${evidence.operatingState}; asset condition: ${evidence.condition}; gateway: ${evidence.connectivity}. ${evidence.hypothesis ? "Hypothesis, not confirmed cause: " + evidence.hypothesis : "No physical root cause is established."} Next check: ${evidence.nextStep}`,
    },
    {
      title: "Scenario production and utility calculation",
      section: operations.configuration.boundaryLabel,
      path: "operations:production:" + evidence.scenario,
      href: "/analytics?" + params,
      timestamp: new Date(to).toISOString(),
      kind: "live-data",
      excerpt: `Simulated evidence over the same window. OEE: ${show(analysis.oee == null ? null : analysis.oee * 100, "%")}; unplanned downtime: ${show(analysis.unplannedDowntimeSeconds == null ? null : analysis.unplannedDowntimeSeconds / 60, " minutes")}; energy per good unit: ${show(analysis.energyPerGoodUnit, " kWh")}; recorded period coverage: ${show(analysis.coveragePercent, "%")}. ${analysis.reasons.join(" ")} Missing periods remain gaps. ${operations.notes.map((note) => "Handover: " + note.text + " Next step: " + note.nextStep).join(" ")}`,
    },
  ];
  return {
    request: input,
    name: evidence.title,
    assetId,
    from,
    to,
    scope: "simulated",
    metric,
    sources,
    trend,
  };
}

export async function loadInvestigationEvidence(
  raw: InvestigationContext,
  selectedAssetId?: string,
  factoryId?: string,
): Promise<InvestigationEvidence> {
  const input = investigationContext.parse(raw);
  if (input.scenario) {
    if (selectedAssetId) throw mismatch();
    return loadScenarioEvidence(input);
  }
  if (selectedAssetId && input.assetId && selectedAssetId !== input.assetId)
    throw mismatch();
  const incident = input.incidentId
    ? await getAlertById(input.incidentId)
    : undefined;
  if (input.incidentId && !incident) throw unavailable();
  if (input.deviceId && incident && input.deviceId !== incident.deviceId)
    throw mismatch();
  let assetId =
    input.assetId ?? selectedAssetId ?? incident?.assetId ?? undefined;
  if (incident?.assetId && assetId && incident.assetId !== assetId)
    throw mismatch();
  const deviceId = input.deviceId ?? incident?.deviceId;
  const device = deviceId ? await getDeviceById(deviceId) : undefined;
  if (deviceId && !device) throw unavailable();
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Investigation evidence is temporarily unavailable.",
    });
  const [asset] = assetId
    ? await db.execute<{ id: number; assetId: string; name: string }>(
        sql`select id,"assetId",name from assets where "assetId"=${assetId} and ${visibleRecordSql(sql`"isDemo"`)} limit 1`,
      )
    : [];
  if (assetId && !asset) throw unavailable();
  if (asset && deviceId && incident?.assetId !== asset.assetId) {
    const connected = await getAssetsForDevice(deviceId);
    if (!connected.some((item) => item.assetId === asset.assetId))
      throw mismatch();
  }
  if (factoryId) {
    const factory = await factorySnapshot(factoryId);
    if (
      asset &&
      !factory.items.some((item) => item.identifier === asset.assetId)
    )
      throw mismatch();
    if (
      deviceId &&
      !factory.items.some((item) => item.ref === "device:" + deviceId) &&
      !asset
    )
      throw mismatch();
  }
  const now = Date.now();
  const eventAt = incident ? new Date(incident.createdAt).getTime() : now;
  const to = input.endTime ?? Math.min(now, eventAt + 30 * 60_000);
  const from = input.startTime ?? Math.max(1, eventAt - 30 * 60_000);
  if (to > now + 300_000 || to <= from)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The investigation time window is invalid or in the future.",
    });
  const metric =
    input.metric ??
    (metrics.includes(incident?.metric as Metric)
      ? (incident!.metric as Metric)
      : "temperature");
  const scope = input.scope ?? (demoOnlyRead() ? "simulated" : "operational");
  if (demoOnlyRead() && scope !== "simulated")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A demo investigation must use simulated evidence.",
    });
  const trend = await observationTrend({
    ...(assetId ? { assetIds: [assetId] } : {}),
    ...(deviceId ? { deviceId } : {}),
    metric,
    startTime: from,
    endTime: to,
    scope,
    intervalMs: Math.max(60_000, Math.ceil((to - from) / 60)),
  });
  const name =
    asset && device
      ? `${asset.name} · ${device.name}`
      : (asset?.name ?? device?.name ?? "Selected equipment");
  const params = new URLSearchParams({
    metric,
    scope,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });
  if (assetId) params.set("asset", assetId);
  if (factoryId) params.set("factory", factoryId);
  const trendHref = deviceId
    ? observationHref({
        ref: `device:${deviceId}`,
        kind: "device",
        itemType: device!.type,
      }) +
      "?" +
      params
    : "/analytics?" + params;
  const window =
    new Date(from).toISOString() + " – " + new Date(to).toISOString();
  const values = trend.summary;
  const sources: Array<
    AssistantSource & { kind: "live-data" | "documentation" }
  > = [
    {
      title: name + " investigation window",
      section: metric + " · " + scope,
      path: "investigation:" + (assetId ?? "device:" + deviceId),
      href: trendHref,
      timestamp: new Date(to).toISOString(),
      excerpt: trend.verified
        ? window +
          ". " +
          trend.verified +
          " good-quality canonical observations of " +
          trend.total +
          " records. Minimum " +
          values.min +
          ", maximum " +
          values.max +
          ", average " +
          values.average +
          " " +
          canonicalUnits[metric] +
          ". Latest valid sample " +
          values.latest +
          " at " +
          new Date(values.latestAt!).toISOString() +
          ". Missing intervals remain gaps; observation count is not a time-coverage percentage."
        : window +
          ". No good-quality canonical " +
          metric +
          " values are available in this scope. " +
          trend.total +
          " records were considered; a missing value is not zero or a healthy condition.",
      kind: "live-data",
    },
  ];
  if (incident)
    sources.push({
      title: "Incident " + incident.id,
      section: "Recorded event and review",
      path: "incident:" + incident.id,
      href: "/alerts/" + incident.id,
      timestamp: new Date(incident.createdAt).toISOString(),
      excerpt:
        incident.message +
        ". Severity: " +
        incident.severity +
        "; review: " +
        incident.status +
        ". " + incidentSourceSummary(incident) +
        " Review and action status do not prove physical clearance. The trend window is evidence for investigation, not a confirmed causal diagnosis.",
      kind: "live-data",
    });
  return {
    request: input,
    name,
    assetId,
    deviceId,
    incidentId: incident?.id,
    from,
    to,
    scope,
    metric,
    sources,
    trend,
  };
}
export function investigationGroundedAnswer(
  evidence: InvestigationEvidence,
  offset = 0,
) {
  return [
    "## Selected investigation",
    evidence.name +
      " · " +
      evidence.metric +
      " · " +
      evidence.scope +
      " evidence.",
    ...evidence.sources.map(
      (source, i) => "- " + source.excerpt + " [" + (offset + i + 1) + "]",
    ),
    "## Next checks",
    evidence.trend.verified
      ? "Compare the change with the incident timing, configured limits and recent maintenance or configuration events. Check related process signals before recording a cause."
      : "Review the selected scope, source quality, units and acquisition configuration. Obtain trustworthy measurements before drawing an operational conclusion.",
    "An observed relationship does not establish the physical cause. Record the finding, its uncertainty and an owned follow-up in the incident.",
  ].join("\n\n");
}
