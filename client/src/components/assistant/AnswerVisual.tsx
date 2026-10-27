import { Link } from "wouter";
import type { AssistantPresentation } from "@shared/assistant";
import { itemHref, observationHref } from "@shared/inventory";
import { ObservationTrend } from "@/components/workspace/ObservationTrend";
import { Badge } from "@/components/ui/badge";
export function AnswerVisual({
  presentation,
  cite,
}: {
  presentation: AssistantPresentation;
  cite: (n: number) => React.ReactNode;
}) {
  const { context, trend } = presentation;
  const telemetry = context
    ? observationHref(
        {
          ref: context.ref,
          kind: context.ref.startsWith("equipment:") ? "equipment" : "asset",
          itemType: context.itemType,
        },
        "/assistant",
      )
    : null;
  if (presentation.format === "workflow")
    return presentation.workflow.length ? (
      <nav aria-label="Workflow navigation" className="my-4">
        <ol className="grid gap-2 sm:grid-cols-3">
          {presentation.workflow.map((step, n) => (
            <li
              key={step.label}
              className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 p-3 text-sm"
            >
              <span aria-hidden className="text-info">
                {n + 1}
              </span>
              {step.href ? (
                <Link className="font-medium hover:underline" href={step.href}>
                  {step.label}
                </Link>
              ) : (
                step.label
              )}
            </li>
          ))}
        </ol>
      </nav>
    ) : null;
  return (
    <div className="space-y-4">
      {trend && context && (
        <>
          <h2 className="text-lg font-semibold leading-7">
            {context.name} recorded{" "}
            {trend.latest.value.toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })}{" "}
            {trend.latest.unit}
            {trend.threshold
              ? `, ${trend.latest.value > trend.threshold.value ? "above" : trend.latest.value < trend.threshold.value ? "below" : "at"} the configured ${trend.threshold.label.toLowerCase()} of ${trend.threshold.value.toLocaleString()} ${trend.threshold.unit}`
              : "."}{" "}
            {trend.sourceNumbers.map((n) => cite(n))}
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            Observed{" "}
            {new Date(trend.latest.occurredAt).toLocaleString(undefined, {
              timeZoneName: "short",
            })}{" "}
            · {trend.latest.source} · {trend.scope} · quality{" "}
            {trend.latest.quality} ·{" "}
            {trend.latest.freshness === "current"
              ? "Within the source freshness policy"
              : trend.latest.freshness === "stale"
                ? "Historical / stale observation"
                : "Current freshness not established"}
          </p>
          {trend.snapshot ? (
            <ObservationTrend
              compact
              snapshot={trend.snapshot}
              title={`${context.name} · ${trend.metric}`}
              assetIds={[trend.assetId]}
              scope={trend.scope}
              metric={trend.metric}
              startTime={trend.from}
              endTime={trend.to}
              threshold={trend.threshold}
              openHref={
                telemetry
                  ? `${telemetry}&scope=${trend.scope}&metric=${trend.metric}&from=${trend.from}&to=${trend.to}`
                  : undefined
              }
            />
          ) : (
            <p className="rounded-md border border-info/40 p-3 text-sm">
              The recorded observation is available; chart history could not be
              attached to this answer.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Review the trend and linked evidence. These observations do not
            establish a physical cause or a component fault.
          </p>
        </>
      )}
      {!!presentation.events.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Related process events</h3>
          <ol className="space-y-3 border-l-2 border-info/40 pl-4">
            {presentation.events.map((event) => (
              <li key={event.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <time className="text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()}
                  </time>
                  <Badge variant="outline">
                    {event.severity} · {event.status}
                  </Badge>
                </div>
                <Link
                  href={`/alerts/${event.id}?return=${encodeURIComponent("/assistant")}`}
                  className="mt-1 block font-medium text-primary underline"
                >
                  {event.title}
                </Link>
                {event.sourceNumbers.map((n) => cite(n))}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!trend && context && (
        <p className="rounded-md border border-info/30 bg-info/5 p-3 text-sm">
          No verified chart is attached to this answer. Open the equipment to
          review source quality, units and available evidence.{" "}
          <Link
            className="font-medium text-primary underline"
            href={itemHref(context.ref, "overview", "/assistant")}
          >
            Open {context.name}
          </Link>
        </p>
      )}
    </div>
  );
}
