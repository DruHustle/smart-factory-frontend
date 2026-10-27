import { sourceUnits } from "./measurements";
import { z } from "zod";

/** Only telemetry mapping fields understood by the gateway may cross the service boundary. */
export const edgeTagMappingSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    metric: z
      .enum([
        "temperature",
        "humidity",
        "vibration",
        "power",
        "pressure",
        "rpm",
      ])
      .optional(),
    unit: z.string().max(32).optional(),
    address: z.number().int().min(0).max(65535).optional(),
    registerType: z
      .enum(["holding_register", "input", "input_register", "input_registers"])
      .optional(),
    scale: z.number().finite().optional(),
    offset: z.number().finite().optional(),
    count: z.number().int().min(1).max(2).optional(),
    deviceId: z.number().int().min(0).max(247).optional(),
    unitId: z.number().int().min(0).max(247).optional(),
    nodeId: z.string().trim().min(1).max(512).optional(),
    dataType: z
      .enum(["int16", "uint16", "int32", "uint32", "float32"])
      .optional(),
    wordOrder: z.enum(["big", "little"]).optional(),
    source: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((mapping, ctx) => {
    if (
      mapping.metric &&
      mapping.unit &&
      !sourceUnits[mapping.metric].includes(mapping.unit)
    )
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message:
          "Choose a supported engineering unit for this metric; incompatible dimensions cannot be aggregated.",
      });
  });

export const edgeTagMappingsSchema = z
  .array(edgeTagMappingSchema)
  .max(100)
  .superRefine((mappings, ctx) => {
    const seen = new Set<string>();
    mappings.forEach((m, i) => {
      if (m.metric) {
        if (seen.has(m.metric))
          ctx.addIssue({
            code: "custom",
            path: [i, "metric"],
            message:
              "Map each scalar metric once per asset; ambiguous engineering values are not accepted.",
          });
        seen.add(m.metric);
      }
    });
  });
