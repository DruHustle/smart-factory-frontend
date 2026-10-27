import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { metrics, sourceUnits } from "@shared/measurements";
import { EmptyState } from "./Primitives";
type Policy = {
  route: "direct" | "gateway" | "unconfigured";
  gatewayId?: string;
  freshnessSeconds?: number;
  maxLatenessSeconds: number;
  clockSkewSeconds: number;
  legacyCurrent: boolean;
  legacyUnits: Partial<Record<(typeof metrics)[number], string>>;
  revision?: number;
};
export function CommissioningDialog({
  id,
  open,
  onOpenChange,
}: {
  id: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const query = trpc.devices.getById.useQuery({ id }, { enabled: open }),
    utils = trpc.useUtils(),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [location, setLocation] = useState(""),
    [zone, setZone] = useState(""),
    [search, setSearch] = useState(""),
    [policy, setPolicy] = useState<Policy>({
      route: "unconfigured",
      maxLatenessSeconds: 120,
      clockSkewSeconds: 30,
      legacyCurrent: false,
      legacyUnits: {},
    });
  const parents = trpc.devices.monitor.useQuery(
    { type: "gateway", search, page: 0, pageSize: 25 },
    { enabled: open && policy.route === "gateway" },
  );
  useEffect(() => {
    if (open && query.data) {
      const d = query.data,
        p = d.metadata?.commissioning as Policy | undefined;
      setName(d.name);
      setLocation(d.location ?? "");
      setZone(d.zone ?? "");
      setPolicy(
        p ?? {
          route: "unconfigured",
          maxLatenessSeconds: 120,
          clockSkewSeconds: 30,
          legacyCurrent: false,
          legacyUnits: {},
        },
      );
      setError("");
    }
  }, [open, query.dataUpdatedAt]);
  const mutation = trpc.devices.updateCommissioning.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.invalidate(),
        utils.devices.invalidate(),
      ]);
      onOpenChange(false);
    },
    onError: (e) => setError(e.message),
  });
  const control = "h-10 w-full rounded-md border border-input bg-card px-3";
  const submit = () => {
    const { revision, ...p } = policy;
    mutation.mutate({
      id,
      expectedRevision: revision ?? 0,
      name,
      location: location || null,
      zone: zone || null,
      policy: {
        ...p,
        gatewayId: p.route === "gateway" ? p.gatewayId : undefined,
      },
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Review identity and commissioning</DialogTitle>
          <DialogDescription>
            Saving records the reviewed software route and evidence policy.
            Broker credentials, gateway publication and physical commissioning
            remain separate tasks.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <EmptyState title="Loading current configuration…" />
        ) : query.error || !query.data ? (
          <EmptyState
            error
            title="Configuration unavailable"
            description={query.error?.message}
          />
        ) : (
          <div className="space-y-4">
            <p className="break-all text-xs text-muted-foreground">
              {query.data.deviceId} · Revision {policy.revision ?? 0}
            </p>
            <label className="block space-y-1 text-sm">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Location
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Zone
                <Input value={zone} onChange={(e) => setZone(e.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              Connection route
              <select
                aria-label="Commissioned route"
                className={control}
                value={policy.route}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    route: e.target.value as Policy["route"],
                  })
                }
              >
                <option value="unconfigured">Not configured</option>
                <option value="direct">Direct MQTT / gateway uplink</option>
                {query.data.type !== "gateway" && (
                  <option value="gateway">Through a registered gateway</option>
                )}
              </select>
            </label>
            {policy.route === "gateway" && (
              <div className="space-y-2">
                <Input
                  aria-label="Find a parent gateway"
                  placeholder="Find a parent gateway"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Parent gateway"
                  className={control}
                  value={policy.gatewayId ?? ""}
                  onChange={(e) =>
                    setPolicy({ ...policy, gatewayId: e.target.value })
                  }
                >
                  <option value="">Select a registered gateway</option>
                  {policy.gatewayId &&
                    !parents.data?.items.some(
                      (d) => d.deviceId === policy.gatewayId,
                    ) && (
                      <option value={policy.gatewayId}>
                        {policy.gatewayId} (current; search to review)
                      </option>
                    )}
                  {parents.data?.items.map((d) => (
                    <option key={d.id} value={d.deviceId}>
                      {d.name} · {d.deviceId}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {parents.data?.total ?? 0} matching gateways; first 25 shown.
                  Refine the search for others.
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Freshness (seconds)", "freshnessSeconds", 5, 86400],
                ["Allowed lateness (seconds)", "maxLatenessSeconds", 5, 3600],
                ["Clock skew (seconds)", "clockSkewSeconds", 0, 60],
              ].map(([label, key, min, max]) => (
                <label key={String(key)} className="text-xs">
                  {label}
                  <Input
                    type="number"
                    min={Number(min)}
                    max={Number(max)}
                    value={(policy[key as keyof Policy] as number) ?? ""}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        [key]:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Without a freshness window current availability stays unknown.
              Historical, retained, bad-quality and out-of-order acquisitions do
              not assert a new current condition.
            </p>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Reviewed legacy source compatibility
              </summary>
              <label className="my-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={policy.legacyCurrent}
                  onChange={(e) =>
                    setPolicy({ ...policy, legacyCurrent: e.target.checked })
                  }
                />
                Allow future unclassified observations from this reviewed route
                to update connectivity. Historical rows retain their original
                classification.
              </label>
              {policy.legacyCurrent && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {metrics.map((m) => (
                    <label key={m} className="text-xs capitalize">
                      {m} source unit
                      <select
                        aria-label={`Legacy ${m} unit`}
                        className={control}
                        value={policy.legacyUnits?.[m] ?? ""}
                        onChange={(e) => {
                          const next = { ...policy.legacyUnits };
                          if (e.target.value) next[m] = e.target.value;
                          else delete next[m];
                          setPolicy({ ...policy, legacyUnits: next });
                        }}
                      >
                        <option value="">Unknown / do not infer</option>
                        {sourceUnits[m].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Legacy quality remains unknown. Threshold incidents require an
                explicit good-quality acquisition with a compatible reviewed
                unit.
              </p>
            </details>
            {error && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{error}</p>
                <Button variant="outline" onClick={() => void query.refetch()}>
                  Reload current configuration
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending || !query.data || name.trim().length < 3
            }
            onClick={submit}
          >
            Save reviewed configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
