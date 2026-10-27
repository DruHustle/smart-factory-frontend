import { currentSample } from "@shared/measurements";
import { LinkedModelPreview } from "@/components/workspace/OverviewGraphics";
import { ObservationValues } from "@/components/workspace/ObservationValues";
import DeviceActions from "@/components/workspace/DeviceActions";
import {
  ItemActivity,
  ItemTelemetry,
  AssetTelemetry,
} from "@/components/workspace/ItemEvidence";
import { lazy, Suspense, useRef, useEffect } from "react";
import { loadEquipmentRenderer } from "@/components/equipment/loadRenderer";
import { Link, useParams } from "wouter";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { canViewEngineering } from "@/lib/access";
import { itemHref, type InventoryItem } from "@shared/inventory";
import {
  PageHeader,
  SectionNav,
  EmptyState,
  StatusBadge,
  SampleTime,
  CopyIdentifier,
} from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SecuritySummary from "@/components/SecuritySummary";
const Aas = lazy(() => import("./AssetAdministrationShell"));
const Device = lazy(() => import("./DeviceDetail"));
const loadEquipment = () => import("./EquipmentView");
const Equipment = lazy(loadEquipment);
export default function ItemWorkspace() {
  const opened3D = useRef<string | null>(null);
  const params = useParams<{ ref: string; section?: string }>();
  const { user } = useAuth();
  const [location, navigate] = useHashLocation();
  let ref = params.ref ?? "";
  try {
    ref = decodeURIComponent(ref);
  } catch {
    /* Invalid references render the unavailable state. */
  }
  const query = new URLSearchParams(location.split("?")[1] ?? "");
  const returnTo = query.get("return");
  const safeReturn =
    returnTo?.startsWith("/?") ||
    returnTo?.startsWith("/inventory?") ||
    returnTo?.startsWith("/cybersecurity?") ||
    returnTo?.startsWith("/monitoring?") ||
    returnTo?.startsWith("/analytics?") ||
    returnTo?.startsWith("/alerts?") ||
    /^\/alerts\/[1-9]\d*(\?|$)/.test(returnTo ?? "") ||
    ["/inventory", "/", "/monitoring", "/analytics", "/alerts"].includes(
      returnTo ?? "",
    )
      ? returnTo!
      : "/inventory";
  const item = trpc.inventory.item.useQuery(
    { ref },
    {
      enabled: /^(asset:\d+|device:\d+|equipment:[a-f0-9-]{36})$/.test(ref),
      refetchInterval: 30000,
    },
  );
  const connections = trpc.assets.getConnections.useQuery(
    { id: Number(ref.split(":")[1]) },
    { enabled: ref.startsWith("asset:") && canViewEngineering(user?.role) },
  );
  const security = trpc.security.availability.useQuery();
  const utils = trpc.useUtils();
  const inspectionRequested = params.section === "3d";
  useEffect(() => {
    if (!inspectionRequested) return;
    // Fetch code alongside authorized item metadata instead of three serial
    // chunk/API round trips. No model bytes are fetched before authorization.
    void loadEquipment().catch(() => {});
    void loadEquipmentRenderer().catch(() => {});
  }, [inspectionRequested]);
  useEffect(() => {
    if (inspectionRequested && item.data?.equipmentId)
      void utils.equipment.get.prefetch(
        { id: item.data.equipmentId, mode: undefined },
        { staleTime: 15000 },
      );
  }, [inspectionRequested, item.data?.equipmentId, utils]);
  if (item.isLoading) return <EmptyState title="Loading item workspace…" />;
  if (item.error || !item.data)
    return (
      <EmptyState
        error
        title="Item unavailable"
        description={item.error?.message ?? "Check this typed item link."}
        action={
          <Button asChild variant="outline">
            <Link href={safeReturn}>Return to inventory</Link>
          </Button>
        }
      />
    );
  const i = item.data,
    engineering = canViewEngineering(user?.role),
    gateway = i.kind === "device" && i.itemType === "gateway";
  let sections = [["overview", "Overview"]];
  if (i.kind === "asset")
    sections.push(
      ["telemetry", "Telemetry"],
      ...(engineering
        ? [
            ["aas", "AAS & submodels"],
            ["connections", "Connections"],
            ["activity", "Activity"],
          ]
        : []),
    );
  if (i.kind === "device")
    sections.push(
      ...(gateway
        ? [
            ["connected", "Connected items"],
            ["connectivity", "Connectivity"],
            ["diagnostics", "Diagnostics"],
          ]
        : [
            ["telemetry", "Telemetry"],
            ["connectivity", "Connectivity"],
          ]),
      ["activity", "Activity"],
      ...(engineering && !gateway ? [["thresholds", "Thresholds"]] : []),
      ...(i.firmware && engineering ? [["firmware", "Firmware"]] : []),
    );
  if (i.equipmentId)
    sections.push(
      ["3d", "3D inspection"],
      ["components", "Components / BOM"],
      ["observations", "Observations"],
      ["views", "Saved views"],
    );
  if (security.data?.enabled && i.kind !== "equipment")
    sections.push(["security", "Security"]);
  if (
    user?.access?.canEngineer &&
    !i.isDemo &&
    i.kind === "asset" &&
    connections.data?.some((c) => c.protocol === "ada031_v4_serial")
  )
    sections.push(["control", "Control"]);
  const section = params.section ?? "overview";
  const is3D =
    ["3d", "components", "observations", "views"].includes(section) &&
    !!i.equipmentId;
  if (is3D) opened3D.current = i.equipmentId;
  return (
    <div className={`min-w-0 ${is3D ? "space-y-3" : "space-y-5"}`}>
      <PageHeader
        title={i.name}
        eyebrow={
          <Link href={safeReturn} className="underline underline-offset-4">
            {safeReturn === "/" || safeReturn.startsWith("/?")
              ? "Overview / Return to overview"
              : safeReturn.startsWith("/cybersecurity")
                ? "Cybersecurity / Return to investigation"
                : safeReturn.startsWith("/monitoring")
                  ? "Monitoring / Return to observations"
                  : safeReturn.startsWith("/alerts")
                    ? "Alerts / Return to investigation"
                    : safeReturn === "/analytics"
                      ? "Analytics / Return to analysis"
                      : "Assets & devices / Return to results"}
          </Link>
        }
        description={`${i.itemType} · ${i.zone || i.location || "Location unspecified"}`}
        action={
          <>
            <StatusBadge status={i.status} />
            {i.kind === "device" && !i.isDemo && (
              <DeviceActions id={Number(i.id)} name={i.name} />
            )}
          </>
        }
      />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Item identity
        </summary>
        <div className="mt-2">
          <CopyIdentifier value={i.identifier} />
          <p className="mt-1 text-muted-foreground">{i.ref}</p>
        </div>
      </details>
      <div
        className={`flex flex-wrap items-center rounded-lg border bg-card ${is3D ? "gap-2 p-2 text-xs" : "gap-3 p-3 text-sm"}`}
      >
        <Badge variant="outline" className="capitalize">
          {i.mode} evidence
        </Badge>
        <span>{i.route}</span>
        <span>
          Sample:{" "}
          <SampleTime value={i.sampleAt} historical={!currentSample(i)} />
        </span>
        {i.lifecycle && (
          <span className="capitalize">Lifecycle: {i.lifecycle}</span>
        )}
      </div>
      <SectionNav
        label="Item sections"
        value={section}
        sections={sections.map(([id, label]) => ({ id, label }))}
        onChange={(v) => navigate(itemHref(ref, v, safeReturn))}
      >
        {!sections.some((s) => s[0] === section) ? (
          <EmptyState
            error
            title="Section unavailable"
            description="This capability is unsupported or your role cannot access it."
          />
        ) : section === "overview" ? (
          <div className="space-y-5">
            {i.equipmentId && (
              <section className="rounded-lg border bg-card p-4">
                <LinkedModelPreview item={i} returnTo={location} />
              </section>
            )}
            <ItemOverview
              item={i}
              engineering={engineering}
              returnTo={safeReturn}
            />
            {engineering && i.kind === "asset" && (
              <Suspense
                fallback={<EmptyState title="Loading engineering summary…" />}
              >
                <Aas embedded itemId={Number(i.id)} section="overview" />
              </Suspense>
            )}
          </div>
        ) : section === "security" ? (
          <SecuritySummary
            kind={i.kind as "asset" | "device"}
            id={Number(i.id)}
          />
        ) : section === "activity" && i.kind === "device" ? (
          <ItemActivity item={i} />
        ) : section === "telemetry" && i.kind === "asset" && !engineering ? (
          <AssetTelemetry item={i} />
        ) : section === "telemetry" && i.kind === "device" && !gateway ? (
          <ItemTelemetry item={i} />
        ) : section === "firmware" ? (
          <EmptyState
            title="Firmware delivery unavailable"
            description="No verified firmware service and device update agent are connected. No update will be queued."
          />
        ) : (
          <Suspense fallback={<EmptyState title="Loading section…" />}>
            {is3D ? null : i.kind === "asset" ? (
              <Aas embedded itemId={Number(i.id)} section={section} />
            ) : i.kind === "device" ? (
              <Device embedded itemId={Number(i.id)} section={section} />
            ) : (
              <EmptyState title="Capability unavailable" />
            )}
          </Suspense>
        )}
        {opened3D.current === i.equipmentId && i.equipmentId && (
          <div hidden={!is3D} aria-hidden={!is3D}>
            <Suspense
              fallback={<EmptyState title="Loading local 3D workspace…" />}
            >
              <Equipment
                embedded
                equipmentId={i.equipmentId}
                section={is3D ? section : "3d"}
                active={is3D}
              />
            </Suspense>
          </div>
        )}
      </SectionNav>
    </div>
  );
}
function ItemOverview({
  item: i,
  engineering,
  returnTo,
}: {
  item: InventoryItem;
  engineering: boolean;
  returnTo: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Identity & capabilities</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
          <dt className="text-muted-foreground">Record</dt>
          <dd className="break-all">{i.ref}</dd>
          <dt className="text-muted-foreground">Zone / location</dt>
          <dd>
            {[i.zone, i.location].filter(Boolean).join(" · ") || "Unspecified"}
          </dd>
          <dt className="text-muted-foreground">AAS</dt>
          <dd>
            {i.aas
              ? "Available · engineering permission required"
              : "Independent item · no AAS required"}
          </dd>
          <dt className="text-muted-foreground">3D</dt>
          <dd>
            {i.equipmentId
              ? "Explicit linked representation"
              : "No linked representation"}
          </dd>
        </dl>
        {i.aas && engineering && (
          <Button asChild variant="outline">
            <Link href={itemHref(i.ref, "aas", returnTo)}>
              Open AAS engineering
            </Link>
          </Button>
        )}
      </section>
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="font-semibold">Observed evidence</h2>
        <ObservationValues
          reading={{
            ...i.values,
            measurements: i.measurements,
            integration: { sourceQuality: i.quality },
          }}
        />
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Configuration</dt>
            <dd>
              {i.configured
                ? "Connection configured · availability assessed separately"
                : "Never configured"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Connectivity observation</dt>
            <dd>
              <SampleTime value={i.lastObserved} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Telemetry</dt>
            <dd>
              <SampleTime value={i.sampleAt} historical={!currentSample(i)} /> ·{" "}
              {i.quality} quality
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Freshness policy</dt>
            <dd>
              {i.freshnessMs
                ? `${i.freshnessMs / 1000} seconds for this source`
                : "No commissioned freshness policy; current availability unknown"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          A configured link or receiving gateway does not prove this item is
          live or secure. Historical and simulated observations retain their
          provenance.
        </p>
      </section>
    </div>
  );
}
