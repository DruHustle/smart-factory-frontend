import { lazy, Suspense, useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, Box, ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { EmptyState, SampleTime, StatusBadge } from "./Primitives";
import { EquipmentSymbol, StateDistribution } from "./VisualEvidence";
const Renderer = lazy(
  () => import("@/components/equipment/LocalEquipmentRenderer"),
);

export function SourceStates({
  stats,
}: {
  stats: {
    online: number;
    stale: number;
    offline: number;
    unknown: number;
    maintenance: number;
    error: number;
  };
}) {
  return (
    <StateDistribution
      label="Source observation states"
      segments={[
        ["Receiving", stats.online, "var(--success)", "live"],
        ["Stale", stats.stale, "var(--warning)", "stale"],
        ["Disconnected", stats.offline, "var(--destructive)", "offline"],
        ["Unknown", stats.unknown, "var(--muted-foreground)", "unknown"],
        ["Maintenance", stats.maintenance, "var(--chart-4)", "maintenance"],
        ["Error", stats.error, "var(--destructive)", "error"],
      ].map(([label, value, color, status]) => ({
        label: String(label),
        value: Number(value),
        color: String(color),
        href: `/inventory?status=${status}`,
        striped: status === "offline",
      }))}
    />
  );
}

export function ProcessDistribution({
  stats,
}: {
  stats: { critical: number; warning: number; info: number; open: number };
}) {
  const segments = [
    {
      label: "Critical",
      value: stats.critical,
      color: "var(--destructive)",
      severity: "critical",
    },
    {
      label: "Warning",
      value: stats.warning,
      color: "var(--warning)",
      severity: "warning",
    },
    {
      label: "Info",
      value: stats.info,
      color: "var(--info)",
      severity: "info",
    },
  ];
  return (
    <figure
      aria-label="Open process incident severity distribution"
      className="space-y-3"
    >
      <figcaption className="text-sm text-muted-foreground">
        {stats.open} open process incidents · security findings are separate
      </figcaption>
      <div className="flex h-5 overflow-hidden rounded bg-muted" aria-hidden>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span
              key={s.label}
              style={{
                width: `${(100 * s.value) / Math.max(stats.open, 1)}%`,
                background: s.color,
              }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label}>
            <Link
              href={`/alerts?status=open&severity=${s.severity}`}
              className="inline-flex min-h-10 items-center gap-2 rounded px-1 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.label} <strong>{s.value}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Only explicit gateway assignments are drawn; observing the same payload does not create an edge. */
export function GatewayDiagram({
  page,
  onPage,
  returnTo,
}: {
  page: number;
  onPage: (page: number) => void;
  returnTo: string;
}) {
  const gateways = trpc.devices.monitor.useQuery(
    { type: "gateway", page, pageSize: 1 },
    { staleTime: 30000 },
  );
  const gateway = gateways.data?.items[0];
  const children = trpc.devices.getConnectedDevices.useQuery(
    { id: gateway?.id ?? 0 },
    { enabled: !!gateway, staleTime: 30000 },
  );
  const assets = trpc.devices.getConnectedAssets.useQuery(
    { id: gateway?.id ?? 0 },
    { enabled: !!gateway, staleTime: 30000 },
  );
  if (gateways.isLoading)
    return <EmptyState title="Loading configured relationships…" />;
  if (gateways.error || children.error || assets.error)
    return (
      <EmptyState
        error
        title="Relationships unavailable"
        description="No connection is inferred from missing data."
      />
    );
  if (!gateway)
    return (
      <EmptyState
        title="No recorded gateway relationships"
        description="Independent sources remain independent. Configure a reviewed link to show an equipment path."
        action={
          <Button asChild variant="outline">
            <Link href="/inventory">Inspect inventory</Link>
          </Button>
        }
      />
    );
  const nodes = [
    ...(assets.data ?? []).map((a) => ({
      ref: `asset:${a.id}`,
      name: a.name,
      type: a.assetType,
      detail: a.protocol,
    })),
    ...(children.data ?? []).map((d) => ({
      ref: `device:${d.id}`,
      name: d.name,
      type: d.type,
      detail: "Configured gateway parent",
    })),
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Gateway {page + 1} of {gateways.data?.total} · configured links
        </p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous gateway"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next gateway"
            disabled={!gateways.data?.hasMore}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <figure aria-label="Recorded gateway and equipment relationships">
        <Link
          href={itemHref(`device:${gateway.id}`, "connected", returnTo)}
          className="flex items-center gap-3 rounded-md border border-info/50 bg-info/5 p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <EquipmentSymbol type="gateway" className="size-8 text-info" />
          <span className="min-w-0 flex-1">
            <strong className="block break-words">{gateway.name}</strong>
            <span className="mt-1 block text-xs text-muted-foreground">
              Last receipt{" "}
              <SampleTime value={gateway.lastSeen?.toISOString()} />
            </span>
          </span>
          <StatusBadge status={gateway.observedStatus} />
        </Link>
        {children.isLoading || assets.isLoading ? (
          <p role="status" className="p-3 text-sm">
            Loading recorded links…
          </p>
        ) : nodes.length ? (
          <ul className="ml-5 border-l-2 border-info pl-5 pt-3">
            {nodes.slice(0, 6).map((n) => (
              <li
                key={n.ref}
                className="relative pb-3 before:absolute before:-left-5 before:top-6 before:w-5 before:border-t-2 before:border-info"
              >
                <Link
                  href={itemHref(n.ref, "overview", returnTo)}
                  className="flex items-center gap-3 rounded-md border bg-card p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <EquipmentSymbol type={n.type} className="size-6 text-info" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">
                      {n.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {n.detail.replaceAll("_", " ")}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            This gateway has no explicitly linked assets or devices.
          </p>
        )}
        <figcaption className="mt-2 text-xs text-muted-foreground">
          Showing up to 6 of {nodes.length} recorded links. Lines show
          configuration, not current delivery or physical movement.
        </figcaption>
      </figure>
    </div>
  );
}

export function LinkedModelPreview({
  item,
  returnTo,
  interactiveSelection = false,
  componentId = null,
}: {
  item: Pick<InventoryItem, "ref" | "equipmentId" | "name" | "mode">;
  returnTo: string;
  interactiveSelection?: boolean;
  componentId?: string | null;
}) {
  const [loaded, setLoaded] = useState(false),
    [selection, setSelection] = useState<string | null>(componentId);
  useEffect(() => setSelection(componentId), [componentId]);
  const [, navigate] = useWorkspaceLocation();
  const query = trpc.equipment.get.useQuery(
    { id: item.equipmentId! },
    { enabled: loaded, staleTime: 60000 },
  );
  const baseHref = itemHref(item.ref, "3d", returnTo);
  const href =
    baseHref +
    (componentId
      ? `${baseHref.includes("?") ? "&" : "?"}component=${encodeURIComponent(componentId)}`
      : "");
  const validSelection = query.data?.components.some(
    (c) => c.installedComponentId === selection,
  )
    ? selection
    : null;
  return (
    <div className="space-y-3" aria-label="Linked equipment preview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong className="block">{item.name}</strong>
          <span className="text-xs text-muted-foreground">
            Linked model · {item.mode} observations
          </span>
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            Open 3D inspection <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      {!loaded ? (
        <button
          onClick={() => setLoaded(true)}
          className="group flex min-h-56 w-full flex-col items-center justify-center gap-4 rounded-md border bg-info/5 p-5 text-center hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Load 3D preview of ${item.name}`}
        >
          <Box className="size-20 text-info" strokeWidth={1} />
          <span className="font-medium">Load linked 3D model</span>
          <span className="max-w-sm text-xs text-muted-foreground">
            Orbit the actual linked model or open inspection for components,
            sections, ghost housings and saved views. Graphics load on demand.
          </span>
        </button>
      ) : query.isLoading ? (
        <EmptyState title="Loading linked equipment…" />
      ) : query.error || !query.data ? (
        <EmptyState
          error
          title="Model preview unavailable"
          description="Open the equipment workspace for its accessible component details."
        />
      ) : (
        <Suspense fallback={<EmptyState title="Loading 3D preview…" />}>
          <Renderer
            preview
            modelUrl={query.data.modelUrl}
            components={query.data.components}
            selected={interactiveSelection ? validSelection : null}
            onSelect={(id) =>
              interactiveSelection ? setSelection(id) : navigate(href)
            }
            focusComponentId={
              interactiveSelection ? (validSelection ?? undefined) : undefined
            }
            observations={[]}
            annotations={[]}
          />
        </Suspense>
      )}
      {interactiveSelection && validSelection && (
        <p className="text-sm">
          Selected component:{" "}
          {
            query.data?.components.find(
              (c) => c.installedComponentId === validSelection,
            )?.name
          }
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Illustrative geometry. No physical movement or component measurement is
        inferred.{" "}
        <Link
          href={itemHref(item.ref, "components", returnTo)}
          className="underline"
        >
          Components / accessible detail
        </Link>
      </p>
    </div>
  );
}
