import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { assistantLink, type AssistantPresentation } from "@shared/assistant";
import type { AssistantTurn, TurnContext } from "@/lib/assistant-session";
import { trpc } from "@/lib/trpc";
import { LinkedModelPreview } from "@/components/workspace/OverviewGraphics";
import { EquipmentSymbol } from "@/components/workspace/VisualEvidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/workspace/Primitives";
export function EvidenceInspector({
  turn,
  context,
  citation,
}: {
  turn?: AssistantTurn;
  context: TurnContext;
  citation: { number: number; key: number } | null;
}) {
  const [filter, setFilter] = useState<"all" | "documentation" | "live-data">(
    "all",
  );
  const root = useRef<HTMLDivElement>(null);
  const captured = turn?.result?.presentation?.context;
  const fallback = trpc.assistant.context.useQuery(
    { assetId: context?.assetId ?? "unselected" },
    { enabled: !captured && !!context?.assetId, staleTime: 60000 },
  );
  const equipment: AssistantPresentation["context"] =
    captured ?? fallback.data ?? null;
  useEffect(() => setFilter("all"), [turn?.id]);
  useEffect(() => {
    if (!citation) return;
    setFilter("all");
    const frame = requestAnimationFrame(() => {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-source-number="${citation.number}"]`,
      );
      if (row) {
        const details = row.querySelector("details");
        if (details) details.open = true;
        row.focus({ preventScroll: true });
        row.scrollIntoView({
          block: "nearest",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [turn?.id, citation]);
  const sources = turn?.result?.sources ?? [];
  return (
    <div ref={root} className="min-w-0 space-y-5">
      <section aria-label="Equipment context" className="space-y-3">
        <h2 className="font-semibold">Equipment context</h2>
        {equipment ? (
          <>
            <div className="flex items-start gap-3">
              <EquipmentSymbol
                type={equipment.itemType}
                className="size-8 text-info"
              />
              <div className="min-w-0">
                <Link
                  className="break-words font-semibold text-primary hover:underline"
                  href={`/inventory/${encodeURIComponent(equipment.ref)}/overview?return=${encodeURIComponent("/assistant")}`}
                >
                  {equipment.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {equipment.location ?? "Location not recorded"}
                </p>
                <Badge className="mt-2" variant="outline">
                  {equipment.isDemo
                    ? "Simulated context"
                    : "Authorized equipment"}
                </Badge>
              </div>
            </div>
            {equipment.equipmentId ? (
              <LinkedModelPreview
                key={equipment.equipmentId}
                interactiveSelection
                componentId={equipment.componentId}
                item={{
                  ref: equipment.ref,
                  name: equipment.name,
                  equipmentId: equipment.equipmentId,
                  mode:
                    turn?.result?.presentation?.trend?.scope ??
                    (equipment.isDemo ? "simulated" : "recorded"),
                }}
                returnTo="/assistant"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No linked model is recorded for this item. Identity and source
                evidence remain available.
              </p>
            )}
            {equipment.componentId && (
              <p className="rounded-md border border-info/30 bg-info/5 p-3 text-xs leading-5">
                {equipment.componentName ?? "Component"} has an explicit metric
                binding to this source. Highlighting an association does not
                establish a component fault.
              </p>
            )}
          </>
        ) : fallback.isLoading && context ? (
          <EmptyState title="Loading equipment context…" />
        ) : fallback.error ? (
          <EmptyState
            error
            title="Equipment context unavailable"
            description="The recorded answer is retained. The current equipment lookup could not be read."
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {context
              ? "This equipment is no longer available in the authorized scope."
              : "Choose equipment in the composer, or ask a workflow question without equipment context."}
          </p>
        )}
        {equipment?.equipmentId && turn?.result && (
          <p className="text-xs text-muted-foreground">
            The preview shows the current linked representation. Answer evidence
            retains the snapshot below.
          </p>
        )}
      </section>
      <section aria-label="Answer evidence" className="space-y-3 border-t pt-4">
        <h2 className="font-semibold">
          Sources for {turn ? "this answer" : "your next answer"}
        </h2>
        {turn?.result ? (
          <p className="text-xs text-muted-foreground">
            Answer snapshot ·{" "}
            {new Date(turn.result.contextAt).toLocaleString(undefined, {
              timeZoneName: "short",
            })}
            . Observation times are shown with each stored source.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {turn?.status === "pending"
              ? "Authorized sources will appear when this answer completes."
              : "Approved guides and stored evidence will appear here after a question."}
          </p>
        )}
        {sources.length > 0 && (
          <>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Filter answer sources"
            >
              {[
                ["all", "All sources"],
                ["documentation", "Guides"],
                ["live-data", "Stored evidence"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? "secondary" : "ghost"}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value as typeof filter)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <ol className="divide-y">
              {sources
                .map((source, index) => ({ source, index }))
                .filter(
                  ({ source }) =>
                    filter === "all" ||
                    (source.kind ?? "documentation") === filter,
                )
                .map(({ source, index }) => {
                  const link = assistantLink(source.href ?? source.path),
                    at = source.timestamp ? Date.parse(source.timestamp) : NaN;
                  return (
                    <li
                      key={`${source.path}:${index}`}
                      tabIndex={-1}
                      data-source-number={index + 1}
                      className="space-y-2 py-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <p className="text-xs text-info">
                        [{index + 1}]{" "}
                        {source.kind === "live-data"
                          ? "Stored workspace evidence"
                          : "Operator guide"}
                      </p>
                      {link?.kind === "internal" ? (
                        <Link
                          className="block break-words text-sm font-medium text-primary underline"
                          href={link.href}
                        >
                          {source.title}
                        </Link>
                      ) : link?.kind === "external" ? (
                        <a
                          className="block break-words text-sm font-medium text-primary underline"
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.title}
                        </a>
                      ) : (
                        <h3 className="text-sm font-medium">{source.title}</h3>
                      )}
                      <p className="break-words text-xs text-muted-foreground">
                        {source.section}
                      </p>
                      {Number.isFinite(at) && (
                        <time
                          dateTime={source.timestamp}
                          className="block text-xs text-muted-foreground"
                        >
                          {source.kind === "live-data"
                            ? "Observation / record time"
                            : "Source time"}{" "}
                          ·{" "}
                          {new Date(at).toLocaleString(undefined, {
                            timeZoneName: "short",
                          })}
                        </time>
                      )}
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          Read source excerpt [{index + 1}]
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                          {source.excerpt}
                        </p>
                      </details>
                    </li>
                  );
                })}
            </ol>
            {!sources.some(
              (source) =>
                filter === "all" || (source.kind ?? "documentation") === filter,
            ) && (
              <p className="text-sm text-muted-foreground">
                No sources of this type are attached to the selected answer.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
