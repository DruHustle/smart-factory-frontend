import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { EmptyState, SampleTime } from "./Primitives";
import type { InventoryItem } from "@shared/inventory";
export function ItemActivity({ item }: { item: InventoryItem }) {
  const device = trpc.devices.getById.useQuery(
    { id: Number(item.id) },
    { enabled: item.kind === "device" },
  );
  const alerts = trpc.alerts.list.useQuery(
    { deviceId: Number(item.id), limit: 50 },
    { enabled: item.kind === "device" },
  );
  if (device.isLoading || alerts.isLoading)
    return <EmptyState title="Loading item activity…" />;
  if (device.error || alerts.error)
    return (
      <EmptyState
        error
        title="Item activity unavailable"
        description="The activity service could not be read. No zero count is inferred."
      />
    );
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <h2 className="font-semibold">Recorded activity</h2>
      <ol className="space-y-4 text-sm">
        {device.data && (
          <>
            <li>
              Identity registered ·{" "}
              <SampleTime value={device.data.createdAt.toISOString()} />
            </li>
            <li>
              Record last updated ·{" "}
              <SampleTime value={device.data.updatedAt.toISOString()} />
            </li>
          </>
        )}
        {item.lastObserved && (
          <li>
            Last connectivity observation ·{" "}
            <SampleTime value={item.lastObserved} />
          </li>
        )}
        {alerts.data?.map((a) => (
          <li key={a.id}>
            <a className="text-primary underline" href={`#/alerts/${a.id}`}>
              {a.message}
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              {a.severity} · {a.status} ·{" "}
              <SampleTime value={a.createdAt.toISOString()} />
            </p>
          </li>
        ))}
      </ol>
      {!alerts.data?.length && (
        <p className="text-sm text-muted-foreground">
          No process incidents recorded in this bounded history. Security
          evidence is assessed separately.
        </p>
      )}
    </section>
  );
}
export function AssetTelemetry({ item }: { item: InventoryItem }) {
  const end = useMemo(() => Date.now(), [item.ref]);
  const data = trpc.analytics.getAssetTelemetry.useQuery({
    assetIds: [item.identifier],
    startTime: end - 86400000,
    endTime: end,
    intervalMs: 900000,
  });
  if (data.isLoading)
    return <EmptyState title="Loading historical asset telemetry…" />;
  if (data.error)
    return (
      <EmptyState
        error
        title="Telemetry unavailable"
        description={data.error.message}
      />
    );
  if (!data.data?.overall.sampleCount)
    return (
      <EmptyState
        title="No telemetry observations"
        description="This asset's configured connections do not establish measured availability. No samples arrived in the last 24 hours."
      />
    );
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <h2 className="font-semibold">Historical telemetry · last 24 hours</h2>
      <p className="text-sm">
        {data.data.overall.sampleCount} samples. Operational history includes
        live and unclassified legacy samples. Explicit simulation and replay
        streams remain separate.
      </p>
      <a className="text-sm text-primary underline" href="#/analytics">
        Open historical analytics
      </a>
    </section>
  );
}
