import { z } from "zod";
import { metrics } from "./measurements";
export const demoAssistantContext = z
  .object({
    name: z.string().max(120),
    capturedAt: z.string().datetime(),
    itemCount: z.number().int().min(0).max(500),
    assetCount: z.number().int().min(0).max(500),
    deviceCount: z.number().int().min(0).max(500),
    openIncidents: z.number().int().min(0).max(200),
    scenario: z.enum(["normal", "late-delivery", "clock-loss", "recovery"]),
    items: z
      .array(
        z
          .object({
            ref: z.string().max(160),
            identifier: z.string().max(180),
            name: z.string().max(180),
            itemType: z.string().max(80),
            connected: z.boolean(),
            samples: z
              .array(
                z.object({
                  metric: z.enum(metrics),
                  value: z.number().finite().min(-1e12).max(1e12),
                  unit: z.string().max(32),
                  at: z.string().datetime(),
                }),
              )
              .max(6),
          })
          .strict(),
      )
      .max(24),
    incidents: z
      .array(
        z.object({
          itemRef: z.string().max(160),
          message: z.string().max(500),
          severity: z.enum(["warning", "critical"]),
          status: z.enum(["open", "acknowledged", "resolved"]),
          at: z.string().datetime(),
        }),
      )
      .max(32),
    findings: z
      .array(
        z.object({
          itemRef: z.string().max(160),
          title: z.string().max(180),
          state: z.enum(["open", "investigated", "deferred", "resolved"]),
          decision: z.string().max(1000),
        }),
      )
      .max(32),
  })
  .strict();
export type DemoAssistantContext = z.infer<typeof demoAssistantContext>;
