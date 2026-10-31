import { z } from "zod";

/** Independent wire schemas: no runtime or source-code dependency on edge/.NET. */
export const connectivityId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (s) => !/[\u0000-\u001f\u007f]/.test(s),
      "Control characters are not allowed",
    );
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const code = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime();
const pointer = z
  .string()
  .max(256)
  .refine(
    (s) =>
      (s === "" || s.startsWith("/")) &&
      !/~(?:[^01]|$)/.test(s) &&
      !/[\u0000-\u001f\u007f]/.test(s),
    "Use an RFC 6901 JSON pointer",
  );
export const connectivityDataTypes = [
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
export const connectivityProtocols = [
  "opcua",
  "modbus_tcp",
  "modbus_rtu",
  "mqtt",
  "opcua_fx",
] as const;
const dataType = z.enum(connectivityDataTypes);
const opcSource = z
  .object({ nodeId: text(512), namespaceUri: text(256).optional() })
  .strict();
const modbusSource = z
  .object({
    address: z.number().int().min(0).max(65535),
    registerType: z.enum([
      "coil",
      "discrete_input",
      "input_register",
      "holding_register",
    ]),
    unitId: z.number().int().min(1).max(247),
    count: z.number().int().min(1).max(4).optional(),
    byteOrder: z.enum(["big", "little"]).optional(),
    wordOrder: z.enum(["big", "little"]).optional(),
  })
  .strict();
const mqttSource = z
  .object({
    topic: text(256).refine((s) => !/[+#]/.test(s), "Choose a literal topic"),
    path: pointer,
    timestampPath: pointer.optional(),
    qualityPath: pointer.optional(),
  })
  .strict();
const uadpSource = z
  .object({ fieldIndex: z.number().int().min(0).max(99) })
  .strict();
export const connectivityTagSchema = z
  .object({
    tagId: connectivityId,
    name: text(120),
    dataType,
    source: z.union([opcSource, modbusSource, mqttSource, uadpSource]),
    unit: text(32).optional(),
    assetId: text(128).optional(),
    property: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
      .optional(),
    scale: z.number().finite().optional(),
    offset: z.number().finite().optional(),
  })
  .strict()
  .superRefine((tag, ctx) => {
    if (
      ["boolean", "string", "int64", "uint64"].includes(tag.dataType) &&
      ((tag.scale ?? 1) !== 1 || (tag.offset ?? 0) !== 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["scale"],
        message: "This type requires identity scaling",
      });
    if (tag.property && !tag.assetId)
      ctx.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "An asset property requires an asset binding",
      });
  });
const fxConfiguration = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("diagnostics") }).strict(),
  z
    .object({
      mode: z.literal("udp_uadp"),
      publisherId: text(128),
      publisherIdType: z.enum(["Byte", "UInt16", "UInt32", "UInt64", "String"]),
      writerGroupId: z.number().int().min(1).max(65535),
      dataSetWriterId: z.number().int().min(1).max(65535),
      metadataMajorVersion: z.number().int().min(0).max(4294967295),
      metadataMinorVersion: z.number().int().min(0).max(4294967295),
      interfaceAddress: z.ipv4().optional(),
      allowUnsecured: z.literal(true),
    })
    .strict(),
]);
export const tsnConfigurationSchema = z
  .object({
    interface: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,14}$/),
    ptpDomain: z.number().int().min(0).max(127).optional(),
    collectorRef: reference.optional(),
  })
  .strict();

function endpointError(connection: {
  endpoint: string;
  protocol: string;
  fx?: { mode: string };
}): string | null {
  try {
    const url = new URL(connection.endpoint);
    if (url.username || url.password || url.hash)
      return "Endpoints must omit credentials and fragments";
    if (connection.protocol === "modbus_rtu") {
      if (
        url.protocol !== "serial:" ||
        url.hostname ||
        !/^\/dev\/[A-Za-z0-9_./-]+$/.test(url.pathname) ||
        connection.endpoint.includes("..")
      )
        return "Choose a serial:///dev/... endpoint";
      const allowed: Record<string, (v: string) => boolean> = {
        baudrate: (v) =>
          /^\d+$/.test(v) && Number(v) >= 300 && Number(v) <= 4_000_000,
        parity: (v) => ["N", "E", "O"].includes(v),
        stopbits: (v) => ["1", "2"].includes(v),
        bytesize: (v) => ["7", "8"].includes(v),
      };
      for (const [key, value] of url.searchParams)
        if (!allowed[key]?.(value) || url.searchParams.getAll(key).length !== 1)
          return "Unsupported serial setting";
      return null;
    }
    if (!url.hostname || url.search)
      return "Choose an endpoint with a host and no query";
    const schemes =
      connection.protocol === "mqtt"
        ? ["mqtt:", "mqtts:"]
        : connection.protocol === "modbus_tcp"
          ? ["tcp:"]
          : connection.fx?.mode === "udp_uadp"
            ? ["opc.udp:"]
            : ["opc.tcp:"];
    if (!schemes.includes(url.protocol))
      return "The endpoint scheme does not match this driver";
    if (
      connection.protocol !== "opcua" &&
      !(
        connection.protocol === "opcua_fx" && connection.fx?.mode !== "udp_uadp"
      ) &&
      url.pathname &&
      url.pathname !== "/"
    )
      return "This endpoint must omit a path";
    if (connection.fx?.mode === "udp_uadp" && !url.port)
      return "The UDP endpoint requires an explicit port";
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))
      return "Invalid endpoint port";
    return null;
  } catch {
    return "Enter a complete endpoint URL";
  }
}

export const industrialConnectionSchema = z
  .object({
    connectionId: connectivityId.refine(
      (id) => id !== "gateway-configuration",
      "This identity is reserved for gateway receipts",
    ),
    name: text(120),
    protocol: z.enum(connectivityProtocols),
    endpoint: text(512),
    enabled: z.boolean(),
    intervalMs: z.number().int().min(100).max(60000),
    credentialRef: reference.optional(),
    mode: z.enum(["live", "simulated"]).optional(),
    scenarioRunId: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
      .optional(),
    tags: z.array(connectivityTagSchema).max(100),
    fx: fxConfiguration.optional(),
    tsn: tsnConfigurationSchema.optional(),
  })
  .strict()
  .superRefine((connection, ctx) => {
    const error = endpointError(connection);
    if (error)
      ctx.addIssue({ code: "custom", path: ["endpoint"], message: error });
    if (connection.mode === "simulated" && !connection.scenarioRunId)
      ctx.addIssue({
        code: "custom",
        path: ["scenarioRunId"],
        message: "Simulation requires a scenario identity",
      });
    if (connection.mode !== "simulated" && connection.scenarioRunId)
      ctx.addIssue({
        code: "custom",
        path: ["scenarioRunId"],
        message: "A live connection cannot carry a simulation identity",
      });
    if ((connection.protocol === "opcua_fx") !== !!connection.fx)
      ctx.addIssue({
        code: "custom",
        path: ["fx"],
        message: "FX settings are required only for the OPC UA FX driver",
      });
    if (
      new Set(connection.tags.map((t) => t.tagId)).size !==
      connection.tags.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Tag identities must be unique within a connection",
      });
    const fields = new Set<number>();
    for (const [index, tag] of connection.tags.entries()) {
      const sourceSchema =
        connection.protocol === "mqtt"
          ? mqttSource
          : connection.protocol.startsWith("modbus_")
            ? modbusSource
            : connection.fx?.mode === "udp_uadp"
              ? uadpSource
              : opcSource;
      if (!sourceSchema.safeParse(tag.source).success) {
        ctx.addIssue({
          code: "custom",
          path: ["tags", index, "source"],
          message: "The address fields must match the selected driver",
        });
        continue;
      }
      if ("address" in tag.source) {
        const bits = ["coil", "discrete_input"].includes(
          tag.source.registerType,
        );
        const counts: Record<string, number> = {
          boolean: 1,
          int16: 1,
          uint16: 1,
          int32: 2,
          uint32: 2,
          float32: 2,
          int64: 4,
          uint64: 4,
          float64: 4,
        };
        const count = tag.source.count ?? counts[tag.dataType];
        if (
          !counts[tag.dataType] ||
          count !== counts[tag.dataType] ||
          (bits && tag.dataType !== "boolean") ||
          tag.source.address + count > 65536
        )
          ctx.addIssue({
            code: "custom",
            path: ["tags", index, "source"],
            message: "Register count, address and type must agree",
          });
      }
      if ("fieldIndex" in tag.source) {
        if (fields.has(tag.source.fieldIndex))
          ctx.addIssue({
            code: "custom",
            path: ["tags", index, "source"],
            message: "Dataset field indexes must be unique",
          });
        fields.add(tag.source.fieldIndex);
      }
    }
    const fx = connection.fx;
    if (
      fx?.mode === "udp_uadp" &&
      (!connection.tags.length ||
        connection.tags.some((_, index) => !fields.has(index)))
    )
      ctx.addIssue({
        code: "custom",
        path: ["tags"],
        message:
          "UADP observation requires the complete field layout with indexes starting at zero and no gaps",
      });
    if (fx?.mode === "udp_uadp" && fx.publisherIdType !== "String") {
      const max = {
        Byte: 255n,
        UInt16: 65535n,
        UInt32: 4294967295n,
        UInt64: 18446744073709551615n,
      }[fx.publisherIdType];
      if (
        !/^(0|[1-9]\d*)$/.test(fx.publisherId) ||
        BigInt(fx.publisherId) > max
      )
        ctx.addIssue({
          code: "custom",
          path: ["fx", "publisherId"],
          message: "Publisher identity must fit its selected wire type",
        });
    }
  });
export const industrialConfigurationSchema = z
  .object({
    schemaVersion: z.literal("industrial-connectivity/v1"),
    gatewayDeviceId: connectivityId,
    revision,
    connections: z.array(industrialConnectionSchema).max(16),
  })
  .strict()
  .superRefine((configuration, ctx) => {
    if (
      new Set(configuration.connections.map((c) => c.connectionId)).size !==
      configuration.connections.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["connections"],
        message: "Connection identities must be unique",
      });
    if (
      new TextEncoder().encode(JSON.stringify(configuration)).byteLength > 64000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Gateway configuration exceeds the 64,000-byte command payload budget",
      });
  });

const observedTag = z
  .object({
    tagId: connectivityId,
    dataType,
    value: z.union([
      z.boolean(),
      z.number().finite(),
      z.string().max(1024),
      z.null(),
    ]),
    quality: z.enum(["good", "bad", "uncertain", "unknown"]),
    unit: text(32).optional(),
    nativeStatus: text(128).optional(),
    sourceTimestamp: timestamp.optional(),
    serverTimestamp: timestamp.optional(),
    qualityBasis: z
      .enum(["protocol", "communication", "payload", "unauthenticated_udp"])
      .optional(),
  })
  .strict()
  .superRefine((tag, ctx) => {
    if (tag.value === null) {
      if (tag.quality === "good")
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Good quality requires a value",
        });
      return;
    }
    let valid =
      tag.dataType === "boolean"
        ? typeof tag.value === "boolean"
        : tag.dataType === "string"
          ? typeof tag.value === "string"
          : typeof tag.value === "number";
    if (tag.dataType === "int64" || tag.dataType === "uint64") {
      valid =
        typeof tag.value === "string" && /^(0|-?[1-9]\d*)$/.test(tag.value);
      if (valid) {
        const value = BigInt(tag.value as string);
        valid =
          tag.dataType === "int64"
            ? value >= -9223372036854775808n && value <= 9223372036854775807n
            : value >= 0n && value <= 18446744073709551615n;
      }
    }
    if (!valid)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "The value does not match its declared type",
      });
  });
const fxObservation = z
  .object({
    mode: z.enum(["diagnostics", "udp_uadp"]),
    modelVerified: z.boolean(),
    components: z
      .array(
        z
          .object({
            name: text(120),
            nodeId: text(512),
            namespaceUri: text(256),
            kind: z.enum([
              "automation_component",
              "functional_entity",
              "connection_endpoint",
              "connection_manager",
            ]),
            state: text(128).optional(),
          })
          .strict(),
      )
      .max(20),
    warnings: z.array(code).max(8),
    determinism: z.literal("unverified"),
    publisherId: text(128).optional(),
    writerGroupId: z.number().int().min(1).max(65535).optional(),
    dataSetWriterId: z.number().int().min(1).max(65535).optional(),
    receivedMessages: uint.optional(),
    droppedMessages: uint.optional(),
    lastSequenceNumber: z.number().int().min(0).max(65535).optional(),
  })
  .strict()
  .superRefine((fx, ctx) => {
    if (fx.mode === "udp_uadp" && fx.modelVerified)
      ctx.addIssue({
        code: "custom",
        path: ["modelVerified"],
        message: "A UDP packet does not verify an FX information model",
      });
  });
export const tsnObservationSchema = z
  .object({
    interface: tsnConfigurationSchema.shape.interface,
    observedAt: timestamp,
    clock: z
      .object({
        state: z.enum(["synchronized", "unsynchronized", "unknown"]),
        domain: z.number().int().min(0).max(127).optional(),
        grandmasterId: text(64).optional(),
        offsetNs: z.number().finite().optional(),
        meanPathDelayNs: z.number().finite().optional(),
        portState: text(32).optional(),
      })
      .strict(),
    capabilities: z
      .object({
        hardwareTimestamping: z.enum(["supported", "unsupported", "unknown"]),
        ptpHardwareClock: text(64).optional(),
      })
      .strict(),
    qdiscs: z
      .array(
        z
          .object({
            kind: text(32),
            handle: text(32).optional(),
            parent: text(32).optional(),
          })
          .strict(),
      )
      .max(8),
    counters: z
      .object({
        rxDropped: uint.optional(),
        txDropped: uint.optional(),
        rxErrors: uint.optional(),
        txErrors: uint.optional(),
      })
      .strict(),
    evidence: z
      .array(
        z
          .object({
            source: z.enum(["pmc", "ethtool", "tc", "sysfs"]),
            status: z.enum(["observed", "unavailable"]),
          })
          .strict(),
      )
      .max(8),
    determinism: z.literal("unverified"),
  })
  .strict();
export const connectivityObservationSchema = z
  .object({
    schemaVersion: z.literal("industrial-observation/v1"),
    connectionId: connectivityId,
    configurationRevision: revision,
    eventId: z.uuid(),
    observedAt: timestamp,
    state: z.enum([
      "connected",
      "degraded",
      "disconnected",
      "waiting",
      "disabled",
    ]),
    tags: z.array(observedTag).max(20),
    errorCode: code.optional(),
    commandId: z.uuid().optional(),
    discoveredTags: z
      .array(
        z
          .object({
            name: text(120),
            nodeId: text(512),
            namespaceUri: text(256),
            dataType: text(32),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    fx: fxObservation.optional(),
    tsn: tsnObservationSchema.optional(),
  })
  .strict()
  .superRefine((observation, ctx) => {
    if (
      new Set(observation.tags.map((t) => t.tagId)).size !==
      observation.tags.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Duplicate tag identity",
      });
    if (
      observation.connectionId === "gateway-configuration" &&
      (observation.tags.length ||
        observation.commandId ||
        observation.discoveredTags ||
        observation.fx ||
        observation.tsn ||
        observation.errorCode ||
        !["waiting", "disabled"].includes(observation.state))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Configuration receipts cannot contain observations or probe results",
      });
    if (
      observation.tsn &&
      Date.parse(observation.tsn.observedAt) >
        Date.parse(observation.observedAt) + 1000
    )
      ctx.addIssue({
        code: "custom",
        path: ["tsn", "observedAt"],
        message: "Network evidence cannot follow the observation",
      });
    if (
      new TextEncoder().encode(JSON.stringify(observation)).byteLength > 15000
    )
      ctx.addIssue({
        code: "custom",
        message: "Observation exceeds the telemetry envelope budget",
      });
  });

export type IndustrialConnection = z.infer<typeof industrialConnectionSchema>;
export type IndustrialConfiguration = z.infer<
  typeof industrialConfigurationSchema
>;
export type ConnectivityTag = z.infer<typeof connectivityTagSchema>;
export type ConnectivityObservation = z.infer<
  typeof connectivityObservationSchema
>;

export const industrialDrivers = [
  {
    id: "opcua",
    label: "OPC UA",
    description:
      "Browse equipment nodes and acquire typed values through a secure OPC UA session.",
    capabilities: ["Read", "Browse", "Subscriptions"],
    qualification: "Commission server trust and tag mappings on the gateway.",
  },
  {
    id: "modbus_tcp",
    label: "Modbus TCP",
    description:
      "Read coils, discrete inputs and registers using a reviewed device map.",
    capabilities: ["Read", "Polling", "Register decoding"],
    qualification:
      "Verify the register map against the device model and firmware.",
  },
  {
    id: "modbus_rtu",
    label: "Modbus RTU",
    description: "Acquire values over a locally commissioned serial bus.",
    capabilities: ["Read", "Polling", "Serial bus"],
    qualification:
      "Requires a compatible local serial interface and bus configuration.",
  },
  {
    id: "mqtt",
    label: "MQTT",
    description:
      "Map subscribed JSON fields to independently identified equipment tags.",
    capabilities: ["Read", "Subscriptions", "JSON mapping"],
    qualification: "Commission the broker identity, topics and payload schema.",
  },
  {
    id: "opcua_fx",
    label: "OPC UA FX",
    description:
      "Discover FX models and observe explicitly configured UDP UADP datasets; collect local TSN evidence.",
    capabilities: [
      "Read",
      "FX discovery",
      "UADP observation",
      "TSN diagnostics",
    ],
    qualification:
      "Read-only observation. Hardware timing and FX conformance require separate qualification.",
  },
] as const;
