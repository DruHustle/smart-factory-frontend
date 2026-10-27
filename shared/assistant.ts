import { z } from "zod";
import { canonicalUnits, type Metric } from "./measurements";
export type AssistantSource = {
  title: string;
  section: string;
  path: string;
  href?: string;
  timestamp?: string;
  excerpt: string;
  kind?: "documentation" | "live-data";
};
const metric = z.enum(Object.keys(canonicalUnits) as [Metric, ...Metric[]]);
const sourceNumbers = z.array(z.number().int().min(1).max(32)).max(8);
const nullableNumber = z.number().finite().nullable();
export const assistantTrendSnapshot = z
  .object({
    scope: z.enum([
      "operational",
      "live",
      "simulated",
      "replay",
      "unknown",
      "all",
    ]),
    metric,
    unit: z.string().max(32),
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
    intervalMs: z.number().int().min(1000),
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    statisticsComplete: z.literal(true),
    truncated: z.literal(false),
    summary: z
      .object({
        min: nullableNumber,
        max: nullableNumber,
        average: nullableNumber,
        latest: nullableNumber,
        latestAt: nullableNumber,
      })
      .strict(),
    buckets: z
      .array(
        z
          .object({
            timestamp: z.number().int().positive(),
            value: nullableNumber,
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(61),
  })
  .strict()
  .refine(
    (s) =>
      s.endTime > s.startTime &&
      s.endTime - s.startTime <= 86400000 &&
      s.unit === canonicalUnits[s.metric] &&
      s.verified + s.unverified === s.total &&
      s.buckets.every(
        (b, i) =>
          b.timestamp >= s.startTime &&
          b.timestamp <= s.endTime &&
          (!i || b.timestamp > s.buckets[i - 1].timestamp) &&
          (b.value == null ? b.count === 0 : b.count > 0),
      ),
    "Inconsistent bounded observation snapshot",
  );
export type AssistantTrendSnapshot = z.infer<typeof assistantTrendSnapshot>;
export const assistantPresentation = z
  .object({
    version: z.literal(1),
    format: z.enum(["operational", "workflow"]),
    context: z
      .object({
        ref: z.string().regex(/^(asset:[1-9]\d*|equipment:[a-f0-9-]{36})$/),
        assetId: z.string().min(1).max(128),
        name: z.string().max(255),
        itemType: z.string().max(80),
        location: z.string().max(255).nullable(),
        isDemo: z.boolean(),
        equipmentId: z.uuid().nullable(),
        componentId: z.uuid().nullable(),
        componentName: z.string().max(255).nullable(),
      })
      .strict()
      .nullable(),
    trend: z
      .object({
        assetId: z.string().max(128),
        metric,
        scope: z.enum(["live", "simulated", "replay", "unknown"]),
        from: z.number().int().positive(),
        to: z.number().int().positive(),
        latest: z
          .object({
            value: z.number().finite(),
            unit: z.string().max(32),
            occurredAt: z.string().datetime(),
            receivedAt: z.string().datetime(),
            source: z.string().max(255),
            quality: z.string().max(24),
            freshness: z.enum(["current", "stale", "unknown"]),
          })
          .strict(),
        threshold: z
          .object({
            value: z.number().finite(),
            unit: z.string().max(32),
            label: z.string().max(80),
          })
          .strict()
          .optional(),
        sourceNumbers,
        snapshot: assistantTrendSnapshot.optional(),
      })
      .strict()
      .refine((t) => t.to > t.from && t.to - t.from <= 86400000),
    events: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            at: z.string().max(40),
            title: z.string().max(280),
            severity: z.string().max(24),
            status: z.string().max(24),
            sourceNumbers,
          })
          .strict(),
      )
      .max(6),
    workflow: z
      .array(
        z
          .object({
            label: z.string().max(100),
            href: z
              .string()
              .max(250)
              .refine((h) => assistantLink(h)?.kind === "internal")
              .optional(),
          })
          .strict(),
      )
      .max(4),
  })
  .partial({ trend: true })
  .strict()
  .refine(
    (p) =>
      !p.trend ||
      (!!p.context &&
        p.trend.assetId === p.context.assetId &&
        p.trend.latest.unit === canonicalUnits[p.trend.metric] &&
        (!p.trend.threshold ||
          p.trend.threshold.unit === p.trend.latest.unit) &&
        (!p.trend.snapshot ||
          (p.trend.snapshot.metric === p.trend.metric &&
            p.trend.snapshot.unit === p.trend.latest.unit &&
            p.trend.snapshot.scope === p.trend.scope &&
            p.trend.snapshot.startTime === p.trend.from &&
            p.trend.snapshot.endTime === p.trend.to))),
    "Visual evidence must retain its authorized equipment, units and window",
  );
export type AssistantPresentation = z.infer<typeof assistantPresentation>;
export type AssistantAnswer = {
  answer: string;
  sources: AssistantSource[];
  contextAt: string;
  presentation?: AssistantPresentation;
};
export function validatedAssistantPresentation(
  value: unknown,
  sourceCount: number,
): AssistantPresentation | undefined {
  const parsed = assistantPresentation.safeParse(value);
  if (!parsed.success) return undefined;
  const references = [
    ...(parsed.data.trend?.sourceNumbers ?? []),
    ...parsed.data.events.flatMap((e) => e.sourceNumbers),
  ];
  return references.every((n) => n <= sourceCount) ? parsed.data : undefined;
}
/** Only application routes are treated as internal navigation, never API or executable paths. */
export function assistantLink(
  raw: string | undefined,
): { kind: "internal" | "external"; href: string } | null {
  if (!raw || raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw)) return null;
  const route = raw.replace(/^\/#/, "").replace(/^#/, "");
  if (
    /^\/(?:inventory|assets|devices|equipment|monitoring|alerts|notifications|analytics|cybersecurity|assistant|administration|demo|ota|passport)(?:[/?#]|$)/.test(
      route,
    ) &&
    !route.startsWith("//")
  )
    return { kind: "internal", href: route };
  try {
    const url = new URL(raw);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return { kind: "external", href: url.href };
  } catch {}
  return null;
}
