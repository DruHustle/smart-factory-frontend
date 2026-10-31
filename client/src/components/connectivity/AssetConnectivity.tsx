import { useId } from "react";
import { Link } from "wouter";
import { Cable, ExternalLink, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SampleTime } from "@/components/workspace/Primitives";

function formatValue(value: number | string | boolean | null) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number")
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: 10,
    }).format(value);
  // Int64 and UInt64 arrive as decimal strings; preserve every digit.
  return value;
}

/** Signals are bound explicitly by asset ID, never inferred from a signal name. */
export function AssetConnectivity({ assetId }: { assetId: string }) {
  const titleId = useId();
  const active = useDocumentActive();
  const query = trpc.connectivity.assetTags.useQuery(
    { assetId },
    {
      refetchInterval: active ? 15000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    },
  );
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 font-semibold">
            <Cable className="size-4 text-primary" aria-hidden="true" />
            Industrial tag values
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Signals explicitly bound to this asset, with their reported quality
            and acquisition time.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/connectivity">
            Device connectivity
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading bound tags…
        </p>
      ) : query.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 p-3 text-sm"
        >
          <p>Industrial tag values could not be read. {query.error.message}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      ) : !query.data?.length ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No industrial tags are bound to this asset. Choose this asset in a
          connection’s tag mapping to display its signals here.
        </p>
      ) : (
        <ul
          aria-label="Bound industrial signals"
          className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {query.data.map((tag) => (
            <li
              key={`${tag.gatewayDeviceId}/${tag.connectionId}/${tag.tagId}`}
              className="min-w-0 space-y-3 rounded-lg border p-4"
            >
              <div>
                <h3 className="break-words text-sm font-medium">{tag.name}</h3>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  {tag.tagId}
                  {tag.property ? ` · ${tag.property}` : ""}
                </p>
              </div>
              <div className="break-words text-xl font-semibold tabular-nums">
                {formatValue(tag.value)}
                {tag.value !== null && tag.unit && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    {tag.unit}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="font-normal">
                  {tag.quality} quality
                </Badge>
                <Badge variant="outline" className="font-normal">
                  {tag.mode} source
                </Badge>
                {!tag.currentEligible && tag.observedAt && (
                  <Badge variant="outline" className="font-normal">
                    Not current
                  </Badge>
                )}
              </div>
              <dl className="space-y-1 text-xs text-muted-foreground">
                <div>
                  <dt className="inline">Observed: </dt>
                  <dd className="inline">
                    <SampleTime
                      value={tag.observedAt}
                      historical={!tag.currentEligible && !!tag.observedAt}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="inline">Type: </dt>
                  <dd className="inline">
                    {tag.dataType} · revision {tag.configurationRevision}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Connection: </dt>
                  <dd className="inline break-all">{tag.connectionId}</dd>
                </div>
              </dl>
              <Link
                href={`/connectivity?gateway=${encodeURIComponent(tag.gatewayDeviceId)}`}
                className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
              >
                <span className="break-all">Gateway {tag.gatewayDeviceId}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
