import { z } from "zod";
import {
  namedFactoryDraft,
  type NamedFactoryDraft,
  type NewFactoryItem,
  type PhysicalDimensions,
} from "./named-factory";
export const demoFactory = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    draft: namedFactoryDraft,
  })
  .strict();
export const demoFactoryActivity = z
  .object({
    id: z.string().regex(/^[1-9][0-9]*$/),
    factoryId: z.uuid(),
    changeSet: z.uuid(),
    actorId: z.number().int().nullable(),
    actorName: z.string().max(180),
    actorRole: z.string().max(32),
    action: z.string().max(64),
    targetRef: z.string().nullable(),
    at: z.string().datetime(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
export type DemoFactory = z.infer<typeof demoFactory>;
export type DemoFactoryAction =
  | { type: "factory.create"; draft: NamedFactoryDraft }
  | {
      type: "factory.save";
      id: string;
      expectedVersion: number;
      draft: NamedFactoryDraft;
    }
  | {
      type: "factory.add";
      id: string;
      expectedVersion: number;
      item: NewFactoryItem;
    }
  | {
      type: "factory.attach";
      id: string;
      expectedVersion: number;
      ref: string;
      tag: string;
      dimensions: PhysicalDimensions;
    }
  | {
      type: "factory.deleteItem";
      id: string;
      expectedVersion: number;
      ref: string;
    };
