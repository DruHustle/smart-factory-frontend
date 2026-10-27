import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ObservationTrend, type TrendScope } from "./ObservationTrend";
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
  return <ItemTelemetry item={item} />;
}
export function ItemTelemetry({ item }: { item: InventoryItem }) {
  const { user } = useAuth(),
    [scope, setScope] = useState<TrendScope>(
      user?.access?.demoOnly ? "simulated" : "operational",
    );
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-sm">
        Evidence scope
        <select
          className="h-10 rounded-md border border-input bg-card px-3"
          value={scope}
          onChange={(e) => setScope(e.target.value as TrendScope)}
        >
          {["operational", "live", "simulated", "replay", "unknown", "all"].map(
            (v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ),
          )}
        </select>
      </label>
      <ObservationTrend
        deviceId={item.kind === "device" ? Number(item.id) : undefined}
        assetIds={item.kind !== "device" ? [item.identifier] : undefined}
        scope={scope}
        title={`${item.name} observations`}
      />
      <p className="text-xs text-muted-foreground">
        The selected evidence scope applies before sample selection and
        statistics. Unknown units and quality are excluded from engineering
        averages; stored evidence remains available in observation history.
      </p>
    </div>
  );
}
