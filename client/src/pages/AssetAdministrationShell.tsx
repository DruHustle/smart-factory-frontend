import { SectionNav, CopyIdentifier } from "@/components/workspace/Primitives";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import SecuritySummary from "@/components/SecuritySummary";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { canAdministerUsers, canViewEngineering } from "@/lib/access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  FileJson,
  Printer,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  getAllowedAssetTransitions,
  type AssetLifecycleStage,
} from "../../../shared/asset-lifecycle";
import { CreateAssetDialog } from "@/components/CreateAssetDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatValue(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        "language" in entry &&
        "text" in entry,
    )
  ) {
    return value.map((entry) => `${entry.language}: ${entry.text}`).join("\n");
  }
  return JSON.stringify(value, null, 2);
}

function flattenSubmodelElements(
  elements: Array<Record<string, unknown>>,
  parent = "",
): Array<{
  key: string;
  label: string;
  value: unknown;
  modelType?: string;
  valueType?: string;
  contentType?: string;
  semanticIds: string[];
}> {
  return elements.flatMap((element) => {
    const idShort = String(element.idShort ?? "Element");
    const label = parent ? `${parent} · ${idShort}` : idShort;
    const modelType = element.modelType;
    const semanticId = element.semanticId as
      | { keys?: Array<{ value?: string }> }
      | undefined;
    const supplemental = Array.isArray(element.supplementalSemanticIds)
      ? (element.supplementalSemanticIds as Array<{
          keys?: Array<{ value?: string }>;
        }>)
      : [];
    const semanticIds = [semanticId, ...supplemental].flatMap(
      (reference) =>
        reference?.keys
          ?.map((key) => key.value)
          .filter((value): value is string => !!value) ?? [],
    );
    const source = {
      modelType: typeof modelType === "string" ? modelType : undefined,
      valueType:
        typeof element.valueType === "string" ? element.valueType : undefined,
      contentType:
        typeof element.contentType === "string"
          ? element.contentType
          : undefined,
      semanticIds,
    };
    if (
      (modelType === "SubmodelElementCollection" ||
        modelType === "SubmodelElementList") &&
      Array.isArray(element.value)
    ) {
      return [
        { key: `${label}:container`, label, value: undefined, ...source },
        ...flattenSubmodelElements(
          element.value as Array<Record<string, unknown>>,
          label,
        ),
      ];
    }
    return [
      {
        key: `${label}:${String(elementIndexKey(element))}`,
        label,
        value: element.value,
        ...source,
      },
    ];
  });
}

function elementIndexKey(element: Record<string, unknown>) {
  const semanticId = element.semanticId as
    | { keys?: Array<{ value?: string }> }
    | undefined;
  return semanticId?.keys?.[0]?.value ?? "";
}

type Ada031Command =
  | {
      action: "set_profile";
      profile: "pick_and_place_repeat" | "demonstration_moves";
    }
  | { action: "stop_program" }
  | { action: "neutral" }
  | {
      action: "jog";
      joint: "base" | "shoulder" | "elbow" | "wrist_rotation" | "gripper";
      direction: "increase" | "decrease";
    };

function describeAda031Command(command: Ada031Command) {
  if (command.action === "set_profile")
    return command.profile === "pick_and_place_repeat"
      ? "A → B → A repeat profile"
      : "demonstration profile";
  if (command.action === "stop_program") return "stop after the current pose";
  if (command.action === "neutral") return "90° neutral pose";
  return `${command.joint.replaceAll("_", " ")} ${command.direction}`;
}

export default function AssetAdministrationShell({
  itemId,
  section: providedSection,
  embedded = false,
}: { itemId?: number; section?: string; embedded?: boolean } = {}) {
  const [hash, navigate] = useHashLocation();
  const section =
    providedSection ??
    new URLSearchParams(hash.split("?")[1] ?? "").get("section") ??
    "overview";
  const [submodelSearch, setSubmodelSearch] = useState("");
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const assetId = itemId ?? Number(params.id);
  const { user } = useAuth();
  const [nextStage, setNextStage] = useState<AssetLifecycleStage | "">("");
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [armCommandStatus, setArmCommandStatus] = useState<{
    kind: "pending" | "accepted" | "error";
    message: string;
  } | null>(null);
  useEffect(() => {
    setMotionReady(false);
  }, [section, assetId]);
  const utils = trpc.useUtils();
  const allowed = canViewEngineering(user?.role);
  const {
    data: asset,
    isLoading,
    isError: assetError,
    refetch: refetchAsset,
  } = trpc.assets.getById.useQuery(
    { id: assetId },
    { enabled: allowed && Number.isFinite(assetId) },
  );
  const aasReady =
    !!asset &&
    (asset.aasxImported ||
      [
        asset.manufacturer,
        asset.model,
        asset.manufacturerStreet,
        asset.manufacturerZipcode,
        asset.manufacturerCityTown,
        asset.manufacturerNationalCode,
        asset.manufacturerArticleNumber,
        asset.orderCodeOfManufacturer,
      ].every((value) => typeof value === "string" && value.trim().length > 0));
  const shellQuery = trpc.assets.getShell.useQuery(
    { id: assetId },
    {
      enabled:
        allowed &&
        Number.isFinite(assetId) &&
        aasReady &&
        ["aas", "overview"].includes(section),
    },
  );
  const shellData = shellQuery.data;
  const { data: events } = trpc.assets.getLifecycle.useQuery(
    { id: assetId },
    { enabled: allowed && Number.isFinite(assetId) && section === "activity" },
  );
  const { data: versions } = trpc.assets.getVersions.useQuery(
    { id: assetId },
    { enabled: allowed && Number.isFinite(assetId) && section === "activity" },
  );
  const connectionsQuery = trpc.assets.getConnections.useQuery(
    { id: assetId },
    {
      enabled: allowed && Number.isFinite(assetId),
      refetchInterval: ["connections", "telemetry", "control"].includes(section)
        ? 3000
        : false,
    },
  );
  const connections = connectionsQuery.data;
  const armConnection = connections?.find(
    (connection) => connection.protocol === "ada031_v4_serial",
  );
  const latestArmReadingQuery = trpc.analytics.getLatestAssetTelemetry.useQuery(
    { assetId: asset?.assetId ?? "" },
    {
      enabled:
        allowed &&
        !!armConnection &&
        !!asset &&
        ["telemetry", "control"].includes(section),
      refetchInterval: 500,
    },
  );
  const latestArmReading = latestArmReadingQuery.data;
  const telemetryEnd = useMemo(() => Date.now(), [assetId]);
  const telemetryStart = telemetryEnd - 24 * 60 * 60 * 1000;
  const telemetry = trpc.analytics.getAssetTelemetry.useQuery(
    {
      assetIds: asset ? [asset.assetId] : [],
      startTime: telemetryStart,
      endTime: telemetryEnd,
      intervalMs: 15 * 60 * 1000,
    },
    { enabled: allowed && !!asset && section === "telemetry" },
  );
  const transition = trpc.assets.transition.useMutation({
    onSuccess: async () => {
      toast.success("Lifecycle stage updated");
      setNote("");
      setNextStage("");
      await Promise.all([
        utils.assets.getById.invalidate({ id: assetId }),
        utils.assets.getLifecycle.invalidate({ id: assetId }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const publishGatewayConfiguration =
    trpc.assets.publishGatewayConfiguration.useMutation({
      onSuccess: (result) =>
        result.published
          ? toast.success("Edge profile published", {
              description:
                "The broker accepted the desired profile. Check the gateway acknowledgement topic to confirm it was applied.",
            })
          : toast.error("Edge provisioner is not configured", {
              description:
                "Configure DeviceService and MQTT before publishing a live gateway profile.",
            }),
      onError: (error) => toast.error(error.message),
    });
  const controlAda031 = trpc.assets.controlAda031.useMutation({
    onMutate: ({ command }) =>
      setArmCommandStatus({
        kind: "pending",
        message: `Sending ${describeAda031Command(command)}…`,
      }),
    onSuccess: (result, { command }) => {
      const message = `${describeAda031Command(command)} accepted by the gateway broker as ${result.commandId}. Physical movement is not confirmed.`;
      setArmCommandStatus({ kind: "accepted", message });
      toast.success("Arm command published", { description: message });
    },
    onError: (error, { command }) => {
      setArmCommandStatus({
        kind: "error",
        message: `${describeAda031Command(command)} was rejected: ${error.message}`,
      });
      toast.error("ADA031 command was rejected", {
        description: error.message,
      });
    },
  });
  const restoreVersion = trpc.assets.restoreVersion.useMutation({
    onSuccess: async () => {
      toast.success("Historical AAS restored as a new revision");
      await Promise.all([
        utils.assets.list.invalidate(),
        utils.assets.getById.invalidate({ id: assetId }),
        utils.assets.getShell.invalidate({ id: assetId }),
        utils.assets.getVersions.invalidate({ id: assetId }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteAas = trpc.assets.delete.useMutation({
    onSuccess: ({ edgeSyncFailures }) => {
      toast.success(
        edgeSyncFailures.length
          ? "AAS deleted; one or more gateways need configuration resync"
          : "AAS deleted",
      );
      void utils.assets.list.invalidate();
      setLocation("/assets");
    },
    onError: (error) =>
      toast.error(`AAS could not be deleted: ${error.message}`),
  });

  const currentStage = asset?.lifecycleStage;
  const availableStages = useMemo(
    () => (currentStage ? getAllowedAssetTransitions(currentStage) : []),
    [currentStage],
  );

  const exportAas = async () => {
    try {
      const environment = await utils.assets.exportAas.fetch({ id: assetId });
      if (!environment) throw new Error("AAS was not found");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(environment, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(asset?.assetId ?? `asset-${assetId}`).replaceAll(":", "-")}-aas-environment.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not export AAS JSON",
      );
    }
  };

  const downloadGatewayConfig = async (gatewayDeviceId: string) => {
    try {
      const config = await utils.assets.exportGatewayConfiguration.fetch({
        gatewayDeviceId,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${gatewayDeviceId}-asset-connections.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not export gateway configuration",
      );
    }
  };

  const openPassportPrint = () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      toast.error("Print preview was blocked", {
        description:
          "Allow pop-ups for this dashboard, then try Print EUDPP again.",
      });
      return;
    }
    popup.opener = null;
    popup.location.href = `?print=1#/passport/${assetId}`;
  };

  const sendArmCommand = (command: Ada031Command) => {
    if (!asset || !motionReady || controlAda031.isPending) return;
    controlAda031.mutate({ id: asset.id, command });
  };

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <h1 className="text-xl font-semibold">Engineering access required</h1>
          <p className="mt-2 text-muted-foreground">
            Ask an administrator to assign the engineer role to view this AAS.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (isLoading)
    return (
      <div
        className="flex justify-center gap-3 py-16 text-sm text-muted-foreground"
        role="status"
      >
        <RefreshCw aria-hidden="true" className="h-7 w-7 animate-spin" />
        Loading Asset Administration Shell…
      </div>
    );
  if (assetError)
    return (
      <Card>
        <CardContent className="py-12 text-center" role="alert">
          <h1 className="text-xl font-semibold">
            Asset Administration Shell unavailable
          </h1>
          <p className="mt-2 text-muted-foreground">
            The asset record could not be loaded. Check the service connection
            and try again.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void refetchAsset()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  if (!asset)
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <h1 className="text-xl font-semibold">Asset was not found</h1>
          <p className="mt-2 text-muted-foreground">
            Check the asset link or return to the Assets page.
          </p>
        </CardContent>
      </Card>
    );

  const shell = shellData?.shell as Record<string, unknown> | undefined;
  const submodels = shellData?.submodels ?? [];
  const assetInformation = shell?.assetInformation as
    | Record<string, unknown>
    | undefined;
  const armTelemetry = telemetry.data?.assets[0];
  const latestSignals = latestArmReading?.assetSignals as
    | Record<string, number>
    | null
    | undefined;
  const signal = (name: string) =>
    latestSignals?.[name] ??
    armTelemetry?.assetSignals.find((entry) => entry.name === name)?.latest;
  const completedCycles = signal("successful_cycles") ?? 0;
  const interruptedCycles = signal("interrupted_cycles") ?? 0;
  const failedCycles = signal("failed_cycles") ?? 0;
  const cycleTotal =
    signal("cycle_count") ?? completedCycles + interruptedCycles + failedCycles;
  const activeProfile = signal("active_profile");
  const latestSampleTimestamp =
    latestArmReading?.timestamp ?? armTelemetry?.latestReadingAt ?? null;
  const latestSampleDate = latestSampleTimestamp
    ? new Date(latestSampleTimestamp)
    : null;
  const armConnectionLastSeen = armConnection?.lastSeen
    ? new Date(armConnection.lastSeen)
    : null;
  const armEvidenceAt =
    latestSampleDate && !Number.isNaN(latestSampleDate.getTime())
      ? latestSampleDate
      : armConnectionLastSeen;
  const armConnected =
    !!armEvidenceAt &&
    !Number.isNaN(armEvidenceAt.getTime()) &&
    Date.now() - armEvidenceAt.getTime() <= 120_000;

  return (
    <>
      <div className="space-y-6">
        {!embedded && (
          <SectionNav
            label="Asset sections"
            value={section}
            sections={[
              { id: "overview", label: "Overview" },
              { id: "telemetry", label: "Telemetry" },
              { id: "aas", label: "AAS & submodels" },
              { id: "connections", label: "Connections" },
              { id: "activity", label: "Activity" },
              ...(armConnection ? [{ id: "control", label: "Control" }] : []),
              { id: "security", label: "Security" },
            ]}
            onChange={(v) => navigate(`/assets/${asset.id}/aas?section=${v}`)}
          />
        )}
        {section === "security" && (
          <SecuritySummary kind="asset" id={asset.id} />
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              Asset Administration Shell
            </p>
            {!embedded && (
              <h1 className="text-2xl font-semibold tracking-tight">
                {asset.name}
              </h1>
            )}
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {asset.assetId}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="w-fit capitalize">
              {asset.lifecycleStage}
            </Badge>
            <Badge variant="secondary">AAS revision {asset.aasVersion}</Badge>
            {!asset.isDemo && !asset.aasxImported && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <FileJson className="mr-2 h-4 w-4" />
                Edit asset data
              </Button>
            )}
            <Button variant="outline" onClick={exportAas} disabled={!aasReady}>
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              Export AAS JSON
            </Button>
            <Button variant="outline" onClick={openPassportPrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print EUDPP
            </Button>
            {canAdministerUsers(user?.role) && !asset.isDemo && (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete AAS
              </Button>
            )}
          </div>
        </div>

        {section !== "overview" && asset.isDemo && (
          <p role="status" className="rounded border bg-muted/30 p-3 text-sm">
            <strong>Simulated engineering data.</strong> Demonstration records
            do not establish live plant state.
          </p>
        )}
        {section !== "overview" && asset.aasxImported && (
          <p role="status" className="rounded border bg-muted/30 p-3 text-sm">
            <strong>Imported AASX package.</strong> Vendor structures are
            preserved. Live connectivity is assessed separately.
          </p>
        )}
        {section === "overview" && (
          <>
            {!aasReady && !asset.isDemo && !asset.aasxImported && (
              <div
                role="alert"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
              >
                <strong>
                  Complete the manufacturer identity and postal address to make
                  this AAS template conformant.
                </strong>
                <p className="mt-1">
                  IDTA Digital Nameplate requires street, postal code, city, and
                  a two-letter country code. Edit the asset details, then export
                  the refreshed AAS.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                >
                  Complete manufacturer details
                </Button>
              </div>
            )}

            {asset.isDemo && (
              <div
                role="status"
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm"
              >
                <strong>Simulated engineering data.</strong> This shell is
                served by the API demo scenario. Lifecycle changes are disabled
                for demo assets.
              </div>
            )}
            {asset.aasxImported && (
              <div
                role="status"
                className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-4 text-sm"
              >
                <strong>Imported AASX package.</strong> The vendor shell and
                submodels are preserved as received. Edit their model in the
                connected AAS repository to retain its original template
                structure.
                {asset.aasxPackageId && (
                  <p className="mt-1 font-mono text-xs">
                    Package ID: {asset.aasxPackageId}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {shellData?.shell && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileJson className="h-4 w-4" />
                      Shell identity
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Model type</span>
                      <span>
                        {formatValue(
                          shell?.modelType ?? "AssetAdministrationShell",
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        Global asset ID
                      </span>
                      <span className="font-mono text-xs">
                        {formatValue(
                          assetInformation?.globalAssetId ?? asset.assetId,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Asset kind</span>
                      <span>
                        {formatValue(assetInformation?.assetKind ?? "Instance")}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Submodels</span>
                      <span>{submodels.length}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Lifecycle management</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label htmlFor="lifecycle-stage">Move to stage</Label>
                  <Select
                    value={nextStage}
                    onValueChange={(value) =>
                      setNextStage(value as typeof nextStage)
                    }
                    disabled={asset.isDemo}
                  >
                    <SelectTrigger id="lifecycle-stage">
                      <SelectValue placeholder="Select next stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStages.map((stage) => (
                        <SelectItem
                          key={stage}
                          value={stage}
                          className="capitalize"
                        >
                          {stage}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label htmlFor="lifecycle-note">Change note</Label>
                  <Input
                    id="lifecycle-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Reason, work order, or engineering reference"
                    disabled={asset.isDemo}
                  />
                  <Button
                    className="w-full"
                    disabled={
                      asset.isDemo || !nextStage || transition.isPending
                    }
                    onClick={() =>
                      nextStage &&
                      transition.mutate({
                        id: asset.id,
                        toStage: nextStage,
                        note: note || undefined,
                      })
                    }
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Record lifecycle transition
                  </Button>
                </CardContent>
              </Card>
            </div>
          </>
        )}
        {section === "aas" && (
          <>
            <label className="block text-sm">
              Search submodels
              <Input
                value={submodelSearch}
                onChange={(e) => setSubmodelSearch(e.target.value)}
                placeholder="Submodel name, identifier or property"
              />
            </label>
            {shellQuery.isLoading && aasReady && (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  Loading AAS model…
                </CardContent>
              </Card>
            )}

            {shellData?.shell && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">AAS submodels</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {submodels
                    .filter((sm) =>
                      JSON.stringify(sm)
                        .toLowerCase()
                        .includes(submodelSearch.toLowerCase()),
                    )
                    .map((submodel, index) => {
                      const elements = flattenSubmodelElements(
                        (submodel.submodelElements as
                          | Array<Record<string, unknown>>
                          | undefined) ?? [],
                      );
                      const semanticId = submodel.semanticId as
                        | { keys?: Array<{ value?: string }> }
                        | undefined;
                      return (
                        <details
                          className="rounded-lg border bg-card"
                          key={String(submodel.id ?? index)}
                        >
                          <summary className="cursor-pointer p-4 font-medium">
                            {String(submodel.idShort ?? "Submodel")}
                          </summary>
                          <Card className="border-0 shadow-none">
                            <CardHeader className="pb-3">
                              <CardTitle>
                                {String(submodel.idShort ?? "Submodel")}
                              </CardTitle>
                              <CopyIdentifier
                                value={String(submodel.id ?? "")}
                              />
                              <details className="text-xs">
                                <summary className="cursor-pointer">
                                  Technical identifiers
                                </summary>
                                <p className="break-all">
                                  {semanticId?.keys
                                    ?.map((key) => key.value)
                                    .join(", ")}
                                </p>
                                <pre className="whitespace-pre-wrap break-all">
                                  {JSON.stringify(submodel, null, 2)}
                                </pre>
                              </details>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {elements.map((element) => (
                                <div
                                  key={element.key}
                                  className="grid gap-1 border-b pb-2 last:border-0 sm:grid-cols-[minmax(120px,0.8fr)_2fr] sm:gap-4"
                                >
                                  <span className="text-sm capitalize text-muted-foreground">
                                    {element.label.replaceAll(
                                      /([A-Z])/g,
                                      " $1",
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    {element.value !== undefined && (
                                      <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                                        {formatValue(element.value)}
                                      </pre>
                                    )}
                                    {(element.modelType ||
                                      element.valueType ||
                                      element.contentType ||
                                      element.semanticIds.length > 0) && (
                                      <details className="mt-1 text-xs text-muted-foreground">
                                        <summary>Property schema</summary>
                                        <p className="break-all font-mono">
                                          {[
                                            element.modelType,
                                            element.valueType,
                                            element.contentType,
                                            ...element.semanticIds,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </p>
                                      </details>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        </details>
                      );
                    })}
                </div>
              </section>
            )}

            {!!shellData?.conceptDescriptions?.length && (
              <section className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    Concept descriptions
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Imported concept metadata, shown from the package without
                    replacing source definitions.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {shellData.conceptDescriptions.map((description, index) => {
                    const concept = description as Record<string, unknown>;
                    return (
                      <Card key={String(concept.id ?? index)}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            {String(concept.idShort ?? "Concept description")}
                          </CardTitle>
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {String(concept.id ?? "")}
                          </p>
                        </CardHeader>
                        <CardContent>
                          <pre className="whitespace-pre-wrap break-words text-xs">
                            {formatValue(concept)}
                          </pre>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
        {section === "telemetry" && !armConnection && (
          <Card>
            <CardHeader>
              <CardTitle>Asset telemetry</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {telemetry.error
                  ? "Telemetry unavailable. Try again later."
                  : telemetry.data?.overall.sampleCount
                    ? "Historical aggregate samples are available in Analytics."
                    : "No telemetry observations for this asset in the selected range."}
              </p>
              <Button
                variant="outline"
                onClick={() => setLocation("/analytics")}
              >
                Open telemetry analytics
              </Button>
            </CardContent>
          </Card>
        )}
        {section === "telemetry" && armConnection && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  ADA031 live telemetry & performance
                </CardTitle>
                <Badge
                  className={
                    armConnected
                      ? "bg-success text-success-foreground"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {armConnected ? "Connected" : "Offline"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Latest controller movement refreshes twice per second.
                Historical aggregates cover the last 24 hours.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {!armConnected && (
                <div
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  role="alert"
                >
                  <p className="font-medium">
                    Arm configured, but no live serial evidence
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    The USB profile points to{" "}
                    <span className="font-mono">
                      {armConnection.endpoint ?? "an unconfigured endpoint"}
                    </span>
                    , but no recent ADA031 telemetry has reached the dashboard.
                    Install the connected arm firmware, verify the stable serial
                    path on the Pi, add this asset ID to{" "}
                    <span className="font-mono">ADA031_CONTROL_ASSET_IDS</span>,
                    apply the gateway profile, and restart{" "}
                    <span className="font-mono">smart-factory-edge</span>.
                  </p>
                </div>
              )}
              {(latestArmReadingQuery.isError || telemetry.isError) && (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                  role="alert"
                >
                  <p className="font-medium">
                    ADA031 telemetry could not be refreshed
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    The values below may be unavailable or stale. This does not
                    change the arm state.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void Promise.all([
                        latestArmReadingQuery.refetch(),
                        telemetry.refetch(),
                      ])
                    }
                  >
                    Try telemetry again
                  </Button>
                </div>
              )}
              {(latestArmReadingQuery.isLoading || telemetry.isLoading) && (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading ADA031 telemetry…
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Cycles since boot", cycleTotal],
                  ["Completed", completedCycles],
                  ["Interrupted", interruptedCycles],
                  [
                    "Success rate",
                    cycleTotal
                      ? `${((completedCycles / cycleTotal) * 100).toFixed(1)}%`
                      : "—",
                  ],
                  [
                    "Latest cycle",
                    signal("cycle_time_ms") != null
                      ? `${(signal("cycle_time_ms")! / 1000).toFixed(1)} s`
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    Controller mode
                  </p>
                  <p className="mt-1 font-semibold">
                    {activeProfile === 1
                      ? "A → B → A repeat"
                      : activeProfile === 2
                        ? "Demonstration"
                        : "Idle"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Sequence step</p>
                  <p className="mt-1 font-semibold">
                    {signal("sequence_step") === 1
                      ? "A · outbound"
                      : signal("sequence_step") === 2
                        ? "B"
                        : signal("sequence_step") === 3
                          ? "A · return"
                          : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Motion state</p>
                  <p className="mt-1 font-semibold">
                    {signal("movement_active") === 1
                      ? "Moving"
                      : latestSignals
                        ? "Holding"
                        : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Board button</p>
                  <p className="mt-1 font-semibold">
                    {signal("button_pressed") === 1
                      ? "Pressed"
                      : latestSignals
                        ? "Released"
                        : "—"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    Pot calibration
                  </p>
                  <p className="mt-1 font-semibold">
                    {signal("calibration_mode") === 1
                      ? signal("pots_matched") === 1
                        ? "Live · matched"
                        : "Waiting for match"
                      : "Off"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Latest sample</p>
                  <p className="mt-1 font-semibold">
                    {latestSampleDate &&
                    !Number.isNaN(latestSampleDate.getTime()) ? (
                      <time
                        dateTime={latestSampleDate.toISOString()}
                        title={latestSampleDate.toLocaleString()}
                      >
                        {latestSampleDate.toLocaleTimeString()}
                      </time>
                    ) : (
                      "No telemetry"
                    )}
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                {[1, 2, 3, 4, 5].map((servo) => (
                  <div
                    key={servo}
                    className="rounded-md bg-muted p-2 text-center text-sm"
                  >
                    <span className="text-muted-foreground">Servo {servo}</span>
                    <br />
                    <strong>{signal(`servo_${servo}_deg`) ?? "—"}°</strong>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                {[1, 2, 3, 4, 5].map((pot) => {
                  const value = signal(`pot_${pot}_deg`);
                  return value == null ? null : (
                    <div
                      key={pot}
                      className="rounded-md border p-2 text-center text-sm"
                    >
                      <span className="text-muted-foreground">Pot {pot}</span>
                      <br />
                      <strong>{value}°</strong>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Servo values are commanded targets; this arm has no joint
                feedback sensors. An interrupted cycle means an operator stop,
                not a physical fault. The controller cannot detect failed
                motion, so the legacy failed-cycle count remains zero unless
                future sensing is added. Voltage, current, and servo temperature
                also require additional sensors.
              </p>
            </CardContent>
          </Card>
        )}

        {section === "control" && armConnection && (
          <Card className="border-amber-500/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                ADA031 operation control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                id="ada031-safety-note"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              >
                <p className="font-medium">
                  One click sends one vendor serial command at 9600 baud.
                </p>
                <p className="mt-1 text-muted-foreground">
                  The connected firmware clamps servos 1–4 to 0–180° and the
                  gripper servo to 35–90°. Treat these as commissioned software
                  limits and verify mechanical travel. The first USB serial open
                  after startup resets the controller and moves the five
                  controlled servos to 90°. Reported angles are commanded
                  targets, not measured joint positions. This control is not an
                  emergency stop.
                </p>
              </div>
              <label
                htmlFor="ada031-motion-ready"
                className="flex cursor-pointer items-start gap-3 text-sm"
              >
                <Checkbox
                  id="ada031-motion-ready"
                  aria-describedby="ada031-safety-note"
                  checked={motionReady}
                  onCheckedChange={(checked) =>
                    setMotionReady(checked === true)
                  }
                />
                <span>
                  I have cleared and secured the motion area, verified the
                  temporary limits for this arm, and am prepared for the initial
                  USB reset movement.
                </span>
              </label>
              <fieldset
                className="space-y-3"
                aria-busy={controlAda031.isPending}
                aria-describedby="ada031-command-note"
              >
                <legend className="sr-only">ADA031 motion commands</legend>
                <div className="grid gap-3 md:grid-cols-2">
                  <Button
                    className="h-auto min-w-0 whitespace-normal"
                    disabled={!motionReady || controlAda031.isPending}
                    onClick={() =>
                      sendArmCommand({
                        action: "set_profile",
                        profile: "pick_and_place_repeat",
                      })
                    }
                  >
                    Run pick A → B → A repeatedly
                  </Button>
                  <Button
                    className="h-auto min-w-0 whitespace-normal"
                    disabled={!motionReady || controlAda031.isPending}
                    onClick={() =>
                      sendArmCommand({
                        action: "set_profile",
                        profile: "demonstration_moves",
                      })
                    }
                  >
                    Run pickup / rotate demonstration
                  </Button>
                  <Button
                    className="h-auto min-w-0 whitespace-normal"
                    variant="outline"
                    disabled={!motionReady || controlAda031.isPending}
                    onClick={() => sendArmCommand({ action: "stop_program" })}
                  >
                    <Square className="mr-2 h-4 w-4 shrink-0" />
                    Stop after current pose
                  </Button>
                  <Button
                    className="h-auto min-w-0 whitespace-normal"
                    variant="destructive"
                    disabled={!motionReady || controlAda031.isPending}
                    onClick={() => sendArmCommand({ action: "neutral" })}
                  >
                    <RotateCcw className="mr-2 h-4 w-4 shrink-0" />
                    Neutral: set all servos to 90°
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(
                    [
                      ["base", "Base", "±1° per click"],
                      ["shoulder", "Shoulder", "±1° per click"],
                      ["elbow", "Elbow", "±1° per click"],
                      ["wrist_rotation", "Wrist rotation", "±1° per click"],
                      ["gripper", "Gripper", "±10° per click"],
                    ] as const
                  ).map(([joint, label, step]) => (
                    <div
                      key={joint}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{step}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          aria-label={`${label} decrease`}
                          title={`Decrease ${label}`}
                          variant="outline"
                          size="icon"
                          disabled={!motionReady || controlAda031.isPending}
                          onClick={() =>
                            sendArmCommand({
                              action: "jog",
                              joint,
                              direction: "decrease",
                            })
                          }
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={`${label} increase`}
                          title={`Increase ${label}`}
                          variant="outline"
                          size="icon"
                          disabled={!motionReady || controlAda031.isPending}
                          onClick={() =>
                            sendArmCommand({
                              action: "jog",
                              joint,
                              direction: "increase",
                            })
                          }
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
              {armCommandStatus && (
                <div
                  role={armCommandStatus.kind === "error" ? "alert" : "status"}
                  aria-live="polite"
                  className={`rounded-md border p-3 text-sm ${armCommandStatus.kind === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted/40 text-muted-foreground"}`}
                >
                  {armCommandStatus.message}
                </div>
              )}
              <p
                id="ada031-command-note"
                className="text-xs text-muted-foreground"
              >
                Commands stay disabled on the gateway until this asset ID is
                added to ADA031_CONTROL_ASSET_IDS. Broker publication and serial
                write acceptance do not confirm physical motion.
              </p>
            </CardContent>
          </Card>
        )}

        {shellQuery.error && (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              AAS data could not be loaded: {shellQuery.error.message}
            </CardContent>
          </Card>
        )}

        {connectionsQuery.error && (
          <Card>
            <CardContent className="py-6 text-sm" role="alert">
              <p className="font-medium text-destructive">
                Gateway connections could not be loaded.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => void connectionsQuery.refetch()}
              >
                Try connections again
              </Button>
            </CardContent>
          </Card>
        )}

        {section === "activity" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>AAS version history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {versions?.length ? (
                  versions.map((version) => (
                    <div
                      key={version.version}
                      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium">
                          Revision {version.version}
                          {version.version === asset.aasVersion
                            ? " · current"
                            : ""}{" "}
                          · {version.changeType}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {version.changeNote || "No change note"} ·{" "}
                          {new Date(version.createdAt).toLocaleString()}
                        </p>
                        <p className="break-all font-mono text-[11px] text-muted-foreground">
                          SHA-256:{" "}
                          {version.sha256 ??
                            "not available for pre-history baseline"}
                        </p>
                      </div>
                      {!asset.isDemo &&
                        !asset.aasxImported &&
                        version.version < asset.aasVersion && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={restoreVersion.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Restore revision ${version.version}? This creates revision ${asset.aasVersion + 1} and keeps the current revision in history.`,
                                )
                              ) {
                                restoreVersion.mutate({
                                  id: asset.id,
                                  sourceVersion: version.version,
                                  expectedVersion: asset.aasVersion,
                                });
                              }
                            }}
                          >
                            Restore as new revision
                          </Button>
                        )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No version snapshots have been recorded.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
        {section === "connections" && (
          <Card>
            <CardHeader>
              <CardTitle>Gateway connections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {connections?.length ? (
                connections.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {connection.protocol === "mqtt_direct"
                          ? "Direct MQTT device"
                          : connection.gatewayName}
                      </p>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {connection.gatewayDeviceId} ·{" "}
                        {connection.protocol === "mqtt_direct"
                          ? "Direct MQTT"
                          : connection.protocol}{" "}
                        ·{" "}
                        {connection.endpoint ??
                          (connection.protocol === "mqtt_direct"
                            ? "Device-scoped CloudAMQP identity"
                            : "MQTT topic mapping")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last reading:{" "}
                        {connection.lastSeen
                          ? new Date(connection.lastSeen).toLocaleString()
                          : "No telemetry received"}
                      </p>
                    </div>
                    {connection.protocol !== "mqtt_direct" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            publishGatewayConfiguration.mutate({
                              gatewayDevicePk: connection.deviceId,
                            })
                          }
                          disabled={publishGatewayConfiguration.isPending}
                        >
                          {publishGatewayConfiguration.isPending
                            ? "Publishing…"
                            : "Deploy edge config"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            downloadGatewayConfig(connection.gatewayDeviceId)
                          }
                        >
                          <ArrowDownToLine className="mr-2 h-4 w-4" />
                          Download profile
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No gateway is assigned. Register an edge gateway and attach it
                  to this asset.
                </p>
              )}
              {!!connections?.length &&
                connections.some(
                  (connection) => connection.protocol !== "mqtt_direct",
                ) && (
                  <p className="text-xs text-muted-foreground">
                    Deployment publishes a retained, versioned configuration
                    message. The gateway validates and atomically applies it;
                    the broker publish result does not confirm gateway
                    acknowledgement. Credentials remain on the gateway.
                  </p>
                )}
              {!!connections?.some(
                (connection) => connection.protocol === "mqtt_direct",
              ) && (
                <p className="text-xs text-muted-foreground">
                  The device publishes directly to CloudAMQP using its own TLS
                  credentials and topic ACL. Add those credentials to the
                  device-side secret store; they are never displayed or stored
                  in the AAS.
                </p>
              )}
            </CardContent>
          </Card>
        )}
        {section === "activity" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Lifecycle history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {events?.length ? (
                <ol className="space-y-4">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <div>
                        <p>
                          <span className="capitalize">
                            {event.fromStage ?? "Created"}
                          </span>{" "}
                          →{" "}
                          <span className="capitalize font-medium">
                            {event.toStage}
                          </span>
                        </p>
                        <p className="text-muted-foreground">
                          {event.note || "No note"} ·{" "}
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No lifecycle events recorded.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteAas.isPending) setDeleteOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected AAS</DialogTitle>
            <DialogDescription>
              Permanently remove {asset.name} from the dashboard and BaSyx
              repository/registry? Historical telemetry and incident records are
              retained. This operation requires administrator access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteAas.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAas.mutate({ id: asset.id })}
              disabled={deleteAas.isPending}
            >
              {deleteAas.isPending ? "Deleting…" : "Delete AAS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {asset && !asset.isDemo && !asset.aasxImported && (
        <CreateAssetDialog
          key={asset.id}
          asset={asset}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}
