import { z } from "zod";
import { floorModel, layoutFactory } from "./factory-floor";
import type { InventoryItem } from "./inventory";

const coordinate = z.number().finite().min(-1000).max(1000);
export const layoutItemRef = z
  .string()
  .regex(/^(asset:[1-9]\d*|device:[1-9]\d*|equipment:[a-f0-9-]{36})$/);
export const factoryLayoutDocument = z
  .object({
    name: z.string().trim().min(1).max(120),
    width: z.number().finite().min(4).max(1000),
    depth: z.number().finite().min(4).max(1000),
    zones: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(80),
            x: coordinate,
            z: coordinate,
            width: z.number().finite().min(1).max(1000),
            depth: z.number().finite().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
    placements: z
      .array(
        z
          .object({
            ref: layoutItemRef,
            x: coordinate,
            z: coordinate,
            rotation: z.number().finite().min(0).max(360).default(0),
            zoneId: z.uuid().nullable().default(null),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const zones = new Set(v.zones.map((z) => z.id));
    if (zones.size !== v.zones.length)
      ctx.addIssue({
        code: "custom",
        message: "Each zone needs its own identity",
        path: ["zones"],
      });
    if (new Set(v.placements.map((p) => p.ref)).size !== v.placements.length)
      ctx.addIssue({
        code: "custom",
        message: "An item can only be placed once",
        path: ["placements"],
      });
    v.zones.forEach((a, i) => {
      if (
        a.x < -v.width / 2 ||
        a.z < -v.depth / 2 ||
        a.x + a.width > v.width / 2 + 0.001 ||
        a.z + a.depth > v.depth / 2 + 0.001
      )
        ctx.addIssue({
          code: "custom",
          message: "Keep each zone inside the floor",
          path: ["zones", i],
        });
    });
    v.placements.forEach((p, i) => {
      if (
        Math.abs(p.x) > v.width / 2 ||
        Math.abs(p.z) > v.depth / 2 ||
        (p.zoneId && !zones.has(p.zoneId))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Keep each item inside the floor and choose an existing zone",
          path: ["placements", i],
        });
    });
  });
export type FactoryLayoutDocument = z.infer<typeof factoryLayoutDocument>;
export type SavedFactoryLayout = {
  id: string;
  version: number;
  document: FactoryLayoutDocument;
  updatedAt: string;
  archived: boolean;
  omittedItems?: number;
};

export function factoryLayoutGeometry(
  document: FactoryLayoutDocument,
  items: InventoryItem[],
) {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const placements = document.placements.flatMap((p) => {
    const item = byRef.get(p.ref);
    return item
      ? [
          {
            item,
            x: p.x,
            z: p.z,
            rotation: p.rotation,
            model: floorModel(item),
          },
        ]
      : [];
  });
  return {
    width: document.width,
    depth: document.depth,
    placements,
    zones: document.zones.map((z) => ({
      ...z,
      count: document.placements.filter(
        (p) => p.zoneId === z.id && byRef.has(p.ref),
      ).length,
    })),
  };
}

export function layoutFromInventory(
  items: InventoryItem[],
): FactoryLayoutDocument {
  const layout = layoutFactory(items);
  const zones = layout.zones.map((z) => ({ ...z, id: crypto.randomUUID() }));
  return factoryLayoutDocument.parse({
    name: "My factory",
    width: layout.width + 4,
    depth: layout.depth + 4,
    zones: zones.map(({ count, ...z }) => z),
    placements: layout.placements.map((p) => ({
      ref: p.item.ref,
      x: p.x,
      z: p.z,
      rotation: 0,
      zoneId:
        zones.find(
          (z) =>
            z.name ===
            (p.item.zone?.trim() || p.item.location?.trim() || "Unassigned"),
        )?.id ?? null,
    })),
  });
}
