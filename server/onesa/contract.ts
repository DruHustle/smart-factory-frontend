import { z } from "zod";

// Proposed, not an Onesa-supported endpoint or schema. All generated artifacts
// come from these validators; do not maintain a second wire model.
export const CONTRACT = "urn:smart-factory:onesa-proposed:1.0.0" as const;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_.-]+$/);
const utc = z.iso.datetime();
export const metricSchema = z
  .object({
    metricId: id,
    meaning: z.enum([
      "temperature",
      "relative_humidity",
      "pressure",
      "rotational_speed",
      "power",
      "vibration_acceleration",
      "vibration_velocity",
    ]),
    valueType: z.literal("number"),
    unit: z.enum(["Cel", "%", "bar", "Pa", "1/min", "W", "kW", "m/s2", "mm/s"]),
    expectedIntervalMs: z.number().int().min(100).max(86_400_000),
  })
  .strict()
  .refine(
    (m) =>
      ({
        temperature: ["Cel"],
        relative_humidity: ["%"],
        pressure: ["bar", "Pa"],
        rotational_speed: ["1/min"],
        power: ["W", "kW"],
        vibration_acceleration: ["m/s2"],
        vibration_velocity: ["mm/s"],
      })[m.meaning].includes(m.unit),
    "Incompatible metric meaning/unit",
  );
const provenance = z
  .object({
    deviceId: id,
    sourceKey: id,
    rawValue: z.number().finite(),
    rawUnit: z.string().min(1).max(24),
    conversion: z
      .object({
        rule: z.literal("linear"),
        factor: z.number().finite(),
        offset: z.number().finite(),
      })
      .strict()
      .nullable(),
    aggregation: z.null(), // v1 does not aggregate: never imply a window that was not acquired.
    timestampOrigin: z.enum(["device", "gateway"]),
    retained: z.boolean(),
  })
  .strict();
export const eventSchema = z
  .object({
    eventId: z.string().regex(/^[a-f0-9]{64}$/),
    installationId: z.uuid(),
    equipmentId: z.uuid(),
    componentId: z.uuid(),
    assetTypeId: id,
    externalAssetId: z.string().min(1).max(128),
    target: z
      .object({
        workspaceId: id,
        equipmentId: id,
        componentId: id,
        mappingVersion: z.number().int().positive(),
      })
      .strict(),
    observedAt: utc,
    gatewayReceivedAt: utc,
    mode: z.enum(["live", "simulated", "replay"]),
    scenarioRunId: id.nullable(),
    replayRunId: id.nullable(),
    sessionId: id.nullable(),
    sequence: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    sourceQuality: z.enum(["good", "bad", "uncertain", "unknown"]),
    sourceConnection: z.enum(["online", "offline", "unknown"]),
    clockSkew: z.enum(["within_tolerance", "future", "delayed"]),
    kind: z.enum(["observation", "source_alarm", "source_connection"]),
    metric: metricSchema.nullable(),
    value: z.number().finite().nullable(),
    sourceEvent: z
      .object({
        id,
        origin: z.literal("source"),
        code: id,
        state: z.enum(["active", "cleared"]),
      })
      .strict()
      .nullable(),
    provenance: provenance.nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.mode === "simulated" && !e.scenarioRunId)
      ctx.addIssue({
        code: "custom",
        message: "Simulated events require scenarioRunId",
      });
    if (e.mode === "replay" && !e.replayRunId)
      ctx.addIssue({
        code: "custom",
        message: "Replay events require replayRunId",
      });
    if (e.mode !== "replay" && e.replayRunId)
      ctx.addIssue({
        code: "custom",
        message: "Replay identity on a non-replay event",
      });
    if (
      e.kind === "observation" &&
      (!e.metric || e.value === null || !e.provenance || e.sourceEvent)
    )
      ctx.addIssue({
        code: "custom",
        message: "Observation requires metric/value/provenance",
      });
    if (
      e.kind === "source_alarm" &&
      (!e.sourceEvent || e.metric || e.value !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Source alarms require identifiable source provenance",
      });
    if (
      e.kind === "source_connection" &&
      (e.metric || e.value !== null || e.sourceEvent)
    )
      ctx.addIssue({
        code: "custom",
        message: "Connection events do not contain measurements",
      });
  });
export const batchSchema = z
  .object({
    schema: z.literal(CONTRACT),
    installationId: z.uuid(),
    workspaceId: id,
    items: z.array(eventSchema).min(1).max(100),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (
      b.items.some(
        (e) =>
          e.installationId !== b.installationId ||
          e.target.workspaceId !== b.workspaceId,
      ) ||
      new Set(b.items.map((e) => e.eventId)).size !== b.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Batch scope or identity mismatch",
      });
  });
export const receiptSchema = z
  .object({
    schema: z.literal(CONTRACT),
    workspaceId: id,
    results: z
      .array(
        z
          .object({
            eventId: z.string().regex(/^[a-f0-9]{64}$/),
            status: z.enum(["accepted", "duplicate", "retry", "rejected"]),
            ingestedAt: utc.nullable(),
            code: z.enum([
              "ok",
              "busy",
              "invalid",
              "conflict",
              "missing_mapping",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const bindingSchema = z
  .object({
    sourceKey: z
      .enum([
        "temperature",
        "humidity",
        "pressure",
        "rpm",
        "power",
        "vibration",
      ])
      .or(z.string().regex(/^assetSignals\.[A-Za-z][A-Za-z0-9_.-]{0,63}$/)),
    componentId: z.uuid(),
    metric: metricSchema,
    sourceUnit: z.string().min(1).max(24),
  })
  .strict()
  .superRefine((b, ctx) => {
    const semantics: Record<string, string> = {
      temperature: "temperature",
      humidity: "relative_humidity",
      pressure: "pressure",
      rpm: "rotational_speed",
      power: "power",
    };
    if (
      (semantics[b.sourceKey] && semantics[b.sourceKey] !== b.metric.meaning) ||
      (b.sourceKey === "vibration" &&
        !b.metric.meaning.startsWith("vibration_"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Source signal meaning mismatch",
      });
    const compatible =
      b.sourceUnit === b.metric.unit ||
      ["Pa:bar", "bar:Pa", "W:kW", "kW:W"].includes(
        `${b.sourceUnit}:${b.metric.unit}`,
      );
    if (!compatible)
      ctx.addIssue({
        code: "custom",
        message: "No compatible explicit conversion",
      });
  });
export const registrationSchema = z
  .object({
    equipmentId: z.uuid(),
    externalAssetId: z.string().min(1).max(128),
    deviceId: id,
    name: z.string().min(1).max(200),
    assetTypeId: id,
    serialNumber: z.string().min(1).max(128),
    components: z
      .array(
        z
          .object({
            componentId: z.uuid(),
            name: z.string().min(1).max(200),
            parentComponentId: z.uuid().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    bindings: z.array(bindingSchema).min(1).max(32),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ids = new Set(r.components.map((c) => c.componentId));
    if (
      ids.size !== r.components.length ||
      r.bindings.some((b) => !ids.has(b.componentId)) ||
      new Set(r.bindings.map((b) => b.sourceKey)).size !== r.bindings.length ||
      new Set(r.bindings.map((b) => b.componentId + ":" + b.metric.metricId))
        .size !== r.bindings.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Ambiguous component or metric identity",
      });
    for (const c of r.components) {
      const seen = new Set([c.componentId]);
      let parent = c.parentComponentId;
      while (parent) {
        if (seen.has(parent) || !ids.has(parent)) {
          ctx.addIssue({
            code: "custom",
            message: "Invalid component hierarchy",
          });
          break;
        }
        seen.add(parent);
        parent =
          r.components.find((n) => n.componentId === parent)
            ?.parentComponentId ?? null;
      }
    }
  });
export const mappingSchema = z
  .object({
    equipmentId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    retired: z.boolean().default(false),
    targets: z
      .array(
        z
          .object({
            componentId: z.uuid(),
            equipmentId: id,
            targetComponentId: id,
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .refine(
    (m) =>
      new Set(m.targets.map((t) => t.componentId)).size === m.targets.length &&
      new Set(m.targets.map((t) => `${t.equipmentId}:${t.targetComponentId}`))
        .size === m.targets.length &&
      new Set(m.targets.map((t) => t.equipmentId)).size === 1,
    "Ambiguous targets",
  );
export type IntegrationEvent = z.infer<typeof eventSchema>;
export type Registration = z.infer<typeof registrationSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
