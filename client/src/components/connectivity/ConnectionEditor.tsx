import { cloneElement, useId, useMemo, useRef, useState } from "react";
import { Cable, Clock3, Plus, Radio, Search, Trash2 } from "lucide-react";
import {
  industrialConnectionSchema,
  type IndustrialConnection,
  type ConnectivityTag,
  type ConnectivityObservation,
} from "@shared/industrial-connectivity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReactElement } from "react";

const protocols = [
  ["opcua", "OPC UA"],
  ["modbus_tcp", "Modbus TCP"],
  ["modbus_rtu", "Modbus RTU"],
  ["mqtt", "MQTT"],
  ["opcua_fx", "OPC UA FX"],
] as const;
const dataTypes = [
  "boolean",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
  "string",
] as const;
const endpoints = {
  opcua: "opc.tcp://192.168.10.20:4840",
  opcua_fx: "opc.tcp://192.168.10.20:4840",
  modbus_tcp: "tcp://192.168.10.20:502",
  modbus_rtu:
    "serial:///dev/ttyUSB0?baudrate=9600&parity=N&stopbits=1&bytesize=8",
  mqtt: "mqtts://broker.factory.example:8883",
};

export const protocolLabel = (protocol: string) =>
  protocols.find(([id]) => id === protocol)?.[1] ?? protocol;

export function newConnection(
  existing: IndustrialConnection[],
): IndustrialConnection {
  let number = 1;
  while (
    existing.some((entry) => entry.connectionId === `connection-${number}`)
  )
    number++;
  return {
    connectionId: `connection-${number}`,
    name: "",
    protocol: "opcua",
    endpoint: "",
    enabled: true,
    intervalMs: 1000,
    tags: [],
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5 text-sm">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && (
        <span
          id={`${id}-hint`}
          className="block text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function registerCount(type: ConnectivityTag["dataType"]) {
  return ["int64", "uint64", "float64"].includes(type)
    ? 4
    : ["int32", "uint32", "float32"].includes(type)
      ? 2
      : 1;
}

function sourceFor(
  connection: IndustrialConnection,
  index = 0,
): ConnectivityTag["source"] {
  if (connection.protocol === "mqtt") return { topic: "", path: "/value" };
  if (connection.protocol.startsWith("modbus"))
    return {
      address: index * 2,
      unitId: 1,
      registerType: "holding_register",
      count: 2,
      byteOrder: "big",
      wordOrder: "big",
    };
  if (connection.protocol === "opcua_fx" && connection.fx?.mode === "udp_uadp")
    return { fieldIndex: index };
  return { nodeId: "" };
}

function tagId(existing: ConnectivityTag[]) {
  let number = 1;
  while (existing.some((entry) => entry.tagId === `tag-${number}`)) number++;
  return `tag-${number}`;
}

const discoveryType: Record<string, ConnectivityTag["dataType"]> = {
  Boolean: "boolean",
  Int16: "int16",
  UInt16: "uint16",
  Int32: "int32",
  UInt32: "uint32",
  Int64: "int64",
  UInt64: "uint64",
  Float: "float32",
  Double: "float64",
  String: "string",
};

const discoveryKey = (tag: { namespaceUri: string; nodeId: string }) =>
  JSON.stringify([tag.namespaceUri, tag.nodeId]);

export function ConnectionEditor({
  initial,
  assets,
  open,
  onClose,
  onSave,
  onProbe,
  probeResult,
  probeStatus,
}: {
  initial: IndustrialConnection;
  assets: Array<{ assetId: string; name: string }>;
  open: boolean;
  onClose: () => void;
  onSave: (connection: IndustrialConnection) => void;
  onProbe: (connection: IndustrialConnection) => Promise<{ commandId: string }>;
  probeResult?: ConnectivityObservation | null;
  probeStatus?: { commandId: string; expiresAt: number; status: string } | null;
}) {
  const returnFocus = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [draft, setDraft] = useState<IndustrialConnection>(() =>
    structuredClone(initial),
  );
  const [keys, setKeys] = useState(() =>
    initial.tags.map(() => crypto.randomUUID()),
  );
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{
    commandId: string;
    fingerprint: string;
  } | null>(null);
  const [discoverySelection, setDiscoverySelection] = useState<string[]>([]);
  const [allowUnsecured, setAllowUnsecured] = useState(
    initial.fx?.mode === "udp_uadp" && initial.fx.allowUnsecured,
  );
  const result =
    probeResult?.commandId === probe?.commandId &&
    probe?.fingerprint === JSON.stringify(draft)
      ? probeResult
      : null;
  const testExpired =
    !!probeStatus &&
    probeStatus.commandId === probe?.commandId &&
    (probeStatus.status === "expired" || probeStatus.expiresAt < Date.now());
  const testUnconfirmed =
    probeStatus?.commandId === probe?.commandId &&
    probeStatus?.status === "unconfirmed";
  const discovered = result?.discoveredTags ?? [];
  const modbus = draft.protocol.startsWith("modbus");
  const uadp = draft.protocol === "opcua_fx" && draft.fx?.mode === "udp_uadp";
  const udp = draft.fx?.mode === "udp_uadp" ? draft.fx : undefined;
  const opc =
    draft.protocol === "opcua" || (draft.protocol === "opcua_fx" && !uadp);
  const update = (patch: Partial<IndustrialConnection>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  };
  const patchTag = (index: number, patch: Partial<ConnectivityTag>) =>
    update({
      tags: draft.tags.map((tag, n) =>
        n === index ? { ...tag, ...patch } : tag,
      ),
    });
  const patchSource = (index: number, patch: Record<string, unknown>) =>
    patchTag(index, { source: { ...draft.tags[index].source, ...patch } });
  const valid = () => {
    if (uadp && !allowUnsecured) {
      setError(
        "Confirm unsigned UDP observation before saving or testing this connection.",
      );
      return null;
    }
    const parsed = industrialConnectionSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join(" · ") || "Connection"}: ${issue.message}`,
          )
          .slice(0, 5)
          .join(". "),
      );
      return null;
    }
    setError("");
    return parsed.data;
  };
  const addTag = () => {
    update({
      tags: [
        ...draft.tags,
        {
          tagId: tagId(draft.tags),
          name: "",
          dataType: "float32",
          source: sourceFor(draft, draft.tags.length),
        },
      ],
    });
    setKeys((current) => [...current, crypto.randomUUID()]);
  };
  const selectProtocol = (protocol: IndustrialConnection["protocol"]) => {
    const next: IndustrialConnection = {
      ...draft,
      protocol,
      endpoint: "",
      tags: [],
    };
    delete next.fx;
    if (protocol === "opcua_fx") next.fx = { mode: "diagnostics" };
    update(next);
    setDraft(next);
    setKeys([]);
    setProbe(null);
  };
  const selectedDiscovered = useMemo(
    () => new Set(discoverySelection),
    [discoverySelection],
  );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-4xl overflow-y-auto p-4 sm:max-w-4xl sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="size-5" />
            {initial.name ? "Edit connection" : "Add connection"}
          </DialogTitle>
          <DialogDescription>
            Configure acquisition on your selected gateway. All drivers collect
            data with read access.
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const connection = valid();
            if (connection) onSave(connection);
          }}
        >
          <fieldset
            className="grid min-w-0 gap-4 sm:grid-cols-2"
            disabled={probing}
          >
            <Field label="Connection name">
              <Input
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Assembly line controller"
              />
            </Field>
            <Field
              label="Connection ID"
              hint="A stable identifier used to associate readings with this connection."
            >
              <Input
                required
                maxLength={64}
                value={draft.connectionId}
                onChange={(e) => update({ connectionId: e.target.value })}
              />
            </Field>
            <Field
              label="Protocol"
              hint={
                draft.tags.length
                  ? "Changing protocol clears the tag draft because addresses have different meanings."
                  : undefined
              }
            >
              <select
                className="workspace-control w-full"
                value={draft.protocol}
                onChange={(e) =>
                  selectProtocol(
                    e.target.value as IndustrialConnection["protocol"],
                  )
                }
              >
                {protocols.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Acquisition interval (ms)"
              hint="The gateway uses this interval for acquisition or reporting."
            >
              <Input
                required
                type="number"
                min={100}
                max={60000}
                step={1}
                value={draft.intervalMs}
                onChange={(e) => update({ intervalMs: Number(e.target.value) })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Endpoint"
                hint={
                  modbus && draft.protocol === "modbus_rtu"
                    ? "Use the commissioned serial port with baudrate, parity, stopbits and bytesize."
                    : "The selected gateway must be able to reach this address. Keep credentials out of the endpoint."
                }
              >
                <Input
                  required
                  maxLength={512}
                  spellCheck={false}
                  value={draft.endpoint}
                  onChange={(e) => update({ endpoint: e.target.value })}
                  placeholder={
                    uadp
                      ? "opc.udp://239.0.0.1:4840"
                      : endpoints[draft.protocol]
                  }
                />
              </Field>
            </div>
            {!uadp && (
              <Field
                label="Credential reference (optional)"
                hint="Name of credentials and certificate settings already installed on this gateway."
              >
                <Input
                  maxLength={64}
                  autoComplete="off"
                  value={draft.credentialRef ?? ""}
                  onChange={(e) =>
                    update({ credentialRef: e.target.value || undefined })
                  }
                  placeholder="assembly-controller"
                />
              </Field>
            )}
            <label className="flex items-center gap-2 self-start pt-7 text-sm font-medium">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              Enable acquisition when applied
            </label>
          </fieldset>

          {draft.protocol === "opcua_fx" && (
            <section
              className="space-y-3 rounded-xl border bg-muted/20 p-4"
              aria-labelledby="fx-configuration-title"
            >
              <h3
                id="fx-configuration-title"
                className="flex items-center gap-2 font-semibold"
              >
                <Radio className="size-4" />
                OPC UA FX
              </h3>
              <Field label="FX acquisition mode">
                <select
                  className="workspace-control w-full"
                  value={draft.fx?.mode ?? "diagnostics"}
                  onChange={(e) => {
                    const mode = e.target.value as "diagnostics" | "udp_uadp";
                    update({
                      fx:
                        mode === "diagnostics"
                          ? { mode }
                          : {
                              mode,
                              publisherId: "1",
                              publisherIdType: "UInt16",
                              writerGroupId: 1,
                              dataSetWriterId: 1,
                              metadataMajorVersion: 1,
                              metadataMinorVersion: 0,
                              allowUnsecured: true,
                            },
                      endpoint: "",
                      tags: [],
                    });
                    setKeys([]);
                    setProbe(null);
                    setAllowUnsecured(false);
                  }}
                >
                  <option value="diagnostics">
                    Discover FX model and read diagnostics
                  </option>
                  <option value="udp_uadp">
                    Observe commissioned UDP UADP data
                  </option>
                </select>
              </Field>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {uadp
                  ? "Match the publisher identity, writer IDs and metadata version to the commissioned stream. The observer does not establish or control an FX connection."
                  : "Browse AutomationComponents, FunctionalEntities and connection endpoints. This reads the FX model through OPC UA; it does not create a cyclic FX connection."}
              </p>
              {udp && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Publisher ID">
                      <Input
                        required
                        value={udp.publisherId}
                        onChange={(e) =>
                          update({
                            fx: { ...udp, publisherId: e.target.value },
                          })
                        }
                      />
                    </Field>
                    <Field label="Publisher ID type">
                      <select
                        className="workspace-control w-full"
                        value={udp.publisherIdType}
                        onChange={(e) =>
                          update({
                            fx: {
                              ...udp,
                              publisherIdType: e.target
                                .value as typeof udp.publisherIdType,
                            },
                          })
                        }
                      >
                        {["Byte", "UInt16", "UInt32", "UInt64", "String"].map(
                          (type) => (
                            <option key={type}>{type}</option>
                          ),
                        )}
                      </select>
                    </Field>
                    {(
                      [
                        ["writerGroupId", "Writer group ID", 1, 65535],
                        ["dataSetWriterId", "Data set writer ID", 1, 65535],
                        [
                          "metadataMajorVersion",
                          "Metadata major version",
                          0,
                          4294967295,
                        ],
                        [
                          "metadataMinorVersion",
                          "Metadata minor version",
                          0,
                          4294967295,
                        ],
                      ] as const
                    ).map(([key, label, min, max]) => (
                      <Field key={key} label={label}>
                        <Input
                          required
                          type="number"
                          min={min}
                          max={max}
                          value={udp[key]}
                          onChange={(e) =>
                            update({
                              fx: { ...udp, [key]: Number(e.target.value) },
                            })
                          }
                        />
                      </Field>
                    ))}
                    <Field label="Local interface address (optional)">
                      <Input
                        value={udp.interfaceAddress ?? ""}
                        placeholder="192.168.10.10"
                        onChange={(e) =>
                          update({
                            fx: {
                              ...udp,
                              interfaceAddress: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                  <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={allowUnsecured}
                      onChange={(e) => setAllowUnsecured(e.target.checked)}
                    />
                    <span>
                      Allow this read-only observer to receive unsigned UDP
                      data. Sender identity and network timing remain
                      unverified.
                    </span>
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Map the complete data set in its commissioned order, with
                    field indexes starting at zero and no gaps. Receiving an
                    unknown layout cannot establish a tag mapping.
                  </p>
                </>
              )}
            </section>
          )}

          <details className="rounded-xl border p-4" open={!!draft.tsn}>
            <summary className="flex cursor-pointer items-center gap-2 font-semibold">
              <Clock3 className="size-4" />
              TSN and clock diagnostics{" "}
              <Badge variant="outline" className="ml-auto">
                Optional
              </Badge>
            </summary>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={!!draft.tsn}
                  onChange={(e) =>
                    update({
                      tsn: e.target.checked
                        ? { interface: "", ptpDomain: 0 }
                        : undefined,
                    })
                  }
                />
                Collect diagnostics from a gateway network interface
              </label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Read clock state, timestamping capability, traffic schedules and
                port counters. Collection does not change clocks or network
                configuration.
              </p>
              {draft.tsn && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Network interface">
                    <Input
                      required
                      maxLength={15}
                      value={draft.tsn.interface}
                      placeholder="eth0"
                      onChange={(e) =>
                        update({
                          tsn: { ...draft.tsn!, interface: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="PTP domain">
                    <Input
                      required
                      type="number"
                      min={0}
                      max={127}
                      value={draft.tsn.ptpDomain ?? 0}
                      onChange={(e) =>
                        update({
                          tsn: {
                            ...draft.tsn!,
                            ptpDomain: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Collector reference (optional)">
                    <Input
                      maxLength={64}
                      value={draft.tsn.collectorRef ?? ""}
                      placeholder="factory-clock"
                      onChange={(e) =>
                        update({
                          tsn: {
                            ...draft.tsn!,
                            collectorRef: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              )}
            </div>
          </details>

          <section
            className="space-y-3"
            aria-labelledby="connection-tags-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="connection-tags-title" className="font-semibold">
                  Tags{" "}
                  <span className="text-muted-foreground">
                    · {draft.tags.length}/100
                  </span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Give every signal its own ID, including signals with the same
                  unit or measurement type.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTag}
                disabled={draft.tags.length >= 100}
              >
                <Plus className="mr-1.5 size-4" />
                Add tag
              </Button>
            </div>
            {!draft.tags.length && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {opc
                  ? "Add a tag by node address, or test the connection to discover available variables."
                  : "Add the values you want to collect using the equipment's documented addresses or payload mapping."}
              </p>
            )}
            {draft.tags.map((tag, index) => {
              const source = tag.source as Record<string, unknown>;
              return (
                <details
                  key={keys[index]}
                  className="rounded-xl border p-3 sm:p-4"
                  open
                >
                  <summary className="cursor-pointer break-words text-sm font-medium">
                    {tag.name || `Tag ${index + 1}`}{" "}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {tag.dataType}
                    </span>
                  </summary>
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label={`Tag ${index + 1} name`}>
                        <Input
                          required
                          maxLength={120}
                          value={tag.name}
                          onChange={(e) =>
                            patchTag(index, { name: e.target.value })
                          }
                          placeholder="Outlet pressure"
                        />
                      </Field>
                      <Field label={`Tag ${index + 1} ID`}>
                        <Input
                          required
                          maxLength={64}
                          value={tag.tagId}
                          onChange={(e) =>
                            patchTag(index, { tagId: e.target.value })
                          }
                        />
                      </Field>
                      <Field label={`Tag ${index + 1} data type`}>
                        <select
                          className="workspace-control w-full"
                          value={tag.dataType}
                          onChange={(e) => {
                            const dataType = e.target
                              .value as ConnectivityTag["dataType"];
                            const changed: Partial<ConnectivityTag> = {
                              dataType,
                            };
                            if (modbus)
                              changed.source = {
                                ...tag.source,
                                count: registerCount(dataType),
                                registerType:
                                  dataType === "boolean"
                                    ? "coil"
                                    : "holding_register",
                              };
                            if (
                              ["boolean", "string", "int64", "uint64"].includes(
                                dataType,
                              )
                            ) {
                              changed.scale = undefined;
                              changed.offset = undefined;
                            }
                            patchTag(index, changed);
                          }}
                        >
                          {dataTypes
                            .filter((type) => !modbus || type !== "string")
                            .map((type) => (
                              <option key={type}>{type}</option>
                            ))}
                        </select>
                      </Field>
                      {opc && (
                        <>
                          <div className="sm:col-span-2">
                            <Field label={`Tag ${index + 1} node ID`}>
                              <Input
                                required
                                value={String(source.nodeId ?? "")}
                                placeholder="s=Pump.OutletPressure"
                                onChange={(e) =>
                                  patchSource(index, { nodeId: e.target.value })
                                }
                              />
                            </Field>
                          </div>
                          <Field
                            label={`Tag ${index + 1} namespace URI`}
                            hint="Use the namespace URI to keep the tag stable across sessions."
                          >
                            <Input
                              value={String(source.namespaceUri ?? "")}
                              placeholder="urn:factory:controller"
                              onChange={(e) =>
                                patchSource(index, {
                                  namespaceUri: e.target.value || undefined,
                                })
                              }
                            />
                          </Field>
                        </>
                      )}
                      {modbus && (
                        <>
                          <Field label={`Tag ${index + 1} register table`}>
                            <select
                              className="workspace-control w-full"
                              value={String(
                                source.registerType ?? "holding_register",
                              )}
                              onChange={(e) =>
                                patchSource(index, {
                                  registerType: e.target.value,
                                })
                              }
                            >
                              <option value="holding_register">
                                Holding register
                              </option>
                              <option value="input_register">
                                Input register
                              </option>
                              <option value="coil">Coil</option>
                              <option value="discrete_input">
                                Discrete input
                              </option>
                            </select>
                          </Field>
                          <Field
                            label={`Tag ${index + 1} wire address`}
                            hint="Zero-based address from the equipment's register map."
                          >
                            <Input
                              required
                              type="number"
                              min={0}
                              max={65535}
                              value={Number(source.address ?? 0)}
                              onChange={(e) =>
                                patchSource(index, {
                                  address: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label={`Tag ${index + 1} unit ID`}>
                            <Input
                              required
                              type="number"
                              min={1}
                              max={247}
                              value={Number(source.unitId ?? 1)}
                              onChange={(e) =>
                                patchSource(index, {
                                  unitId: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                          {(["byteOrder", "wordOrder"] as const).map((key) => (
                            <Field
                              key={key}
                              label={`Tag ${index + 1} ${key === "byteOrder" ? "byte" : "word"} order`}
                            >
                              <select
                                className="workspace-control w-full"
                                value={String(source[key] ?? "big")}
                                onChange={(e) =>
                                  patchSource(index, { [key]: e.target.value })
                                }
                              >
                                <option value="big">Big endian</option>
                                <option value="little">Little endian</option>
                              </select>
                            </Field>
                          ))}
                        </>
                      )}
                      {draft.protocol === "mqtt" && (
                        <>
                          <Field label={`Tag ${index + 1} MQTT topic`}>
                            <Input
                              required
                              maxLength={256}
                              value={String(source.topic ?? "")}
                              placeholder="factory/pump-101/telemetry"
                              onChange={(e) =>
                                patchSource(index, { topic: e.target.value })
                              }
                            />
                          </Field>
                          <Field
                            label={`Tag ${index + 1} value path`}
                            hint="JSON pointer; for example /pressure. Leave empty for the full payload."
                          >
                            <Input
                              value={String(source.path ?? "")}
                              onChange={(e) =>
                                patchSource(index, { path: e.target.value })
                              }
                            />
                          </Field>
                          <Field
                            label={`Tag ${index + 1} timestamp path (optional)`}
                          >
                            <Input
                              value={String(source.timestampPath ?? "")}
                              placeholder="/timestamp"
                              onChange={(e) =>
                                patchSource(index, {
                                  timestampPath: e.target.value || undefined,
                                })
                              }
                            />
                          </Field>
                          <Field
                            label={`Tag ${index + 1} quality path (optional)`}
                          >
                            <Input
                              value={String(source.qualityPath ?? "")}
                              placeholder="/quality"
                              onChange={(e) =>
                                patchSource(index, {
                                  qualityPath: e.target.value || undefined,
                                })
                              }
                            />
                          </Field>
                        </>
                      )}
                      {uadp && (
                        <Field label={`Tag ${index + 1} data set field index`}>
                          <Input
                            required
                            type="number"
                            min={0}
                            max={99}
                            value={Number(source.fieldIndex ?? index)}
                            onChange={(e) =>
                              patchSource(index, {
                                fieldIndex: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      )}
                      <Field label={`Tag ${index + 1} unit (optional)`}>
                        <Input
                          maxLength={32}
                          value={tag.unit ?? ""}
                          placeholder="bar"
                          onChange={(e) =>
                            patchTag(index, {
                              unit: e.target.value || undefined,
                            })
                          }
                        />
                      </Field>
                      {!["boolean", "string", "int64", "uint64"].includes(
                        tag.dataType,
                      ) && (
                        <>
                          <Field label={`Tag ${index + 1} scale`}>
                            <Input
                              type="number"
                              step="any"
                              value={tag.scale ?? 1}
                              onChange={(e) =>
                                patchTag(index, {
                                  scale: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label={`Tag ${index + 1} offset`}>
                            <Input
                              type="number"
                              step="any"
                              value={tag.offset ?? 0}
                              onChange={(e) =>
                                patchTag(index, {
                                  offset: Number(e.target.value),
                                })
                              }
                            />
                          </Field>
                        </>
                      )}
                      <Field label={`Tag ${index + 1} asset (optional)`}>
                        <select
                          className="workspace-control w-full"
                          value={tag.assetId ?? ""}
                          onChange={(e) =>
                            patchTag(index, {
                              assetId: e.target.value || undefined,
                              property: e.target.value
                                ? tag.property
                                : undefined,
                            })
                          }
                        >
                          <option value="">Unassigned signal</option>
                          {tag.assetId &&
                            !assets.some(
                              (asset) => asset.assetId === tag.assetId,
                            ) && (
                              <option value={tag.assetId}>{tag.assetId}</option>
                            )}
                          {assets.map((asset) => (
                            <option key={asset.assetId} value={asset.assetId}>
                              {asset.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {tag.assetId && (
                        <Field label={`Tag ${index + 1} asset property`}>
                          <Input
                            maxLength={64}
                            value={tag.property ?? ""}
                            placeholder="outletPressure"
                            onChange={(e) =>
                              patchTag(index, {
                                property: e.target.value || undefined,
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        aria-label={`Remove tag ${index + 1}`}
                        onClick={() => {
                          update({
                            tags: draft.tags.filter((_, n) => n !== index),
                          });
                          setKeys((current) =>
                            current.filter((_, n) => n !== index),
                          );
                        }}
                      >
                        <Trash2 className="mr-1.5 size-4" />
                        Remove tag
                      </Button>
                    </div>
                  </div>
                </details>
              );
            })}
          </section>

          {error && (
            <p
              role="alert"
              className="break-words rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {probe && (
            <section
              aria-label="Connection test result"
              className="space-y-3 rounded-lg border p-3 text-sm"
            >
              <p className="font-medium">
                {result
                  ? `Gateway reported: ${result.state}`
                  : testExpired
                    ? "Gateway test expired"
                    : testUnconfirmed
                      ? "Gateway test delivery unconfirmed"
                      : "Test sent to the gateway"}
              </p>
              <p className="text-xs text-muted-foreground">
                {result
                  ? `Observed ${new Date(result.observedAt).toLocaleString()}${result.errorCode ? ` · ${result.errorCode}` : ""}`
                  : testExpired
                    ? "The gateway did not return a result before the test expired. Check gateway connectivity, then try again."
                    : testUnconfirmed
                      ? "Delivery could not be confirmed. Waiting for a correlated gateway result before assessing this connection."
                      : probe.fingerprint !== JSON.stringify(draft)
                        ? "The draft changed. Test again to verify these settings."
                        : "Waiting for the gateway's result. Broker acceptance does not confirm a working device connection."}
              </p>
              {discovered.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Select discovered variables to add to this draft. Only
                    supported scalar types are selectable.
                  </p>
                  <div className="max-h-48 space-y-1 overflow-auto">
                    {discovered.map((tag) => (
                      <label
                        key={discoveryKey(tag)}
                        className="flex items-start gap-2 rounded p-2 hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={!discoveryType[tag.dataType]}
                          checked={selectedDiscovered.has(discoveryKey(tag))}
                          onChange={(e) =>
                            setDiscoverySelection((current) =>
                              e.target.checked
                                ? [...current, discoveryKey(tag)]
                                : current.filter(
                                    (id) => id !== discoveryKey(tag),
                                  ),
                            )
                          }
                        />
                        <span className="min-w-0 break-words">
                          {tag.name}
                          <span className="block text-xs text-muted-foreground">
                            {tag.dataType} · {tag.nodeId}
                            <span className="block break-all">
                              {tag.namespaceUri}
                            </span>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      !discoverySelection.length || draft.tags.length >= 100
                    }
                    onClick={() => {
                      const tags = [...draft.tags];
                      let added = 0;
                      for (const tag of discovered) {
                        if (
                          !selectedDiscovered.has(discoveryKey(tag)) ||
                          !discoveryType[tag.dataType] ||
                          tags.length >= 100
                        )
                          continue;
                        if (
                          tags.some(
                            (existing) =>
                              "nodeId" in existing.source &&
                              existing.source.nodeId === tag.nodeId &&
                              existing.source.namespaceUri === tag.namespaceUri,
                          )
                        )
                          continue;
                        tags.push({
                          tagId: tagId(tags),
                          name: tag.name,
                          dataType: discoveryType[tag.dataType],
                          source: {
                            nodeId: tag.nodeId,
                            namespaceUri: tag.namespaceUri,
                          },
                        });
                        added++;
                      }
                      update({ tags });
                      setKeys((current) => [
                        ...current,
                        ...Array.from({ length: added }, () =>
                          crypto.randomUUID(),
                        ),
                      ]);
                      setDiscoverySelection([]);
                    }}
                  >
                    Add selected variables
                  </Button>
                </>
              )}
            </section>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={probing}
              onClick={async () => {
                const connection = valid();
                if (!connection) return;
                setProbing(true);
                setDiscoverySelection([]);
                try {
                  const response = await onProbe(connection);
                  setProbe({
                    commandId: response.commandId,
                    fingerprint: JSON.stringify(draft),
                  });
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "The gateway test could not be requested.",
                  );
                } finally {
                  setProbing(false);
                }
              }}
            >
              <Search className="mr-1.5 size-4" />
              {probing
                ? "Sending test…"
                : opc
                  ? "Test & discover"
                  : "Test connection"}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={probing}>
                Keep in draft
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
