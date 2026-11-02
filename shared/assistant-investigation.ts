import { z } from "zod";
import { metrics, type Metric } from "./measurements";
import { operationScenarios } from "./operations";

export const investigationContext = z
  .object({
    assetId: z.string().trim().min(3).max(128).optional(),
    deviceId: z.number().int().positive().optional(),
    incidentId: z.number().int().positive().optional(),
    scenario: z.enum(operationScenarios).optional(),
    metric: z.enum(metrics as [Metric, ...Metric[]]).optional(),
    scope: z
      .enum(["operational", "live", "simulated", "replay", "unknown", "all"])
      .optional(),
    startTime: z.number().int().positive().optional(),
    endTime: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.assetId &&
      !value.deviceId &&
      !value.incidentId &&
      !value.scenario
    )
      context.addIssue({
        code: "custom",
        message: "Choose the equipment or incident for this investigation.",
      });
    if (
      value.scenario &&
      (value.assetId ||
        value.deviceId ||
        value.incidentId ||
        (value.scope && value.scope !== "simulated"))
    )
      context.addIssue({
        code: "custom",
        message:
          "Recorded scenarios use their own simulated evidence and cannot be combined with a baseline source or incident.",
      });
    if (
      (value.startTime == null) !== (value.endTime == null) ||
      (value.startTime != null &&
        value.endTime != null &&
        (value.endTime <= value.startTime ||
          value.endTime - value.startTime > 86400000))
    )
      context.addIssue({
        code: "custom",
        message: "Choose a complete investigation window of up to 24 hours.",
      });
  });
export type InvestigationContext = z.infer<typeof investigationContext>;
const names = {
  assetId: "asset",
  deviceId: "device",
  incidentId: "incident",
  scenario: "otScenario",
  metric: "metric",
  scope: "scope",
  startTime: "from",
  endTime: "to",
} as const;

export function investigationKey(value?: InvestigationContext) {
  return value ? JSON.stringify(investigationContext.parse(value)) : "";
}
export function assistantInvestigationHref(
  value: InvestigationContext,
  factoryId?: string | null,
) {
  const context = investigationContext.parse(value);
  const query = new URLSearchParams();
  for (const [key, name] of Object.entries(names)) {
    const field = context[key as keyof InvestigationContext];
    if (field != null) query.set(name, String(field));
  }
  if (factoryId) query.set("factory", factoryId);
  return "/assistant?" + query.toString();
}
/** Reject malformed links visibly instead of silently broadening an evidence request. */
export function investigationFromSearch(query: URLSearchParams): {
  context?: InvestigationContext;
  error?: string;
} {
  if (
    !["device", "incident", "otScenario", "metric", "scope", "from", "to"].some(
      (key) => query.has(key),
    )
  )
    return {};
  const value: Record<string, unknown> = {};
  for (const [key, name] of Object.entries(names)) {
    if (!query.has(name)) continue;
    value[key] = ["deviceId", "incidentId", "startTime", "endTime"].includes(
      key,
    )
      ? Number(query.get(name))
      : query.get(name);
  }
  const parsed = investigationContext.safeParse(value);
  return parsed.success
    ? { context: parsed.data }
    : {
        error:
          "This investigation link is incomplete or invalid. Return to the source and select a window of up to 24 hours.",
      };
}
