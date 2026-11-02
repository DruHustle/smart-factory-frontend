import {
  analyseProduction,
  operationScenarioLabels,
  resolveShift,
  type OperationScenario,
  type OperationsConfiguration,
  type OperationsSummary,
  type ProductionRecord,
  type ScenarioEvidence,
} from "../../shared/operations";
import type { Showcase } from "../../shared/showcase";

/** A named scenario never rewrites baseline telemetry. Its identity and time window travel with its evidence. */
export function demoOperations(
  scenario: OperationScenario,
  showcase: Showcase | null,
  requested?: { startTime: number; endTime: number },
): OperationsSummary {
  const anchor =
    showcase && Number.isFinite(Date.parse(showcase.anchor))
      ? Date.parse(showcase.anchor)
      : Date.UTC(2026, 9, 26, 10);
  const configuration: OperationsConfiguration = {
    timeZone: "Africa/Harare",
    shifts: [
      { id: "day", name: "Day shift", startMinute: 360 },
      { id: "evening", name: "Evening shift", startMinute: 840 },
      { id: "night", name: "Night shift", startMinute: 1320 },
    ],
    boundaryLabel: "Demonstration production line",
    countUnit: "units",
    currency: "USD",
    idealCycleSeconds: 6,
    energyMeterBoundary: "Demonstration production line",
  };
  const endTime = requested?.endTime ?? anchor,
    startTime = requested?.startTime ?? anchor - 3600000;
  const duration = endTime - startTime,
    eventAt = startTime + Math.floor(duration / 2);
  const downtime =
    scenario === "utility-loss"
      ? [
          {
            startTime: eventAt,
            endTime: eventAt + Math.floor(duration / 6),
            reason: "Low compressed-air pressure — cause under investigation",
            planned: false,
          },
        ]
      : scenario === "maintenance"
        ? [
            {
              startTime: eventAt,
              endTime,
              reason: "Scheduled inspection",
              planned: true,
            },
          ]
        : scenario === "recovery"
          ? [
              {
                startTime: startTime + Math.floor(duration / 6),
                endTime: startTime + Math.floor(duration / 4),
                reason: "Inspection and recovery",
                planned: false,
              },
            ]
          : [];
  const outage = scenario === "gateway-outage",
    runningSeconds =
      duration / 1000 -
      downtime.reduce((sum, d) => sum + (d.endTime - d.startTime) / 1000, 0);
  const rate =
    scenario === "utility-loss"
      ? 0.74
      : scenario === "pump-warning"
        ? 0.9
        : 0.96;
  const totalCount = Math.floor((runningSeconds / 6) * rate),
    goodCount = Math.floor(totalCount * 0.98);
  const record: ProductionRecord = {
    id: 1,
    boundaryLabel: configuration.boundaryLabel,
    startTime,
    endTime,
    product: "Demo product A",
    totalCount: outage ? null : totalCount,
    goodCount: outage ? null : goodCount,
    idealCycleSeconds: 6,
    meterStartKwh: 4000,
    meterEndKwh: outage
      ? null
      : 4000 + (duration / 3600000) * (scenario === "utility-loss" ? 14 : 10),
    meterBoundary: configuration.energyMeterBoundary,
    complete: !outage,
    evidence: `Recorded ${operationScenarioLabels[scenario].toLowerCase()} scenario; simulated counts and meter values over this exact boundary and interval.`,
    downtime,
    provenance: "simulated",
    author: "Smart Factory demonstration",
    recordedAt: new Date(endTime).toISOString(),
  };
  if (outage) record.meterStartKwh = null;
  const explanation = {
    healthy:
      "All simulated sources are current and the line is running within its configured demonstration limits.",
    "pump-warning":
      "The pump is still running while vibration exceeds the demonstration warning limit. Connection state remains independent of condition.",
    "utility-loss":
      "The recorded pressure drop coincides with lower output and a stop. These observations establish a correlation; they do not confirm a physical cause.",
    "gateway-outage":
      "The gateway stops reporting halfway through this window. Later process readings and production counts are unavailable; no machine stop is inferred.",
    maintenance:
      "A planned inspection removes the second half of this window from scheduled production. The line is intentionally in maintenance.",
    recovery:
      "Measurements return to their simulated normal range after an inspection. The follow-up remains visible for the next shift; improvement alone does not prove causation.",
  }[scenario];
  const nextStep = {
    healthy: "Review the next shift's planned work.",
    "pump-warning":
      "Inspect the documented pump vibration checks and record the observation.",
    "utility-loss":
      "Compare compressor pressure, line state, and recent work before assigning a confirmed cause.",
    "gateway-outage":
      "Check gateway delivery and source liveness before interpreting equipment state.",
    maintenance:
      "Record the inspection outcome before returning the equipment to service.",
    recovery:
      "Verify stable measurements in the next shift and close the follow-up only after recording the outcome.",
  }[scenario];
  const evidence: ScenarioEvidence = {
    scenario,
    title: operationScenarioLabels[scenario],
    explanation,
    assetRef: showcase?.assetRef ?? null,
    sensorRef: showcase?.sensorRef ?? null,
    gatewayRef: showcase?.gatewayRef ?? null,
    incidentId: showcase?.incidentId ?? null,
    condition: outage
      ? "unknown"
      : ["pump-warning", "utility-loss"].includes(scenario)
        ? "warning"
        : "normal",
    operatingState: outage
      ? "unknown"
      : scenario === "maintenance"
        ? "maintenance"
        : "running",
    connectivity: outage ? "disconnected" : "connected",
    hypothesis:
      scenario === "utility-loss"
        ? "Reduced compressed-air supply may contribute to the slowdown; inspect the equipment and corroborating measurements."
        : null,
    nextStep,
    signals: Array.from({ length: 13 }, (_, i) => {
      const at = startTime + Math.floor((duration * i) / 12),
        missing = outage && at >= eventAt;
      // The terminal plotting point carries the condition at the end of this
      // recorded window; it must not imply an unrecorded restart immediately
      // after maintenance. It is excluded from count integration below.
      const stopped = downtime.some(
        (d) =>
          at >= d.startTime &&
          (at < d.endTime || (at === endTime && d.endTime === endTime)),
      );
      return {
        at,
        pressureBar: missing
          ? null
          : (scenario === "utility-loss" && at >= eventAt) ||
              (scenario === "recovery" && stopped)
            ? 4.8
            : 6.4,
        vibrationMmS: missing
          ? null
          : (scenario === "pump-warning" && at >= eventAt) ||
              (scenario === "recovery" && stopped)
            ? 6.2
            : 2.1,
        outputPerMinute: missing
          ? null
          : stopped
            ? 0
            : scenario === "utility-loss" && at >= eventAt
              ? 7.4
              : scenario === "pump-warning"
                ? 9
                : 9.6,
      };
    }),
  };
  // Integrate the displayed step series; aggregate cards and scenario trends share the same inputs.
  record.totalCount = Math.floor(
    evidence.signals
      .slice(0, -1)
      .reduce(
        (sum, point, index) =>
          sum +
          ((point.outputPerMinute ?? 0) *
            (evidence.signals[index + 1].at - point.at)) /
            60000,
        0,
      ),
  );
  record.goodCount = Math.floor(record.totalCount * 0.98);
  if (outage) {
    record.endTime = eventAt;
    record.complete = true;
    record.meterStartKwh = 4000;
    record.meterEndKwh = 4000 + ((eventAt - startTime) / 3600000) * 10;
    record.evidence +=
      " Only the first half has recorded measurements; the later interval remains a coverage gap.";
  }
  const shift = resolveShift(configuration, endTime - 1);
  return {
    scope: { id: "demo", label: "Recorded OT scenario" },
    configured: true,
    configuration,
    version: 1,
    demo: true,
    shift,
    analysis: analyseProduction(
      [record],
      startTime,
      endTime,
      configuration.boundaryLabel,
    ),
    records: [record],
    notesHasMore: false,
    notes:
      scenario === "recovery"
        ? [
            {
              id: 1,
              shiftKey: shift.key,
              shiftStartTime: shift.startTime,
              shiftEndTime: shift.endTime,
              shiftName: shift.name,
              timeZone: shift.timeZone,
              text: "Inspection completed; pressure and vibration returned to the demonstrated normal range. Keep the follow-up open until the next shift confirms stability.",
              nextStep,
              assetRefs: showcase?.assetRef ? [showcase.assetRef] : [],
              incidentIds: [],
              author: "Demo shift engineer",
              createdAt: new Date(endTime).toISOString(),
            },
          ]
        : [],
    outstanding: [],
    evidence,
  };
}
