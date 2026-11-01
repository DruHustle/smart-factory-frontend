import { ArrowRight, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Link } from "wouter";
import { itemHref, type InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { inventoryLocation } from "@/lib/inventory-location";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, SampleTime, StatusBadge } from "./Primitives";
import { EquipmentSymbol, StateDistribution } from "./VisualEvidence";

/** Show all gateway paths in bounded pages, instead of choosing one gateway. */
export function FactoryConnections({
  page,
  onPage,
  returnTo,
}: {
  page: number;
  onPage: (page: number) => void;
  returnTo: string;
}) {
  const active = useDocumentActive();
  const gateways = trpc.devices.monitor.useQuery(
    { type: "gateway", page, pageSize: 6 },
    {
      staleTime: 60000,
      refetchInterval: active ? 60000 : false,
      refetchIntervalInBackground: false,
    },
  );
  return (
    <section aria-label="Factory connections" className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Factory connections</CardTitle>
          <p className="text-xs text-muted-foreground">
            Recorded gateway paths across the factory. Direct and unlinked
            sources also appear in All system items. Lines show configuration;
            connection status comes from observation evidence.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {gateways.isLoading ? (
            <EmptyState title="Loading factory connections…" />
          ) : gateways.error || !gateways.data ? (
            <EmptyState
              error
              title="Factory connections unavailable"
              action={
                <Button
                  variant="outline"
                  onClick={() => void gateways.refetch()}
                >
                  Retry connections
                </Button>
              }
            />
          ) : gateways.data.total === 0 ? (
            <EmptyState
              title="No registered gateways"
              description="Direct devices and assets are listed in All system items. No gateway path is inferred."
            />
          ) : !gateways.data.items.length ? (
            <EmptyState
              title="This gateway page is no longer available"
              description={`${gateways.data.total} registered gateways are available. Return to the first page to browse their paths.`}
              action={
                <Button variant="outline" onClick={() => onPage(0)}>
                  First gateway page
                </Button>
              }
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground" role="status">
                {gateways.data.total} registered gateways · page {page + 1} of{" "}
                {Math.ceil(gateways.data.total / 6)}
              </p>
              <ul
                aria-label="Factory gateway paths"
                className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3"
              >
                {gateways.data.items.map((gateway) => (
                  <GatewayPath
                    key={gateway.id}
                    gateway={gateway}
                    returnTo={returnTo}
                  />
                ))}
              </ul>
              {(gateways.data.total > 6 || page > 0) && (
                <nav
                  aria-label="Factory connection pages"
                  className="flex justify-end gap-2"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || gateways.isFetching}
                    onClick={() => onPage(page - 1)}
                  >
                    Previous gateways
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!gateways.data.hasMore || gateways.isFetching}
                    onClick={() => onPage(page + 1)}
                  >
                    Next gateways
                  </Button>
                </nav>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function GatewayPath({
  gateway,
  returnTo,
}: {
  gateway: {
    id: number;
    name: string;
    observedStatus: string;
    lastSeen: Date | null;
  };
  returnTo: string;
}) {
  const active = useDocumentActive();
  const polling = {
    staleTime: 60000,
    refetchInterval: active ? 60000 : (false as const),
    refetchIntervalInBackground: false,
  };
  const children = trpc.devices.getConnectedDevices.useQuery(
    { id: gateway.id },
    polling,
  );
  const assets = trpc.devices.getConnectedAssets.useQuery(
    { id: gateway.id },
    polling,
  );
  const nodes = [
    ...(assets.data ?? []).map((asset) => ({
      ref: `asset:${asset.id}`,
      name: asset.name,
      type: asset.assetType,
      detail: asset.protocol,
    })),
    ...(children.data ?? []).map((device) => ({
      ref: `device:${device.id}`,
      name: device.name,
      type: device.type,
      detail: "Configured gateway parent",
    })),
  ];
  const href = itemHref(`device:${gateway.id}`, "connected", returnTo);
  return (
    <li className="min-w-0 rounded-lg border p-3">
      <Link
        href={href}
        className="flex items-start gap-2 rounded-md border border-info/40 bg-info/5 p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
      >
        <EquipmentSymbol type="gateway" className="mt-0.5 size-5 text-info" />
        <span className="min-w-0 flex-1">
          <strong className="block break-words text-sm">{gateway.name}</strong>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={gateway.observedStatus} />
            <span className="text-xs text-muted-foreground">
              <SampleTime value={gateway.lastSeen?.toISOString()} />
            </span>
          </span>
        </span>
        <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
      </Link>
      {children.error || assets.error ? (
        <p className="p-3 text-xs text-muted-foreground">
          Recorded links unavailable.{" "}
          <Link href={href} className="underline">
            Inspect gateway
          </Link>
        </p>
      ) : children.isLoading || assets.isLoading ? (
        <p className="p-3 text-xs text-muted-foreground" role="status">
          Loading recorded links…
        </p>
      ) : nodes.length ? (
        <>
          <ul
            aria-label={`Recorded links for ${gateway.name}`}
            className="ml-3 border-l-2 border-info/40 pl-3 pt-3"
          >
            {nodes.slice(0, 6).map((node) => (
              <li
                key={node.ref}
                className="relative pb-2 before:absolute before:-left-3 before:top-5 before:w-3 before:border-t-2 before:border-info/40"
              >
                <Link
                  href={itemHref(node.ref, "overview", returnTo)}
                  className="flex items-center gap-2 rounded-md border p-2 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <EquipmentSymbol
                    type={node.type}
                    className="size-4 text-info"
                  />
                  <span className="min-w-0">
                    <strong className="block break-words text-xs font-medium">
                      {node.name}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {node.detail.replaceAll("_", " ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={href}
            className="mt-2 inline-flex min-h-9 items-center text-xs underline"
          >
            View all {nodes.length} recorded links
          </Link>
        </>
      ) : (
        <p className="p-3 text-xs text-muted-foreground">
          No recorded asset or device links.
        </p>
      )}
    </li>
  );
}

/** Groups cover the complete authorized inventory, independently of its page. */
export function SystemItemTypes({
  groups,
}: {
  groups: {
    kind: string;
    itemType: string;
    equipment: boolean;
    count: number;
  }[];
}) {
  const counts = { assets: 0, gateways: 0, devices: 0, equipment: 0 };
  for (const group of groups) {
    // A linked 3D representation is a capability of its asset, not another item.
    if (group.kind === "asset") counts.assets += group.count;
    else if (group.kind === "equipment") counts.equipment += group.count;
    else if (group.kind === "device") {
      if (group.itemType === "gateway") counts.gateways += group.count;
      else counts.devices += group.count;
    }
  }
  return (
    <StateDistribution
      label="System item types"
      noun="items"
      segments={[
        {
          label: "Assets",
          value: counts.assets,
          color: "var(--chart-1)",
          href: "/inventory?view=assets",
        },
        {
          label: "Gateways",
          value: counts.gateways,
          color: "var(--chart-2)",
          href: "/inventory?view=gateways",
        },
        {
          label: "Devices",
          value: counts.devices,
          color: "var(--chart-3)",
          href: "/inventory?view=devices",
        },
        {
          label: "Standalone equipment",
          value: counts.equipment,
          color: "var(--chart-4)",
        },
      ]}
    />
  );
}

export function SystemItemList({
  data,
  page,
  pageSize,
  isLoading,
  isFetching,
  error,
  onPage,
  onRetry,
  returnTo,
}: {
  data?: { items: InventoryItem[]; total: number };
  page: number;
  pageSize: number;
  isLoading: boolean;
  isFetching: boolean;
  error?: unknown;
  onPage: (page: number) => void;
  onRetry: () => void;
  returnTo: string;
}) {
  const start = page * pageSize + 1;
  const end = page * pageSize + (data?.items.length ?? 0);
  return (
    <section aria-label="All system items" className="min-w-0">
      <Card aria-busy={isFetching}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3 sm:flex-row">
          <div className="min-w-0 space-y-1">
            <CardTitle>All system items</CardTitle>
            <p className="text-xs text-muted-foreground">
              Assets, gateways, devices and equipment · ordered by name
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/inventory">
              Manage inventory <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <EmptyState
              error
              title="Inventory unavailable"
              description="The system inventory could not be loaded. Try again to see its items and current totals."
              action={
                <Button
                  variant="outline"
                  disabled={isFetching}
                  onClick={onRetry}
                >
                  Retry inventory
                </Button>
              }
            />
          ) : isLoading || !data ? (
            <EmptyState title="Loading system inventory…" />
          ) : data.total === 0 ? (
            <EmptyState
              title="No registered items yet"
              description="Add an asset, gateway, device or equipment item to start building your system overview."
              action={
                <Button asChild variant="outline">
                  <Link href="/inventory">Add your first item</Link>
                </Button>
              }
            />
          ) : !data.items.length ? (
            <EmptyState
              title="This inventory page is no longer available"
              description={`${data.total.toLocaleString()} registered items are available. Return to the first page to browse them.`}
              action={
                <Button
                  variant="outline"
                  disabled={isFetching}
                  onClick={() => onPage(0)}
                >
                  First page
                </Button>
              }
            />
          ) : (
            <>
              <p role="status" className="text-xs text-muted-foreground">
                Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
                {data.total.toLocaleString()} registered items
              </p>
              <ul
                aria-label="System inventory items"
                className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3"
              >
                {data.items.map((item) => {
                  const kind =
                    item.kind === "asset"
                      ? "Asset"
                      : item.kind === "equipment"
                        ? "Equipment"
                        : item.itemType === "gateway"
                          ? "Gateway"
                          : "Device";
                  const location = inventoryLocation(item.zone, item.location);
                  return (
                    <li key={item.ref} className="min-w-0">
                      <Link
                        href={itemHref(item.ref, "overview", returnTo)}
                        aria-label={`Open ${item.name}`}
                        className="flex h-full min-w-0 flex-col gap-3 rounded-lg border p-3 transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                      >
                        <div className="flex items-start gap-3">
                          <span className="rounded-md border border-info/20 bg-info/5 p-2 text-info">
                            <EquipmentSymbol
                              type={item.itemType}
                              className="size-5"
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <strong className="block break-words text-sm leading-snug">
                              {item.name}
                            </strong>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {kind}
                              {item.kind !== "equipment" &&
                                item.itemType.toLowerCase() !==
                                  kind.toLowerCase() && (
                                  <> · {item.itemType.replaceAll("_", " ")}</>
                                )}
                              {item.aas && " · AAS"}
                              {item.equipmentId && " · 3D"}
                            </p>
                          </div>
                          <ArrowRight
                            aria-hidden
                            className="mt-1 size-4 shrink-0 text-muted-foreground"
                          />
                        </div>
                        {location && (
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <MapPin
                              aria-hidden
                              className="mt-0.5 size-3 shrink-0"
                            />
                            <span className="min-w-0 break-words">
                              {location}
                            </span>
                          </p>
                        )}
                        <div className="mt-auto space-y-2 border-t pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={item.status} />
                            <span className="text-xs capitalize text-muted-foreground">
                              {item.mode} evidence
                            </span>
                          </div>
                          <p className="break-words text-xs text-muted-foreground">
                            {item.route}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <SampleTime
                              value={item.sampleAt ?? item.lastObserved}
                            />
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!error && data && data.total > 0 && (
            <nav
              aria-label="System inventory pages"
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
            >
              <span className="text-xs text-muted-foreground">
                {data.items.length > 0
                  ? `Page ${page + 1} of ${Math.ceil(data.total / pageSize)}`
                  : "Choose an available page"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous items"
                  disabled={isFetching || page === 0}
                  onClick={() => onPage(page - 1)}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next items"
                  disabled={
                    isFetching ||
                    data.items.length === 0 ||
                    (page + 1) * pageSize >= data.total
                  }
                  onClick={() => onPage(page + 1)}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </nav>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
