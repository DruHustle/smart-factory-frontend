import { z } from "zod";
const id = z.string().trim().min(1).max(160),
  text = z.string().trim().max(240);
export const networkScenarios = [
  "normal",
  "late-delivery",
  "clock-loss",
  "recovery",
] as const;
export const fxComponent = z.object({
  id,
  name: text,
  endpoint: z
    .string()
    .max(512)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ["opc.tcp:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "Endpoint must be an OPC UA address without embedded credentials, queries or fragments")
    .optional(),
  deviceIdentifier: id.optional(),
  namespaceUri: z.string().max(240),
  modelVersion: z.string().max(40),
  functionalEntities: z
    .array(
      z.object({
        id,
        name: text,
        inputs: z.array(text).max(32),
        outputs: z.array(text).max(32),
      }),
    )
    .max(32),
  health: z.enum(["healthy", "warning", "error", "unknown"]),
  monitoring: z
    .enum(["both-ends", "one-end", "none", "unknown"])
    .default("unknown"),
});
export const fxConnection = z.object({
  id,
  name: text,
  publisher: id,
  subscriber: id,
  publisherEntity: id.optional(),
  subscriberEntity: id.optional(),
  transport: z.enum(["uadp-udp", "uadp-ethernet", "unknown"]),
  state: z.enum([
    "operational",
    "preoperational",
    "disabled",
    "error",
    "unknown",
  ]),
  publishingIntervalUs: z.number().finite().positive().max(1e9).nullable(),
  deadlineUs: z.number().finite().positive().max(1e9).nullable(),
  diagnostics: z.array(text).max(12),
});
export const tsnPort = z.object({
  id,
  name: text,
  link: z.enum(["up", "down", "unknown"]),
  clockDomain: z.number().int().min(0).max(255).nullable(),
  grandmasterId: text.nullable(),
  syncState: z.enum(["locked", "acquiring", "unlocked", "unknown"]),
  offsetNs: z.number().finite().min(-1e12).max(1e12).nullable(),
  timestamping: z.enum(["hardware", "software", "unknown"]),
  features: z
    .array(z.enum(["802.1AS", "802.1Qbv", "802.1Qbu", "802.1Qci", "802.1CB"]))
    .max(5),
  scheduleConfigured: z.boolean(),
  scheduleHardwareVerified: z.boolean(),
});
export const tsnSample = z.object({
  at: z.iso.datetime(),
  offsetNs: z.number().finite().nullable(),
  jitterUs: z.number().finite().min(0).nullable(),
  latencyUs: z.number().finite().min(0).nullable(),
});
export const tsnStream = z.object({
  id,
  connectionId: id.optional(),
  name: text,
  publisherPortId: id.nullable(),
  subscriberPortId: id.nullable(),
  samples: z.array(tsnSample).max(120),
  packets: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  lost: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  deadlineMisses: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
  latencyEvidence: z.enum(["synchronized-hardware", "software", "unavailable"]),
});
export const networkSnapshot = z
  .object({
    version: z.literal(1),
    gatewayId: id,
    observedAt: z.iso.datetime(),
    source: z.enum(["collector", "operator-import"]),
    components: z.array(fxComponent).max(128),
    connections: z.array(fxConnection).max(256),
    ports: z.array(tsnPort).max(32),
    streams: z.array(tsnStream).max(64),
  })
  .superRefine((snapshot, ctx) => {
    for (const key of [
      "components",
      "connections",
      "ports",
      "streams",
    ] as const) {
      if (
        new Set(snapshot[key].map((row) => row.id)).size !==
        snapshot[key].length
      )
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Duplicate identities are not allowed",
        });
    }
    const ids = new Set(snapshot.components.map((c) => c.id));
    if (
      snapshot.components.some(
        (c) =>
          new Set(c.functionalEntities.map((e) => e.id)).size !==
          c.functionalEntities.length,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["components"],
        message:
          "Functional entity identities must be unique within a component",
      });
    if (
      snapshot.ports.some(
        (p) => p.scheduleHardwareVerified && !p.scheduleConfigured,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["ports"],
        message:
          "Hardware schedule verification requires a configured schedule",
      });
    if (
      snapshot.connections.some(
        (c) =>
          !ids.has(c.publisher) ||
          !ids.has(c.subscriber) ||
          c.publisher === c.subscriber,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["connections"],
        message: "Connections require distinct discovered endpoints",
      });
    const connectionIds = new Set(snapshot.connections.map((c) => c.id));
    for (const connection of snapshot.connections) {
      for (const [componentId, entityId] of [
        [connection.publisher, connection.publisherEntity],
        [connection.subscriber, connection.subscriberEntity],
      ]) {
        if (
          entityId &&
          !snapshot.components
            .find((c) => c.id === componentId)
            ?.functionalEntities.some((e) => e.id === entityId)
        )
          ctx.addIssue({
            code: "custom",
            path: ["connections"],
            message: "Functional entity must belong to its connection endpoint",
          });
      }
    }
    const ports = new Map(snapshot.ports.map((p) => [p.id, p]));
    for (const stream of snapshot.streams) {
      if (
        (stream.connectionId && !connectionIds.has(stream.connectionId)) ||
        (stream.publisherPortId && !ports.has(stream.publisherPortId)) ||
        (stream.subscriberPortId && !ports.has(stream.subscriberPortId))
      )
        ctx.addIssue({
          code: "custom",
          path: ["streams"],
          message:
            "Stream references must identify existing connections and ports",
        });
      if (
        stream.packets !== null &&
        stream.lost !== null &&
        stream.lost > stream.packets
      )
        ctx.addIssue({
          code: "custom",
          path: ["streams"],
          message: "Lost packets cannot exceed the reported packet count",
        });
      const publisher = ports.get(stream.publisherPortId ?? ""),
        subscriber = ports.get(stream.subscriberPortId ?? "");
      const synced =
        publisher &&
        subscriber &&
        publisher.id !== subscriber.id &&
        publisher.syncState === "locked" &&
        subscriber.syncState === "locked" &&
        publisher.timestamping === "hardware" &&
        subscriber.timestamping === "hardware" &&
        publisher.clockDomain !== null &&
        publisher.clockDomain === subscriber.clockDomain &&
        publisher.grandmasterId !== null &&
        publisher.grandmasterId === subscriber.grandmasterId;
      if (stream.latencyEvidence === "synchronized-hardware" && !synced)
        ctx.addIssue({
          code: "custom",
          path: ["streams"],
          message:
            "Hardware latency evidence requires both endpoint clocks locked in the same domain",
        });
      if (
        stream.latencyEvidence === "unavailable" &&
        (stream.deadlineMisses !== null ||
          stream.samples.some((s) => s.latencyUs !== null))
      )
        ctx.addIssue({
          code: "custom",
          path: ["streams"],
          message:
            "Unavailable timing cannot assert latency or deadline results",
        });
      if (
        stream.samples.some(
          (s, n) =>
            Date.parse(s.at) > Date.parse(snapshot.observedAt) ||
            (n > 0 && Date.parse(s.at) <= Date.parse(stream.samples[n - 1].at)),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["streams"],
          message:
            "Timing samples must be ordered and cannot follow the report timestamp",
        });
    }
  });
export type NetworkSnapshot = z.infer<typeof networkSnapshot>;
export type NetworkView = {
  synthetic: boolean;
  scenario: string;
  snapshots: NetworkSnapshot[];
  importedAt: string | null;
  stale: boolean;
  coverage?: { returned: number; total: number };
  provenance:
    | "authored-simulation"
    | "service-collector"
    | "operator-import"
    | "unavailable";
};
