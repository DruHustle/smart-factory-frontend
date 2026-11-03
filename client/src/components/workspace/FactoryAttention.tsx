import { Link } from "wouter";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useRuntimeCapability } from "@/components/RuntimeBoundary";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** The API applies factory membership before ordering and limiting this queue. */
export function FactoryAttention({ factoryId }: { factoryId: string }) {
  const supported = useRuntimeCapability("ot-alarm-conditions-v1"),
    active = useDocumentActive();
  const query = trpc.alerts.list.useQuery(
    { factoryId, openOnly: true, order: "severity", limit: 4 },
    {
      enabled: supported,
      refetchInterval: active ? 30000 : false,
      staleTime: 15000,
      retry: false,
    },
  );
  if (!supported) return null;
  if (query.data?.length === 0 && !query.error) {
    return (
      <aside
        className="factory-attention-empty rounded-lg border bg-card px-3 py-2 text-xs"
        aria-label="Factory needs attention"
      >
        <p className="text-muted-foreground">
          No open incidents recorded for this factory.
        </p>
        <Link
          className="inline-flex min-h-11 items-center gap-1 text-primary underline"
          href={`/alerts?status=open&factory=${encodeURIComponent(factoryId)}`}
        >
          View incidents <ArrowRight className="size-3" aria-hidden />
        </Link>
      </aside>
    );
  }
  return (
    <aside
      className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
      aria-label="Factory needs attention"
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 text-warning" />
        Needs attention
      </h2>
      <p className="text-xs text-muted-foreground">
        This factory · severity first · source condition and investigation
        review are separate.
      </p>
      {query.error ? (
        <div role="status" className="text-sm">
          Incident evidence is unavailable.
          <Button variant="link" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading incidents…
        </p>
      ) : !query.data.length ? (
        <p className="text-sm text-muted-foreground">
          No open incidents are recorded for this factory. This does not
          establish the condition of unmonitored equipment.
        </p>
      ) : (
        <ul className="divide-y">
          {query.data.map((incident) => (
            <li key={incident.id} className="py-3 first:pt-0">
              <Link
                className="block rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                href={`/alerts?selected=${incident.id}&factory=${encodeURIComponent(factoryId)}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {incident.severity}
                  </Badge>
                  <span className="text-xs capitalize">
                    Source: {incident.currentCondition}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-medium">{incident.message}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {incident.deviceName ??
                    incident.assetId ??
                    "Registered source"}{" "}
                  · {incident.acknowledged ? "Acknowledged" : "Unacknowledged"}{" "}
                  · review {incident.status}
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                  Investigate <ArrowRight className="size-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        className="inline-flex items-center gap-1 text-sm text-primary underline"
        href={`/alerts?status=open&factory=${encodeURIComponent(factoryId)}`}
      >
        View this factory’s incidents
        <ArrowRight className="size-3" />
      </Link>
    </aside>
  );
}
