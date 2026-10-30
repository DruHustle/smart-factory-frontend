import { observationTrend } from "./trends";
import { requestedAssistantMetric } from "../shared/assistant-conversation";
/** These bounded descriptors come only from authorized stored records, never completion text. */
import { sql } from "drizzle-orm";
import * as db from "./db";
import { visibleRecordSql } from "./demoData";
import {
  assistantPresentation,
  validatedAssistantPresentation,
  type AssistantSource,
  type AssistantPresentation,
} from "../shared/assistant";
import {
  canonicalUnits,
  metrics,
  convertMeasurement,
  type Metric,
} from "../shared/measurements";
import type { AssistantRuntime } from "./assistantKnowledge";
const workflowQuestion =
  /\b(how|steps|import|provision|configure|oidc|aasx|permissions|roles)\b/i;
const operationalQuestion =
  /\b(why|attention|threshold|temperature|humidity|vibration|pressure|power|rpm|stale|latest|reading|incident|trend)\b/i;
export async function buildAssistantPresentation(
  question: string,
  runtime: AssistantRuntime,
  sources: AssistantSource[],
): Promise<AssistantPresentation | undefined> {
  const workflow =
    workflowQuestion.test(question) && !operationalQuestion.test(question);
  const candidate = runtime.payload?.assets[0];
  const asset =
    candidate &&
    (runtime.payload?.selectionReason !== "overview-sample" ||
      (runtime.payload?.assets.length === 1 && !workflow))
      ? candidate
      : undefined;
  const result: AssistantPresentation = {
    version: 1,
    format: workflow ? "workflow" : "operational",
    context: asset
      ? {
          ref: `asset:${asset.id}`,
          assetId: asset.aasId,
          name: asset.name,
          itemType: asset.type,
          location: asset.location ?? null,
          isDemo: asset.demoData,
          equipmentId: null,
          componentId: null,
          componentName: null,
        }
      : null,
    events: [],
    workflow: [],
  };
  let modelBindings: Array<{
      sourceKey: string;
      templateComponentId: string;
      unit: string;
    }> = [],
    modelComponents: Array<{
      templateComponentId: string;
      installedComponentId: string;
      name: string;
    }> = [],
    modelSource: string | null = null;
  if (asset)
    try {
      const conn = await db.getDb();
      if (conn) {
        const [w] = await conn.execute<{
          id: string;
          is_standalone: boolean;
          source_device_id: string | null;
          bindings: typeof modelBindings;
          components: typeof modelComponents;
        }>(
          sql`select id,is_standalone,source_device_id,bindings,components from equipment_workspaces where asset_id=${asset.id} and ${visibleRecordSql(sql`is_demo`)} limit 1`,
        );
        if (w) {
          result.context!.equipmentId = w.id;
          modelBindings = Array.isArray(w.bindings)
            ? w.bindings.filter(
                (b) =>
                  b &&
                  typeof b.sourceKey === "string" &&
                  typeof b.templateComponentId === "string" &&
                  typeof b.unit === "string",
              )
            : [];
          modelComponents = Array.isArray(w.components)
            ? w.components.filter(
                (c) =>
                  c &&
                  typeof c.templateComponentId === "string" &&
                  typeof c.installedComponentId === "string" &&
                  typeof c.name === "string",
              )
            : [];
          modelSource = w.source_device_id;
          if (w.is_standalone) result.context!.ref = `equipment:${w.id}`;
        }
      }
    } catch {
      /* A missing representation never prevents an ordinary text answer. */
    }
  if (workflow) {
    const relevant = sources.some((s) => s.kind === "documentation");
    if (relevant && /\b(aas|aasx|import|asset|provision)\b/i.test(question))
      result.workflow = [
        { label: "Open Assets & devices", href: "/inventory" },
        {
          label: "Review identity and AAS submodels",
          href: result.context
            ? `/inventory/${result.context.ref}/aas`
            : "/inventory",
        },
        {
          label: "Review commissioning and source evidence",
          href: "/monitoring",
        },
      ];
  } else if (asset) {
    const observed = asset.latestObservation?.telemetry,
      requestedMetric = requestedAssistantMetric(question),
      measurement = observed?.measurements.find(
        (m) =>
          (!requestedMetric || m.metric === requestedMetric) &&
          m.quality === "good" &&
          m.value != null &&
          m.unit === canonicalUnits[m.metric as Metric],
      );
    const occurred = observed ? Date.parse(observed.timestamp) : NaN;
    if (
      observed &&
      measurement &&
      Number.isFinite(occurred) &&
      occurred > 0 &&
      occurred <= Date.now() + 300000 &&
      ["live", "simulated", "replay", "unknown"].includes(observed.mode)
    ) {
      const sourceNumber =
        sources.findIndex((s) => s.path === `asset:${asset.id}`) + 1;
      result.trend = {
        assetId: asset.aasId,
        metric: measurement.metric as Metric,
        scope: observed.mode as "live" | "simulated" | "replay" | "unknown",
        from: occurred - 3600000,
        to: occurred,
        latest: {
          value: measurement.value!,
          unit: measurement.unit!,
          occurredAt: observed.timestamp,
          receivedAt: observed.receivedAt,
          source: asset.latestObservation!.sourceDeviceId,
          quality: measurement.quality,
          freshness: "unknown",
        },
        sourceNumbers: sourceNumber ? [sourceNumber] : [],
      };
      try {
        result.trend.snapshot = await observationTrend({
          assetIds: [asset.aasId],
          metric: result.trend.metric,
          scope: result.trend.scope,
          startTime: result.trend.from,
          endTime: result.trend.to,
          intervalMs: 60000,
        });
      } catch {} // Missing chart history stays unavailable; never derive a series from prose.
      if (modelSource === asset.latestObservation!.sourceDeviceId) {
        const binding = modelBindings.find(
          (b) => b.sourceKey === measurement.metric,
        );
        if (binding)
          try {
            convertMeasurement(measurement.metric as Metric, 1, binding.unit);
            const component = modelComponents.find(
              (c) => c.templateComponentId === binding.templateComponentId,
            );
            if (component) {
              result.context!.componentId = component.installedComponentId;
              result.context!.componentName = component.name;
            }
          } catch {}
      }
      try {
        const device = await db.getDeviceByDeviceId(
          asset.latestObservation!.sourceDeviceId,
        );
        if (device) {
          result.trend.latest.source = device.name;
          const rules = await db.getAlertThresholds(device.id),
            rule = rules.find(
              (r) =>
                r.enabled &&
                r.metric === measurement.metric &&
                r.unit === measurement.unit,
            ),
            limit =
              rule?.warningMax ??
              rule?.maxValue ??
              rule?.warningMin ??
              rule?.minValue;
          if (rule && limit != null && Number.isFinite(limit)) {
            const label =
              rule.warningMax != null
                ? "Source warning maximum"
                : rule.maxValue != null
                  ? "Source maximum"
                  : rule.warningMin != null
                    ? "Source warning minimum"
                    : "Source minimum";
            result.trend.threshold = { value: limit, unit: rule.unit!, label };
            sources.push({
              title: `${device.name} configured threshold`,
              section: `${measurement.metric} · ${label.toLowerCase()}`,
              path: `threshold:${rule.id}`,
              href: `/inventory/device:${device.id}/overview`,
              timestamp: rule.updatedAt.toISOString(),
              excerpt: `${label}: ${limit} ${rule.unit}. This is the configured source rule, not evidence of a physical cause.`,
              kind: "live-data",
            });
            result.trend.sourceNumbers.push(sources.length);
          }
          const evidence = observed.eligibility as {
            eligible?: boolean;
            validForMs?: number;
          } | null;
          const age = Date.now() - occurred,
            validFor = evidence?.validForMs;
          result.trend.latest.freshness =
            validFor && Number.isFinite(validFor) && age >= 0
              ? evidence?.eligible &&
                observed.mode === "live" &&
                age <= validFor
                ? "current"
                : "stale"
              : "unknown";
        }
      } catch {}
    }
    const incidents = [
      ...new Map(
        asset.connectedDevices
          .flatMap((d) => d.recentIncidents)
          .map((i) => [i.id, i]),
      ).values(),
    ].slice(0, 6);
    result.events = incidents
      .filter((i) => i.createdAt)
      .map((i) => ({
        id: i.id,
        at: i.createdAt!,
        title: i.message,
        severity: i.severity,
        status: i.status,
        sourceNumbers: sources
          .map((s, n) => (s.path === `incident:${i.id}` ? n + 1 : 0))
          .filter(Boolean),
      }));
  }
  return validatedAssistantPresentation(result, sources.length);
}

export async function assistantAssetContext(
  assetId: string,
): Promise<AssistantPresentation["context"]> {
  const conn = await db.getDb();
  if (!conn) return null;
  const [a] = await conn.execute<{
    id: number;
    assetId: string;
    name: string;
    assetType: string;
    location: string | null;
    isDemo: boolean;
    equipmentId: string | null;
    standalone: boolean | null;
  }>(
    sql`select a.id,a."assetId",a.name,a."assetType",a.location,a."isDemo",w.id as "equipmentId",w.is_standalone as standalone from assets a left join equipment_workspaces w on w.asset_id=a.id and ${visibleRecordSql(sql`w.is_demo`)} where a."assetId"=${assetId} and ${visibleRecordSql(sql`a."isDemo"`)} limit 1`,
  );
  return a
    ? {
        ref: a.standalone ? `equipment:${a.equipmentId}` : `asset:${a.id}`,
        assetId: a.assetId,
        name: a.name,
        itemType: a.assetType,
        location: a.location,
        isDemo: a.isDemo,
        equipmentId: a.equipmentId,
        componentId: null,
        componentName: null,
      }
    : null;
}
