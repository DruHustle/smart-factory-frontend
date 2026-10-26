import { SectionNav } from "@/components/workspace/Primitives";
import { MetricMappingEditor } from "@/components/workspace/MappingEditors";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const defaultMappings = JSON.stringify(
  [
    {
      name: "temperature",
      metric: "temperature",
      unit: "°C",
      address: 100,
      registerType: "holding_register",
      scale: 0.1,
    },
    {
      name: "vibration",
      metric: "vibration",
      unit: "mm/s",
      address: 102,
      registerType: "holding_register",
      scale: 0.01,
    },
    {
      name: "power",
      metric: "power",
      unit: "kW",
      address: 104,
      registerType: "holding_register",
      scale: 0.1,
    },
  ],
  null,
  2,
);

type AssetDraft = {
  id: number;
  assetId: string;
  name: string;
  assetType: string;
  manufacturer: string | null;
  model: string | null;
  manufacturerStreet: string | null;
  manufacturerZipcode: string | null;
  manufacturerCityTown: string | null;
  manufacturerNationalCode: string | null;
  manufacturerArticleNumber: string | null;
  orderCodeOfManufacturer: string | null;
  ratedValue: string | null;
  ratedUnit: string | null;
  serialNumber: string | null;
  location: string | null;
  zone: string | null;
  aasVersion: number;
};

export function CreateAssetDialog({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: AssetDraft;
}) {
  const [name, setName] = useState(asset?.name ?? "");
  const [assetType, setAssetType] = useState(asset?.assetType ?? "compressor");
  const [manufacturer, setManufacturer] = useState(asset?.manufacturer ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [street, setStreet] = useState(asset?.manufacturerStreet ?? "");
  const [zipcode, setZipcode] = useState(asset?.manufacturerZipcode ?? "");
  const [cityTown, setCityTown] = useState(asset?.manufacturerCityTown ?? "");
  const [nationalCode, setNationalCode] = useState(
    asset?.manufacturerNationalCode ?? "",
  );
  const [articleNumber, setArticleNumber] = useState(
    asset?.manufacturerArticleNumber ?? "",
  );
  const [orderCode, setOrderCode] = useState(
    asset?.orderCodeOfManufacturer ?? "",
  );
  const [ratedValue, setRatedValue] = useState(asset?.ratedValue ?? "");
  const [ratedUnit, setRatedUnit] = useState(asset?.ratedUnit ?? "");
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? "");
  const [location, setLocation] = useState(asset?.location ?? "");
  const [zone, setZone] = useState(asset?.zone ?? "");
  const [changeNote, setChangeNote] = useState("Engineering data update");
  const [gatewayPk, setGatewayPk] = useState("none");
  const [connectionMode, setConnectionMode] = useState<
    "gateway" | "direct_mqtt"
  >("gateway");
  const [directDeviceId, setDirectDeviceId] = useState("");
  const [protocol, setProtocol] = useState("opcua");
  const [endpoint, setEndpoint] = useState("");
  const [mappingText, setMappingText] = useState(defaultMappings);
  const [creationMode, setCreationMode] = useState<"form" | "aasx">("form");
  const [aasxFile, setAasxFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState("");
  const [completed, setCompleted] = useState<{
    id: number;
    message: string;
    items?: { id: number; name: string }[];
  } | null>(null);
  useEffect(() => {
    if (open) {
      setStep(0);
      setValidation("");
      setCompleted(null);
    }
  }, [open]);
  const nextStep = () => {
    if (step === 0 && !name.trim()) {
      setValidation("Enter an asset name");
      document.getElementById("asset-name")?.focus();
      return;
    }
    if (step === 1) {
      const required = [
        ["asset-manufacturer", manufacturer],
        ["asset-model", model],
        ["asset-manufacturer-street", street],
        ["asset-manufacturer-zipcode", zipcode],
        ["asset-manufacturer-city", cityTown],
        ["asset-manufacturer-country", nationalCode],
        ["asset-article-number", articleNumber],
        ["asset-order-code", orderCode],
      ];
      const missing = required.find(([, v]) => !v.trim());
      if (missing) {
        setValidation(
          "Complete the required manufacturer identity and postal address fields.",
        );
        document.getElementById(missing[0])?.focus();
        return;
      }
      if (!/^[A-Za-z]{2}$/.test(nationalCode.trim())) {
        setValidation("Use a two-letter manufacturer country code.");
        document.getElementById("asset-manufacturer-country")?.focus();
        return;
      }
    }
    setValidation("");
    setStep((v) => Math.min(2, v + 1));
  };
  const utils = trpc.useUtils();
  const { data: devices } = trpc.devices.list.useQuery(undefined, {
    enabled: open,
  });
  const gateways =
    devices?.filter((device) => device.type === "gateway" && !device.isDemo) ??
    [];
  const create = trpc.assets.create.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.provisioned
          ? "AAS provisioned and registered"
          : "Asset saved for local development",
        {
          description:
            result.edgeSync === "published"
              ? "The AAS is registered and the updated asset profile was published to the edge gateway."
              : result.edgeSync === "pending"
                ? "The AAS is registered. The gateway did not confirm publication; open the AAS page to retry or download its profile."
                : result.connectionMode === "direct_mqtt"
                  ? "The AAS is linked to a direct MQTT device ID. Provision its device-scoped TLS credentials and broker topic ACL before it publishes."
                  : result.provisioned
                    ? "The shell and submodels are registered. No gateway was selected for this asset."
                    : "The .NET AAS provisioner is not configured, so the local API generated this development record.",
        },
      );
      await utils.assets.list.invalidate();
      void utils.inventory.invalidate();
      setCompleted({
        id: result.id,
        message:
          result.edgeSync === "pending"
            ? "Asset registered. Gateway profile publication is pending; no applied configuration is confirmed."
            : "Asset registered. Review its connections and representation in the item workspace.",
      });
      setName("");
    },
    onError: (error) => toast.error(error.message),
  });
  const update = trpc.assets.update.useMutation({
    onSuccess: async () => {
      toast.success("Asset details and AAS updated");
      void utils.inventory.invalidate();
      await Promise.all([
        utils.assets.list.invalidate(),
        utils.assets.getById.invalidate({ id: asset!.id }),
        utils.assets.getShell.invalidate({ id: asset!.id }),
        utils.assets.getVersions.invalidate({ id: asset!.id }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (!name.trim()) return toast.error("Enter an asset name");
    if (
      !manufacturer.trim() ||
      !model.trim() ||
      !street.trim() ||
      !zipcode.trim() ||
      !cityTown.trim() ||
      !nationalCode.trim() ||
      !articleNumber.trim() ||
      !orderCode.trim()
    ) {
      return toast.error(
        "Complete the manufacturer identity and postal address fields required by the IDTA templates",
      );
    }
    if (!/^[A-Za-z]{2}$/.test(nationalCode.trim()))
      return toast.error("Use a two-letter ISO country code, for example DE");
    if (
      connectionMode === "direct_mqtt" &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(directDeviceId.trim())
    )
      return toast.error(
        "Enter a direct MQTT device ID using letters, numbers, underscores, or hyphens",
      );
    if (
      gatewayPk !== "none" &&
      protocol === "ada031_v4_serial" &&
      !/^serial:\/\/.+/.test(endpoint.trim())
    )
      return toast.error(
        "Enter the ADA031 USB serial path, for example serial:///dev/serial/by-id/usb-Adeept?baudrate=9600",
      );
    if (!asset && gatewayPk !== "none") {
      if (!endpoint.trim())
        return toast.error(
          "Enter the machine endpoint for the selected gateway",
        );
      if (/^\w+:\/\/[^/]*@/.test(endpoint.trim()))
        return toast.error(
          "Do not place usernames or passwords in machine endpoints",
        );
    }
    const identity = {
      name: name.trim(),
      assetType: assetType as
        | "compressor"
        | "transformer"
        | "pump"
        | "motor"
        | "wind_turbine"
        | "robotic_arm"
        | "other",
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      manufacturerStreet: street.trim(),
      manufacturerZipcode: zipcode.trim(),
      manufacturerCityTown: cityTown.trim(),
      manufacturerNationalCode: nationalCode.trim().toUpperCase(),
      manufacturerArticleNumber: articleNumber.trim(),
      orderCodeOfManufacturer: orderCode.trim(),
      ratedValue: ratedValue.trim() || undefined,
      ratedUnit: ratedUnit.trim() || undefined,
      serialNumber: serialNumber.trim() || undefined,
      location: location.trim() || undefined,
      zone: zone.trim() || undefined,
    };
    if (asset) {
      if (changeNote.trim().length < 3)
        return toast.error("Enter a short reason for this AAS revision");
      update.mutate({
        id: asset.id,
        expectedVersion: asset.aasVersion,
        changeNote: changeNote.trim(),
        ...identity,
      });
      return;
    }

    let tagMappings: Array<Record<string, unknown>>;
    try {
      tagMappings = JSON.parse(mappingText);
      if (!Array.isArray(tagMappings))
        throw new Error("Tag mapping must be a JSON array");
    } catch (error) {
      return toast.error(
        error instanceof Error ? error.message : "Invalid tag mapping JSON",
      );
    }
    const generatedId = `urn:smart-factory:asset:${crypto.randomUUID()}`;
    create.mutate({
      assetId: generatedId,
      ...identity,
      connectionMode,
      gatewayDevicePk:
        connectionMode === "gateway" && gatewayPk !== "none"
          ? Number(gatewayPk)
          : undefined,
      directDeviceId:
        connectionMode === "direct_mqtt" ? directDeviceId.trim() : undefined,
      protocol: (connectionMode === "direct_mqtt"
        ? "mqtt_direct"
        : protocol) as
        | "mqtt"
        | "opcua"
        | "modbus_tcp"
        | "modbus_rtu"
        | "serial"
        | "ada031_v4_serial"
        | "mqtt_direct",
      endpoint: endpoint || undefined,
      tagMappings,
    });
  };

  const importPackage = async () => {
    if (!aasxFile) return toast.error("Choose an .aasx package to import");
    if (!aasxFile.name.toLowerCase().endsWith(".aasx"))
      return toast.error("Choose a file with the .aasx extension");
    if (aasxFile.size > 50 * 1024 * 1024)
      return toast.error("AASX packages must be 50 MB or smaller");

    let tagMappings: Array<Record<string, unknown>> = [];
    if (
      connectionMode === "direct_mqtt" &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(directDeviceId.trim())
    )
      return toast.error(
        "Enter a direct MQTT device ID using letters, numbers, underscores, or hyphens",
      );
    if (connectionMode === "gateway" && gatewayPk !== "none") {
      if (!endpoint.trim())
        return toast.error(
          "Enter the machine endpoint for the selected gateway",
        );
      if (/^\w+:\/\/[^/]*@/.test(endpoint.trim()))
        return toast.error(
          "Do not place usernames or passwords in machine endpoints",
        );
      try {
        const parsed: unknown = JSON.parse(mappingText);
        if (
          !Array.isArray(parsed) ||
          parsed.some(
            (entry) =>
              !entry || typeof entry !== "object" || Array.isArray(entry),
          )
        )
          throw new Error("Tag mapping must be an array of objects");
        tagMappings = parsed as Array<Record<string, unknown>>;
      } catch (error) {
        return toast.error(
          error instanceof Error ? error.message : "Invalid tag mapping JSON",
        );
      }
    }

    const form = new FormData();
    form.append("file", aasxFile, aasxFile.name);
    const headers: Record<string, string> = {};
    if (connectionMode === "gateway" && gatewayPk !== "none") {
      headers["x-edge-gateway-device-pk"] = gatewayPk;
      headers["x-edge-protocol"] = protocol;
      headers["x-edge-endpoint"] = endpoint.trim();
      headers["x-edge-tag-mappings"] = JSON.stringify(tagMappings);
    } else if (connectionMode === "direct_mqtt") {
      headers["x-edge-direct-device-id"] = directDeviceId.trim();
    }
    setIsImporting(true);
    try {
      const response = await fetch("/api/assets/import", {
        method: "POST",
        body: form,
        headers,
        credentials: "same-origin",
      });
      const result = (await response.json()) as {
        error?: string;
        assets?: Array<{ id: number; name: string }>;
        edgeSync?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error ?? `AASX import failed (HTTP ${response.status})`,
        );
      const count = result.assets?.length ?? 0;
      toast.success(
        `Imported ${count} asset${count === 1 ? "" : "s"} from AASX`,
        {
          description:
            result.edgeSync === "published"
              ? "The AASX package and models are registered, and the edge profile was published."
              : connectionMode === "direct_mqtt"
                ? "The direct MQTT device identity is linked. Provision its device-scoped TLS credentials and topic ACL before it publishes."
                : gatewayPk !== "none"
                  ? "The AASX package is registered. Edge publication is pending; retry from the AAS page."
                  : "The original package, shell, submodels, and concept descriptions are stored in the AAS services.",
        },
      );
      await utils.assets.list.invalidate();
      void utils.inventory.invalidate();
      setAasxFile(null);
      if (result.assets?.length)
        setCompleted({
          id: result.assets[0].id,
          items: result.assets,
          message: `${count} imported asset${count === 1 ? "" : "s"} registered. ${result.edgeSync === "pending" ? "Gateway publication is pending; application is unconfirmed." : "Review the preserved vendor representations and connections."}`,
        });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "AASX import failed",
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {asset ? "Edit industrial asset" : "Create Asset"}
          </DialogTitle>
          <DialogDescription>
            {asset
              ? "Update the manufacturer identity and address, then refresh the IDTA AAS repository record."
              : "Choose quick form registration or import a vendor AASX package. Store protocol credentials on the gateway, not in this form."}
          </DialogDescription>
        </DialogHeader>
        <SectionNav
          label="Asset creation method"
          value={creationMode}
          sections={
            asset || completed
              ? []
              : [
                  { id: "form", label: "Quick Create (Form)" },
                  { id: "aasx", label: "Import Package (.aasx)" },
                ]
          }
          onChange={(v) => {
            setCreationMode(v as "form" | "aasx");
            setValidation("");
          }}
        >
          {!asset && creationMode === "form" && !completed && (
            <ol
              aria-label="Registration progress"
              className="grid grid-cols-3 gap-2 text-xs"
            >
              {["Identity", "Manufacturer", "Connection"].map(
                (label, index) => (
                  <li
                    key={label}
                    aria-current={step === index ? "step" : undefined}
                    className={`rounded border px-3 py-2 ${step === index ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground"}`}
                  >
                    {index + 1} · {label}
                  </li>
                ),
              )}
            </ol>
          )}
          {validation && (
            <p
              role="alert"
              className="rounded border border-destructive p-3 text-sm text-destructive"
            >
              {validation}
            </p>
          )}
          {completed ? (
            <div role="status" className="space-y-4 rounded border p-4">
              <h2 className="font-semibold">Registration complete</h2>
              <p className="text-sm">{completed.message}</p>
              {(
                completed.items ?? [
                  { id: completed.id, name: "registered asset" },
                ]
              ).map((item) => (
                <Button key={item.id} asChild>
                  <a
                    href={`#/inventory/asset:${item.id}/overview`}
                    onClick={() => onOpenChange(false)}
                  >
                    Open {item.name}
                  </a>
                </Button>
              ))}
            </div>
          ) : (
            <>
              {!asset && creationMode === "aasx" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="aasx-package">AASX package</Label>
                    <Input
                      id="aasx-package"
                      type="file"
                      accept=".aasx,application/aas+zip"
                      onChange={(event) =>
                        setAasxFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      One package can contain up to 25 asset shells. The
                      original package and its attachments are preserved by the
                      AASX file service.
                    </p>
                  </div>
                  <div className="space-y-3 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        Optional asset connection
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Choose a gateway route for local protocols and control,
                        or a direct MQTT device with its own broker identity.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="aasx-connection-route">
                        Connection route
                      </Label>
                      <Select
                        value={connectionMode}
                        onValueChange={(value) => {
                          const mode = value as "gateway" | "direct_mqtt";
                          setConnectionMode(mode);
                          if (mode === "direct_mqtt") {
                            setGatewayPk("none");
                            setProtocol("mqtt_direct");
                          } else if (protocol === "mqtt_direct")
                            setProtocol("opcua");
                        }}
                      >
                        <SelectTrigger id="aasx-connection-route">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gateway">
                            Via edge gateway
                          </SelectItem>
                          <SelectItem value="direct_mqtt">
                            Direct MQTT
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {connectionMode === "gateway" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="aasx-edge-gateway">
                            Edge gateway
                          </Label>
                          <Select
                            value={gatewayPk}
                            onValueChange={setGatewayPk}
                          >
                            <SelectTrigger id="aasx-edge-gateway">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                Not connected yet
                              </SelectItem>
                              {gateways.map((device) => (
                                <SelectItem
                                  key={device.id}
                                  value={String(device.id)}
                                >
                                  {device.name} · {device.deviceId}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {gatewayPk !== "none" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="aasx-protocol">Protocol</Label>
                              <Select
                                value={protocol}
                                onValueChange={setProtocol}
                              >
                                <SelectTrigger id="aasx-protocol">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {[
                                    ["opcua", "OPC UA"],
                                    ["modbus_tcp", "Modbus TCP"],
                                    ["modbus_rtu", "Modbus RTU"],
                                    ["serial", "Serial JSON telemetry"],
                                    [
                                      "ada031_v4_serial",
                                      "ADA031 V4 USB control",
                                    ],
                                    ["mqtt", "Gateway MQTT"],
                                  ].map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="aasx-endpoint">
                                Machine endpoint
                              </Label>
                              <Input
                                id="aasx-endpoint"
                                value={endpoint}
                                onChange={(event) =>
                                  setEndpoint(event.target.value)
                                }
                                placeholder="opc.tcp://10.0.0.40:4840"
                              />
                            </div>
                            {protocol === "ada031_v4_serial" ? (
                              <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                                The stock V4 sketch uses 9600-baud USB serial
                                for one-step commands and emits no telemetry.
                                First opening USB serial resets the board and
                                moves all five controlled servos to 90°. Motion
                                is source-clamped by the sketch (servos 1–4:
                                0–180°, servo 5: 35–90°); verify these temporary
                                limits mechanically. Remote commands require the
                                Pi gateway allowlist.
                              </p>
                            ) : (
                              <div className="sm:col-span-2">
                                <MetricMappingEditor
                                  value={mappingText}
                                  onChange={setMappingText}
                                  protocol={protocol}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="aasx-direct-device-id">
                          Direct MQTT device ID
                        </Label>
                        <Input
                          id="aasx-direct-device-id"
                          value={directDeviceId}
                          onChange={(event) =>
                            setDirectDeviceId(event.target.value)
                          }
                          placeholder="mobile-sensor-01"
                        />
                        <p className="text-xs text-muted-foreground">
                          Configure this exact ID on the device topic, payload,
                          broker TLS identity, and publish-only ACL.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {asset && (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
                      <p className="font-medium">
                        Saving creates AAS revision {asset.aasVersion + 1}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Previous revisions remain available in the asset version
                        history. A stale form is rejected instead of replacing
                        newer data.
                      </p>
                    </div>
                  )}
                  <div hidden={!asset && step !== 0} className="space-y-2">
                    <Label htmlFor="asset-name">Asset name</Label>
                    <Input
                      id="asset-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Compressor 02"
                    />
                  </div>
                  <div hidden={!asset && step !== 0} className="space-y-2">
                    <Label htmlFor="asset-type">Asset type</Label>
                    <Select value={assetType} onValueChange={setAssetType}>
                      <SelectTrigger id="asset-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          ["compressor", "Compressor"],
                          ["transformer", "Transformer"],
                          ["pump", "Pump"],
                          ["motor", "Motor"],
                          ["wind_turbine", "Wind turbine generator"],
                          ["robotic_arm", "Robotic arm"],
                          ["other", "Other industrial asset"],
                        ].map(([type, label]) => (
                          <SelectItem key={type} value={type}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-manufacturer">Manufacturer</Label>
                    <Input
                      id="asset-manufacturer"
                      value={manufacturer}
                      onChange={(e) => setManufacturer(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-model">Product designation</Label>
                    <Input
                      id="asset-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-manufacturer-street">
                      Manufacturer street
                    </Label>
                    <Input
                      id="asset-manufacturer-street"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-manufacturer-zipcode">
                      Manufacturer postal code
                    </Label>
                    <Input
                      id="asset-manufacturer-zipcode"
                      value={zipcode}
                      onChange={(e) => setZipcode(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-manufacturer-city">
                      Manufacturer city
                    </Label>
                    <Input
                      id="asset-manufacturer-city"
                      value={cityTown}
                      onChange={(e) => setCityTown(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-manufacturer-country">
                      Manufacturer country code (ISO 3166-1 alpha-2)
                    </Label>
                    <Input
                      id="asset-manufacturer-country"
                      value={nationalCode}
                      onChange={(e) => setNationalCode(e.target.value)}
                      placeholder="DE"
                      maxLength={2}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-article-number">
                      Manufacturer article number
                    </Label>
                    <Input
                      id="asset-article-number"
                      value={articleNumber}
                      onChange={(e) => setArticleNumber(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-order-code">
                      Manufacturer order code
                    </Label>
                    <Input
                      id="asset-order-code"
                      value={orderCode}
                      onChange={(e) => setOrderCode(e.target.value)}
                      required
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-rated-value">Rated value</Label>
                    <Input
                      id="asset-rated-value"
                      value={ratedValue}
                      onChange={(e) => setRatedValue(e.target.value)}
                      placeholder="75"
                    />
                  </div>
                  <div hidden={!asset && step !== 1} className="space-y-2">
                    <Label htmlFor="asset-rated-unit">Rated unit</Label>
                    <Input
                      id="asset-rated-unit"
                      value={ratedUnit}
                      onChange={(e) => setRatedUnit(e.target.value)}
                      placeholder="kW"
                    />
                  </div>
                  <div hidden={!asset && step !== 0} className="space-y-2">
                    <Label htmlFor="asset-serial">Serial number</Label>
                    <Input
                      id="asset-serial"
                      value={serialNumber}
                      onChange={(e) => setSerialNumber(e.target.value)}
                    />
                  </div>
                  <div hidden={!asset && step !== 0} className="space-y-2">
                    <Label htmlFor="asset-location">Location</Label>
                    <Input
                      id="asset-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                  <div hidden={!asset && step !== 0} className="space-y-2">
                    <Label htmlFor="asset-zone">Zone</Label>
                    <Input
                      id="asset-zone"
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                    />
                  </div>
                  {asset && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="asset-change-note">Revision note</Label>
                      <Textarea
                        id="asset-change-note"
                        value={changeNote}
                        onChange={(event) => setChangeNote(event.target.value)}
                        maxLength={1000}
                        required
                      />
                    </div>
                  )}
                  {!asset && (
                    <div
                      hidden={step !== 2}
                      className="space-y-3 rounded-md border p-3 sm:col-span-2"
                    >
                      <div>
                        <p className="text-sm font-medium">Asset connection</p>
                        <p className="text-xs text-muted-foreground">
                          Select an optional data route. A digital
                          representation can be registered without live
                          connectivity.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="asset-connection-route">
                          Connection route
                        </Label>
                        <Select
                          value={connectionMode}
                          onValueChange={(value) => {
                            const mode = value as "gateway" | "direct_mqtt";
                            setConnectionMode(mode);
                            if (mode === "direct_mqtt") {
                              setGatewayPk("none");
                              setProtocol("mqtt_direct");
                            } else if (protocol === "mqtt_direct")
                              setProtocol("opcua");
                          }}
                        >
                          <SelectTrigger id="asset-connection-route">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gateway">
                              Via edge gateway
                            </SelectItem>
                            <SelectItem value="direct_mqtt">
                              Direct MQTT
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {connectionMode === "gateway" ? (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="asset-edge-gateway">
                              Edge gateway
                            </Label>
                            <Select
                              value={gatewayPk}
                              onValueChange={setGatewayPk}
                            >
                              <SelectTrigger id="asset-edge-gateway">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  Not connected yet
                                </SelectItem>
                                {gateways.map((device) => (
                                  <SelectItem
                                    key={device.id}
                                    value={String(device.id)}
                                  >
                                    {device.name} · {device.deviceId}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {gatewayPk !== "none" && (
                            <>
                              <div className="space-y-2">
                                <Label htmlFor="asset-protocol">Protocol</Label>
                                <Select
                                  value={protocol}
                                  onValueChange={setProtocol}
                                >
                                  <SelectTrigger id="asset-protocol">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[
                                      ["opcua", "OPC UA"],
                                      ["modbus_tcp", "Modbus TCP"],
                                      ["modbus_rtu", "Modbus RTU"],
                                      ["serial", "Serial JSON telemetry"],
                                      [
                                        "ada031_v4_serial",
                                        "ADA031 V4 USB control",
                                      ],
                                      ["mqtt", "Gateway MQTT"],
                                    ].map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="asset-endpoint">
                                  Machine endpoint
                                </Label>
                                <Input
                                  id="asset-endpoint"
                                  value={endpoint}
                                  onChange={(e) => setEndpoint(e.target.value)}
                                  placeholder={
                                    protocol === "ada031_v4_serial"
                                      ? "serial:///dev/serial/by-id/usb-Adeept?baudrate=9600"
                                      : "opc.tcp://10.0.0.40:4840"
                                  }
                                />
                              </div>
                              {protocol === "ada031_v4_serial" ? (
                                <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                                  The stock V4 sketch uses 9600-baud USB serial
                                  for one-step commands and emits no telemetry.
                                  First opening USB serial resets the board and
                                  moves all five controlled servos to 90°.
                                  Motion is source-clamped by the sketch (servos
                                  1–4: 0–180°, servo 5: 35–90°); verify these
                                  temporary limits mechanically. Remote commands
                                  require the Pi gateway allowlist.
                                </p>
                              ) : (
                                <div className="sm:col-span-2">
                                  <MetricMappingEditor
                                    value={mappingText}
                                    onChange={setMappingText}
                                    protocol={protocol}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="asset-direct-device-id">
                            Direct MQTT device ID
                          </Label>
                          <Input
                            id="asset-direct-device-id"
                            value={directDeviceId}
                            onChange={(event) =>
                              setDirectDeviceId(event.target.value)
                            }
                            placeholder="mobile-sensor-01"
                          />
                          <p className="text-xs text-muted-foreground">
                            Use this same ID as the CloudAMQP topic and payload
                            deviceId. Provision a dedicated TLS client identity
                            and publish-only ACL for it.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {create.isPending && (
                <p role="status" className="text-sm text-muted-foreground">
                  Registering the asset and its digital representation…
                </p>
              )}
              {isImporting && (
                <p role="status" className="text-sm text-muted-foreground">
                  Validating the AASX package and registering its models…
                </p>
              )}
              <DialogFooter>
                {!asset && creationMode === "form" && step > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setValidation("");
                      setStep((v) => v - 1);
                    }}
                  >
                    Back
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={create.isPending || update.isPending || isImporting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={
                    !asset && creationMode === "form" && step < 2
                      ? nextStep
                      : asset || creationMode === "form"
                        ? submit
                        : importPackage
                  }
                  disabled={create.isPending || update.isPending || isImporting}
                >
                  {!asset && creationMode === "form" && step < 2
                    ? "Next"
                    : update.isPending
                      ? "Saving…"
                      : asset
                        ? "Save asset"
                        : creationMode === "aasx"
                          ? isImporting
                            ? "Importing…"
                            : "Import AASX package"
                          : create.isPending
                            ? "Provisioning…"
                            : "Register and provision"}
                </Button>
              </DialogFooter>
            </>
          )}
        </SectionNav>
      </DialogContent>
    </Dialog>
  );
}
