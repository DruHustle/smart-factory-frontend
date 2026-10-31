import { z } from "zod";
import {
  factoryLayoutDocument,
  layoutItemRef,
  type FactoryLayoutDocument,
} from "./factory-layout";
import type { InventoryItem } from "./inventory";

export const physicalDimensions = z
  .object({
    width: z.number().finite().min(0.05).max(1000),
    depth: z.number().finite().min(0.05).max(1000),
    height: z.number().finite().min(0.05).max(1000),
  })
  .strict();
export type PhysicalDimensions = z.infer<typeof physicalDimensions>;
export const factoryDimensions = z.record(layoutItemRef, physicalDimensions);
export const namedFactoryDraft = z
  .object({
    document: factoryLayoutDocument,
    dimensions: factoryDimensions,
    tags: z.record(layoutItemRef, z.string().trim().min(1).max(128)),
  })
  .strict()
  .superRefine(({ document, dimensions, tags }, ctx) => {
    const refs = new Set(document.placements.map((p) => p.ref));
    for (const ref of Object.keys(tags)) {
      if (!refs.has(ref))
        ctx.addIssue({
          code: "custom",
          message: "A factory tag must belong to an item on this floor",
          path: ["tags", ref],
        });
    }
    if (
      new Set(Object.values(tags).map((tag) => tag.toLowerCase())).size !==
      Object.keys(tags).length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each item in a factory needs a distinct factory tag",
        path: ["tags"],
      });
    for (const ref of Object.keys(dimensions)) {
      if (!refs.has(ref))
        ctx.addIssue({
          code: "custom",
          message: "Dimensions must belong to an item on this factory floor",
          path: ["dimensions", ref],
        });
    }
    document.placements.forEach((p, index) => {
      const size = dimensions[p.ref];
      if (!size || !tags[p.ref]) {
        ctx.addIssue({
          code: "custom",
          message: "Every factory item needs dimensions and a factory tag",
          path: ["dimensions", p.ref],
        });
        return;
      }
      const angle = (p.rotation * Math.PI) / 180;
      const halfX =
        (Math.abs(Math.cos(angle)) * size.width +
          Math.abs(Math.sin(angle)) * size.depth) /
        2;
      const halfZ =
        (Math.abs(Math.sin(angle)) * size.width +
          Math.abs(Math.cos(angle)) * size.depth) /
        2;
      if (
        Math.abs(p.x) + halfX > document.width / 2 + 0.001 ||
        Math.abs(p.z) + halfZ > document.depth / 2 + 0.001
      )
        ctx.addIssue({
          code: "custom",
          message: "Keep the equipment's full footprint inside the floor",
          path: ["document", "placements", index],
        });
    });
  });
export type NamedFactoryDraft = z.infer<typeof namedFactoryDraft>;
export const factoryIdentity = z
  .object({ id: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();
export const newFactoryItem = z
  .object({
    name: z.string().trim().min(1).max(180),
    identifier: z.string().trim().max(128).default(""),
    kind: z.enum(["asset", "device"]),
    itemType: z.string().trim().min(1).max(80),
    dimensions: physicalDimensions,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (
      item.kind === "device" &&
      (!["sensor", "actuator", "controller", "gateway", "edge_device"].includes(
        item.itemType,
      ) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(item.identifier))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Enter the device's actual hardware ID (up to 64 safe characters) and a supported device type",
        path: ["identifier"],
      });
  });
export type NewFactoryItem = z.infer<typeof newFactoryItem>;
export type NamedFactorySummary = {
  id: string;
  name: string;
  width: number;
  depth: number;
  version: number;
  items: number;
  updatedAt: string;
};
export type NamedFactory = Omit<NamedFactorySummary, "items"> &
  NamedFactoryDraft & {
    items: InventoryItem[];
    total: number;
    unavailableItems: number;
    cleanupWarnings?: string[];
  };
export type FactoryActivitySummary = {
  id: string;
  factoryId: string;
  changeSet: string;
  action: string;
  targetRef: string | null;
  label?: string | null;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  at: string;
};
export type FactoryActivity = FactoryActivitySummary & {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export function factoryLayoutChangeCount(
  before: FactoryLayoutDocument,
  after: FactoryLayoutDocument,
) {
  const old = new Map(before.placements.map((p) => [p.ref, p]));
  return after.placements.filter(
    (p) => JSON.stringify(old.get(p.ref)) !== JSON.stringify(p),
  ).length;
}
