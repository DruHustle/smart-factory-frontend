import { z } from "zod";
import type { OperationScenario } from "./operation-scenarios";
export {
  operationScenarios,
  operationScenarioLabels,
} from "./operation-scenarios";
export type { OperationScenario } from "./operation-scenarios";
export const operationScope = z
  .object({ factoryId: z.uuid().optional() })
  .strict();
const minute = z.number().int().min(0).max(1439);
export const siteTimeZone = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone, for example Africa/Harare or Europe/Berlin.");
export const operationsConfiguration = z
  .object({
    timeZone: siteTimeZone,
    shifts: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,32}$/),
            name: z.string().trim().min(1).max(60),
            startMinute: minute,
          })
          .strict(),
      )
      .min(1)
      .max(8),
    boundaryLabel: z.string().trim().min(1).max(120),
    countUnit: z.string().trim().min(1).max(24),
    currency: z.string().regex(/^[A-Z]{3}$/),
    idealCycleSeconds: z.number().finite().positive().max(86400).nullable(),
    energyMeterBoundary: z.string().trim().max(120),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.shifts.map((s) => s.id)).size !== v.shifts.length ||
      new Set(v.shifts.map((s) => s.startMinute)).size !== v.shifts.length
    )
      c.addIssue({
        code: "custom",
        message: "Shift identifiers and start times must be distinct.",
        path: ["shifts"],
      });
  });
export type OperationsConfiguration = z.infer<typeof operationsConfiguration>;
export const defaultOperationsConfiguration: OperationsConfiguration = {
  timeZone: "UTC",
  shifts: [
    { id: "day", name: "Day", startMinute: 360 },
    { id: "evening", name: "Evening", startMinute: 840 },
    { id: "night", name: "Night", startMinute: 1320 },
  ],
  boundaryLabel: "",
  countUnit: "units",
  currency: "USD",
  idealCycleSeconds: null,
  energyMeterBoundary: "",
};
const timestamp = z.number().int().positive().max(8640000000000000);
export const productionPeriod = z
  .object({
    startTime: timestamp,
    endTime: timestamp,
    product: z.string().trim().min(1).max(120),
    totalCount: z.number().int().min(0).max(1e12).nullable(),
    goodCount: z.number().int().min(0).max(1e12).nullable(),
    idealCycleSeconds: z.number().finite().positive().max(86400).nullable(),
    meterStartKwh: z.number().finite().min(0).max(1e15).nullable(),
    meterEndKwh: z.number().finite().min(0).max(1e15).nullable(),
    meterBoundary: z.string().trim().max(120),
    complete: z.boolean(),
    evidence: z.string().trim().min(1).max(2000),
    downtime: z
      .array(
        z
          .object({
            startTime: timestamp,
            endTime: timestamp,
            reason: z.string().trim().min(1).max(120),
            planned: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.endTime <= v.startTime || v.endTime - v.startTime > 7 * 86400000)
      c.addIssue({
        code: "custom",
        message:
          "Enter an ordered production period no longer than seven days.",
        path: ["endTime"],
      });
    if (
      v.goodCount != null &&
      (v.totalCount == null || v.goodCount > v.totalCount)
    )
      c.addIssue({
        code: "custom",
        message: "Good count requires a total count and cannot exceed it.",
        path: ["goodCount"],
      });
    if ((v.meterStartKwh == null) !== (v.meterEndKwh == null))
      c.addIssue({
        code: "custom",
        message: "Provide both meter readings or leave both unavailable.",
        path: ["meterEndKwh"],
      });
    v.downtime.forEach((d, i) => {
      if (
        d.endTime <= d.startTime ||
        d.startTime < v.startTime ||
        d.endTime > v.endTime
      )
        c.addIssue({
          code: "custom",
          message:
            "Each stop must be ordered and contained within its production period.",
          path: ["downtime", i],
        });
    });
  });
export type ProductionPeriod = z.infer<typeof productionPeriod>;
export type ProductionRecord = ProductionPeriod & {
  id: number;
  boundaryLabel: string;
  provenance: "manual" | "simulated";
  recordedAt: string;
  author: string;
};
export type ShiftWindow = {
  id: string;
  key: string;
  name: string;
  startTime: number;
  endTime: number;
  timeZone: string;
  boundaryPolicy: string;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 64)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}
const civilEpoch = (p: ReturnType<typeof localParts>) =>
  Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
/** Same deterministic DST policy as compatible calendar arithmetic: earlier fold, gap advanced by its offset. */
function civilInstant(day: number, startMinute: number, timeZone: string) {
  const wanted = day + startMinute * 60000;
  const offsets = new Set(
    [-36, -12, 0, 12, 36].map((hours) => {
      const sample = wanted + hours * 3600000;
      return civilEpoch(localParts(sample, timeZone)) - sample;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wanted - offset)
    .sort((a, b) => a - b);
  const exact = candidates.filter(
    (at) => civilEpoch(localParts(at, timeZone)) === wanted,
  );
  if (exact.length) return exact[0];
  const after = candidates.filter(
    (at) => civilEpoch(localParts(at, timeZone)) > wanted,
  );
  if (!after.length)
    throw new Error("Unable to resolve shift boundary in this timezone.");
  return after.sort(
    (a, b) =>
      civilEpoch(localParts(a, timeZone)) - civilEpoch(localParts(b, timeZone)),
  )[0];
}
export function resolveShift(
  config: OperationsConfiguration,
  at: number,
): ShiftWindow {
  const local = localParts(at, config.timeZone),
    today = Date.UTC(local.year, local.month - 1, local.day);
  const boundaries = [-1, 0, 1, 2]
    .flatMap((offset) =>
      config.shifts.map((shift) => ({
        shift,
        at: civilInstant(
          today + offset * 86400000,
          shift.startMinute,
          config.timeZone,
        ),
      })),
    )
    .sort((a, b) => a.at - b.at);
  const index = boundaries.findIndex(
    (b, i) => b.at <= at && boundaries[i + 1]?.at > at,
  );
  if (index < 0)
    throw new Error("No configured shift covers the selected instant.");
  const current = boundaries[index];
  return {
    id: current.shift.id,
    key: `${current.shift.id}:${new Date(current.at).toISOString()}`,
    name: current.shift.name,
    startTime: current.at,
    endTime: boundaries[index + 1].at,
    timeZone: config.timeZone,
    boundaryPolicy:
      "Local shift starts; repeated times use their first occurrence and missing times advance by the DST gap.",
  };
}

export function counterDelta(
  start: number | null,
  end: number | null,
): { value: number | null; reason: string | null } {
  if (start == null || end == null)
    return { value: null, reason: "Meter readings are missing." };
  if (end < start)
    return {
      value: null,
      reason:
        "Meter reset or rollover: supply separate aligned periods before calculating consumption.",
    };
  return { value: end - start, reason: null };
}

export type ProductionAnalysis = {
  startTime: number;
  endTime: number;
  coveragePercent: number;
  recordedSeconds: number;
  plannedProductionSeconds: number | null;
  operatingSeconds: number | null;
  unplannedDowntimeSeconds: number | null;
  totalCount: number | null;
  goodCount: number | null;
  energyKwh: number | null;
  energyPerGoodUnit: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  reasons: string[];
  downtimeReasons: Array<{
    reason: string;
    seconds: number;
    occurrences: number;
    recordIds: number[];
  }>;
  recordIds: number[];
  excludedRecordIds: number[];
  provenance: Array<"manual" | "simulated">;
};
function recordTime(record: ProductionRecord) {
  const points = [
    ...new Set([
      record.startTime,
      record.endTime,
      ...record.downtime.flatMap((d) => [d.startTime, d.endTime]),
    ]),
  ].sort((a, b) => a - b);
  let planned = 0,
    running = 0;
  const reasons = new Map<string, number>();
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i],
      to = points[i + 1],
      seconds = (to - from) / 1000;
    const stops = record.downtime.filter(
      (d) => d.startTime < to && d.endTime > from,
    );
    if (stops.some((d) => d.planned)) continue;
    planned += seconds;
    const stop = stops.sort(
      (a, b) => a.startTime - b.startTime || a.reason.localeCompare(b.reason),
    )[0];
    if (stop)
      reasons.set(stop.reason, (reasons.get(stop.reason) ?? 0) + seconds);
    else running += seconds;
  }
  return { planned, running, reasons };
}
/** Counts are never prorated across a boundary. Overlapping periods fail closed instead of being double-counted. */
export function analyseProduction(
  records: ProductionRecord[],
  startTime: number,
  endTime: number,
  boundaryLabel: string,
): ProductionAnalysis {
  const relevant = records
    .filter((r) => r.endTime > startTime && r.startTime < endTime)
    .sort((a, b) => a.startTime - b.startTime || a.id - b.id);
  const included = relevant.filter(
    (r) =>
      r.startTime >= startTime &&
      r.endTime <= endTime &&
      r.boundaryLabel === boundaryLabel,
  );
  const reasons = new Set<string>();
  const empty: ProductionAnalysis = {
    startTime,
    endTime,
    coveragePercent: 0,
    recordedSeconds: 0,
    plannedProductionSeconds: null,
    operatingSeconds: null,
    unplannedDowntimeSeconds: null,
    totalCount: null,
    goodCount: null,
    energyKwh: null,
    energyPerGoodUnit: null,
    availability: null,
    performance: null,
    quality: null,
    oee: null,
    reasons: [],
    downtimeReasons: [],
    recordIds: included.map((r) => r.id),
    excludedRecordIds: relevant
      .filter((r) => !included.includes(r))
      .map((r) => r.id),
    provenance: [...new Set(included.map((r) => r.provenance))],
  };
  if (endTime <= startTime || !included.length)
    return {
      ...empty,
      reasons: [
        "No complete production periods are available within this window and boundary. Counts are not prorated.",
      ],
    };
  if (included.some((r, i) => i > 0 && r.startTime < included[i - 1].endTime))
    return {
      ...empty,
      reasons: [
        "Overlapping production periods must be reconciled before calculating metrics.",
      ],
    };
  const recordedSeconds = included.reduce(
    (sum, r) => sum + (r.endTime - r.startTime) / 1000,
    0,
  );
  const coveragePercent = Math.min(
    100,
    (recordedSeconds / ((endTime - startTime) / 1000)) * 100,
  );
  if (coveragePercent < 99.999 || included.some((r) => !r.complete))
    reasons.add(
      "Incomplete coverage: OEE is unavailable for the selected window.",
    );
  if (empty.excludedRecordIds.length)
    reasons.add(
      "Boundary-crossing or differently scoped periods are excluded; their counts are not prorated.",
    );
  const times = included.map(recordTime),
    plannedProductionSeconds = times.reduce((sum, t) => sum + t.planned, 0),
    operatingSeconds = times.reduce((sum, t) => sum + t.running, 0);
  const totalCount = included.every((r) => r.totalCount != null)
    ? included.reduce((sum, r) => sum + r.totalCount!, 0)
    : null;
  const goodCount = included.every((r) => r.goodCount != null)
    ? included.reduce((sum, r) => sum + r.goodCount!, 0)
    : null;
  if (totalCount == null || goodCount == null)
    reasons.add(
      "Production and good counts are required for complete quality/OEE calculations.",
    );
  const idealSeconds = included.every(
    (r) => r.idealCycleSeconds != null && r.totalCount != null,
  )
    ? included.reduce((sum, r) => sum + r.idealCycleSeconds! * r.totalCount!, 0)
    : null;
  if (idealSeconds == null)
    reasons.add("An ideal cycle time is required for every product period.");
  let performance =
    idealSeconds != null && operatingSeconds > 0
      ? idealSeconds / operatingSeconds
      : null;
  if (performance != null && performance > 1.000001) {
    reasons.add(
      "Counts or ideal cycle times imply performance above 100%; review the recorded inputs.",
    );
    performance = null;
  }
  if (!plannedProductionSeconds)
    reasons.add("No planned production time in this window.");
  if (!operatingSeconds && (totalCount ?? 0) > 0)
    reasons.add("Recorded output conflicts with zero operating time.");
  const availability =
    plannedProductionSeconds > 0
      ? operatingSeconds / plannedProductionSeconds
      : null;
  const quality =
    totalCount != null && totalCount > 0 && goodCount != null
      ? goodCount / totalCount
      : null;
  const meterValues = included.map((r) => {
    if (!r.meterBoundary || r.meterBoundary !== r.boundaryLabel) {
      reasons.add(
        "Energy intensity requires the meter and production to cover the same configured boundary.",
      );
      return null;
    }
    const delta = counterDelta(r.meterStartKwh, r.meterEndKwh);
    if (delta.reason) reasons.add(delta.reason);
    return delta.value;
  });
  const energyKwh = meterValues.every((v) => v != null)
    ? meterValues.reduce<number>((sum, v) => sum + v!, 0)
    : null;
  const eligible =
    coveragePercent >= 99.999 &&
    included.every((r) => r.complete) &&
    empty.excludedRecordIds.length === 0;
  const oee =
    eligible && availability != null && performance != null && quality != null
      ? availability * performance * quality
      : null;
  const buckets = new Map<
    string,
    {
      reason: string;
      seconds: number;
      occurrences: number;
      recordIds: number[];
    }
  >();
  times.forEach((t, i) =>
    t.reasons.forEach((seconds, reason) => {
      const bucket = buckets.get(reason) ?? {
        reason,
        seconds: 0,
        occurrences: 0,
        recordIds: [],
      };
      bucket.seconds += seconds;
      bucket.occurrences += included[i].downtime.filter(
        (d) => !d.planned && d.reason === reason,
      ).length;
      bucket.recordIds.push(included[i].id);
      buckets.set(reason, bucket);
    }),
  );
  return {
    ...empty,
    coveragePercent,
    recordedSeconds,
    plannedProductionSeconds,
    operatingSeconds,
    unplannedDowntimeSeconds: plannedProductionSeconds - operatingSeconds,
    totalCount,
    goodCount,
    energyKwh,
    energyPerGoodUnit:
      eligible && goodCount != null && goodCount > 0 && energyKwh != null
        ? energyKwh / goodCount
        : null,
    availability,
    performance,
    quality,
    oee,
    reasons: [...reasons],
    downtimeReasons: [...buckets.values()].sort(
      (a, b) => b.seconds - a.seconds || a.reason.localeCompare(b.reason),
    ),
  };
}

export type HandoverNote = {
  id: number;
  shiftKey: string;
  shiftStartTime: number;
  shiftEndTime: number;
  shiftName: string;
  timeZone: string;
  text: string;
  nextStep: string;
  assetRefs: string[];
  incidentIds: number[];
  author: string;
  createdAt: string;
};
export type ScenarioEvidence = {
  scenario: OperationScenario;
  title: string;
  explanation: string;
  assetRef: string | null;
  sensorRef: string | null;
  gatewayRef: string | null;
  incidentId: number | null;
  condition: "normal" | "warning" | "unknown";
  operatingState: "running" | "maintenance" | "unknown";
  connectivity: "connected" | "disconnected";
  hypothesis: string | null;
  nextStep: string;
  signals: Array<{
    at: number;
    pressureBar: number | null;
    vibrationMmS: number | null;
    outputPerMinute: number | null;
  }>;
};
export type OperationsSummary = {
  scope: { id: string; label: string };
  configured: boolean;
  configuration: OperationsConfiguration;
  version: number;
  demo: boolean;
  shift: ShiftWindow;
  analysis: ProductionAnalysis;
  records: ProductionRecord[];
  notes: HandoverNote[];
  notesHasMore: boolean;
  outstanding: Array<{
    id: number;
    incidentId: number;
    title: string;
    owner: string | null;
    dueDate: string | null;
    status: string;
  }>;
  evidence: ScenarioEvidence | null;
};
