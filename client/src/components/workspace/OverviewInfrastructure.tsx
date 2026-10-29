import { ArrowUpRight, Server } from "lucide-react";
import { Link } from "wouter";
import { ageSnapshot, type HealthState } from "@shared/infrastructure";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const stateColor = (state: HealthState) =>
  state === "healthy"
    ? "bg-success"
    : state === "unavailable"
      ? "bg-destructive"
      : state === "degraded" || state === "stale"
        ? "bg-warning"
        : "bg-muted-foreground";

/** Uses the existing restricted evidence API; a missing result is never healthy. */
export function OverviewInfrastructure() {
  const { user } = useAuth();
  const active = useDocumentActive();
  const allowed = !!(user?.access?.demoOnly || user?.access?.canAdminister);
  const query = trpc.system.infrastructure.useQuery(
    { range: "2h", scenario: "normal" },
    {
      enabled: allowed,
      staleTime: 60000,
      refetchInterval: active ? 60000 : false,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  );
  const raw = query.data?.snapshot;
  const snapshot = raw ? (raw.synthetic ? raw : ageSnapshot(raw)) : null;
  const sources = [
    ["api", "API"],
    ["database", "Database"],
    ["mqtt", "MQTT"],
    ["telemetry-worker", "Telemetry worker"],
  ];
  return (
    <Card className="overview-panel min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4 text-info" aria-hidden />
          Infrastructure
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {!allowed ? (
          <p className="py-3 text-xs text-muted-foreground">
            Service evidence is available to administrators. Use Demo data to
            explore the simulated installation.
          </p>
        ) : query.isLoading ? (
          <p className="py-3 text-xs text-muted-foreground" role="status">
            Loading service evidence…
          </p>
        ) : query.error || !snapshot ? (
          <div className="py-2 text-xs text-muted-foreground">
            <p>Service evidence unavailable.</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Retry service evidence
            </Button>
          </div>
        ) : (
          <>
            <ul
              aria-label="Overview service health"
              className="divide-y text-xs"
            >
              {sources.map(([id, name]) => {
                const service = snapshot.services.find(
                  (candidate) => candidate.id === id,
                );
                const state = service?.state ?? "unknown";
                return (
                  <li key={id}>
                    <Link
                      href={`/infrastructure/service-health/services?service=${id}`}
                      className="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                      title={service?.explanation}
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${stateColor(state)}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">{name}</span>
                      <span className="capitalize text-muted-foreground">
                        {state.replaceAll("_", " ")}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {snapshot.synthetic
                ? "Simulated infrastructure"
                : snapshot.stale
                  ? "Last-known evidence · stale"
                  : "Reported service evidence"}
            </p>
          </>
        )}
        {allowed && <Link
          aria-label="Inspect service health"
          href="/infrastructure/service-health"
          className="mt-auto inline-flex min-h-9 items-center justify-end gap-1 pt-2 text-xs underline"
        >
          Service health <ArrowUpRight className="size-3" aria-hidden />
        </Link>}
      </CardContent>
    </Card>
  );
}
