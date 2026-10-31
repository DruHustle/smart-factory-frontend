import type { DemoSandbox, SandboxRole } from "./demo-sandbox";
import type { DemoFactory, DemoFactoryAction } from "./demo-factory-types";
import {
  namedFactoryDraft,
  newFactoryItem,
  type PhysicalDimensions,
} from "./named-factory";
type Item = DemoSandbox["items"][number];
const ranks = { viewer: 0, operator: 1, engineer: 2, admin: 3 };
export function appendDemoFactoryActivity(
  s: DemoSandbox,
  role: SandboxRole,
  factoryId: string,
  action: string,
  targetRef: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  changeSet = crypto.randomUUID(),
) {
  if (s.factoryActivity.length >= 5000)
    throw Error(
      "This demo has 5,000 activity entries. Export the workspace before resetting it to continue.",
    );
  const last = s.factoryActivity.at(-1)?.id ?? "0";
  s.factoryActivity.push({
    id: (BigInt(last) + 1n).toString(),
    factoryId,
    changeSet,
    actorId: null,
    actorName: "Demo " + role[0].toUpperCase() + role.slice(1),
    actorRole: role,
    action,
    targetRef,
    before,
    after,
    at: new Date().toISOString(),
  });
}
const metadata = (factory: DemoFactory) => ({
  name: factory.draft.document.name,
  width: factory.draft.document.width,
  depth: factory.draft.document.depth,
  zones: factory.draft.document.zones,
});
function itemState(factory: DemoFactory, ref: string, name?: string) {
  const p = factory.draft.document.placements.find((p) => p.ref === ref)!;
  return {
    ref,
    name: name ?? null,
    tag: factory.draft.tags[ref],
    x: p.x,
    z: p.z,
    rotation: p.rotation,
    zoneId: p.zoneId,
    ...factory.draft.dimensions[ref],
  };
}
function validateRefs(s: DemoSandbox, factoryId: string, refs: string[]) {
  for (const ref of refs) {
    if (!s.items.some((i) => i.ref === ref))
      throw Error("Choose an item available in this demo inventory.");
    if (
      s.factories.some(
        (f) =>
          f.id !== factoryId &&
          f.draft.document.placements.some((p) => p.ref === ref),
      )
    )
      throw Error("This equipment is already assigned to another factory.");
  }
}
function position(factory: DemoFactory, size: PhysicalDimensions) {
  const { width, depth, placements } = factory.draft.document;
  const candidates = [{ x: 0, z: 0 }];
  for (
    let z = -depth / 2 + size.depth / 2 + 0.1;
    z <= depth / 2 - size.depth / 2 && candidates.length < 10000;
    z += Math.max(1, size.depth + 0.5)
  )
    for (
      let x = -width / 2 + size.width / 2 + 0.1;
      x <= width / 2 - size.width / 2 && candidates.length < 10000;
      x += Math.max(1, size.width + 0.5)
    )
      candidates.push({ x, z });
  const found = candidates.find(
    (p) =>
      Math.abs(p.x) + size.width / 2 <= width / 2 &&
      Math.abs(p.z) + size.depth / 2 <= depth / 2 &&
      placements.every((old) => {
        const d = factory.draft.dimensions[old.ref],
          angle = (old.rotation * Math.PI) / 180;
        const w =
          Math.abs(Math.cos(angle)) * d.width +
          Math.abs(Math.sin(angle)) * d.depth;
        const z =
          Math.abs(Math.sin(angle)) * d.width +
          Math.abs(Math.cos(angle)) * d.depth;
        return (
          Math.abs(p.x - old.x) >= (size.width + w) / 2 + 0.2 ||
          Math.abs(p.z - old.z) >= (size.depth + z) / 2 + 0.2
        );
      }),
  );
  if (!found)
    throw Error(
      "Make room on this floor or increase its dimensions before adding this item.",
    );
  return { ...found, rotation: 0, zoneId: null };
}
/** Mutate only the caller's cloned browser sandbox. Real inventory APIs remain contained. */
export function applyDemoFactoryAction(
  s: DemoSandbox,
  role: SandboxRole,
  action: DemoFactoryAction,
  createItem: (input: import("./named-factory").NewFactoryItem) => Item,
) {
  const minimum = action.type === "factory.deleteItem" ? "admin" : "engineer";
  if (ranks[role] < ranks[minimum])
    throw Error(
      "This demo action requires " +
        minimum +
        " access. Switch demo role to try it.",
    );
  const now = new Date().toISOString(),
    changeSet = crypto.randomUUID();
  const log = (
    factory: DemoFactory,
    kind: string,
    ref: string | null,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) =>
    appendDemoFactoryActivity(
      s,
      role,
      factory.id,
      kind,
      ref,
      before,
      after,
      changeSet,
    );
  if (action.type === "factory.create") {
    if (s.factories.length >= 100)
      throw Error("This demo supports 100 factories.");
    const draft = namedFactoryDraft.parse(action.draft);
    if (
      s.factories.some(
        (f) =>
          f.draft.document.name.toLowerCase() ===
          draft.document.name.toLowerCase(),
      )
    )
      throw Error("Choose a distinct factory name.");
    const factory: DemoFactory = {
      id: crypto.randomUUID(),
      version: 1,
      updatedAt: now,
      draft: structuredClone(draft),
    };
    validateRefs(
      s,
      factory.id,
      draft.document.placements.map((p) => p.ref),
    );
    s.factories.push(factory);
    log(factory, "factory.created", null, null, metadata(factory));
    for (const p of draft.document.placements) {
      log(
        factory,
        "inventory.attached",
        p.ref,
        null,
        itemState(factory, p.ref, s.items.find((i) => i.ref === p.ref)?.name),
      );
      factory.version++;
    }
    return;
  }
  const factory = s.factories.find((f) => f.id === action.id);
  if (!factory) throw Error("Factory not found in this browser demo.");
  if (factory.version !== action.expectedVersion)
    throw Error(
      "A newer factory version is saved. Reopen it before saving; your draft is retained.",
    );
  const touch = () => {
    factory.version++;
    factory.updatedAt = now;
  };
  if (action.type === "factory.save") {
    const next = namedFactoryDraft.parse(action.draft),
      before = structuredClone(factory);
    const refs = new Set(factory.draft.document.placements.map((p) => p.ref));
    if (
      refs.size !== next.document.placements.length ||
      next.document.placements.some((p) => !refs.has(p.ref))
    )
      throw Error(
        "Use Add item or the confirmed inventory bin action to change equipment.",
      );
    if (
      s.factories.some(
        (f) =>
          f.id !== factory.id &&
          f.draft.document.name.toLowerCase() ===
            next.document.name.toLowerCase(),
      )
    )
      throw Error("Choose a distinct factory name.");
    factory.draft = structuredClone(next);
    if (
      JSON.stringify(metadata(before)) !== JSON.stringify(metadata(factory))
    ) {
      log(
        factory,
        "factory.updated",
        null,
        metadata(before),
        metadata(factory),
      );
      touch();
    }
    for (const p of next.document.placements) {
      const old = itemState(
          before,
          p.ref,
          s.items.find((i) => i.ref === p.ref)?.name,
        ),
        current = itemState(
          factory,
          p.ref,
          s.items.find((i) => i.ref === p.ref)?.name,
        );
      if (JSON.stringify(old) !== JSON.stringify(current)) {
        log(factory, "placement.changed", p.ref, old, current);
        touch();
      }
    }
    return;
  }
  if (action.type === "factory.deleteItem") {
    const row = factory.draft.document.placements.find(
        (p) => p.ref === action.ref,
      ),
      item = s.items.find((i) => i.ref === action.ref);
    if (!row || !item) throw Error("This item is not in the selected factory.");
    log(
      factory,
      "inventory.deleted",
      action.ref,
      {
        ...itemState(factory, action.ref, item.name),
        identifier: item.identifier,
        itemType: item.itemType,
      },
      null,
    );
    s.items = s.items.filter((i) => i.ref !== action.ref);
    if (!s.factoryDeletedRefs.includes(action.ref))
      s.factoryDeletedRefs.push(action.ref);
    for (const field of [
      "samples",
      "thresholds",
      "incidents",
      "deployments",
      "findings",
    ] as const)
      s[field] = s[field].filter((row) => row.itemRef !== action.ref) as never;
    factory.draft.document.placements =
      factory.draft.document.placements.filter((p) => p.ref !== action.ref);
    delete factory.draft.dimensions[action.ref];
    delete factory.draft.tags[action.ref];
    touch();
    return;
  }
  if (s.items.length >= 500 && action.type === "factory.add")
    throw Error("This browser demo supports 500 items.");
  const input =
    action.type === "factory.add" ? newFactoryItem.parse(action.item) : null;
  const size =
    input?.dimensions ??
    (action as Extract<DemoFactoryAction, { type: "factory.attach" }>)
      .dimensions;
  const point = position(factory, size);
  let item: Item, tag: string;
  if (input) {
    item = createItem(input);
    tag =
      input.identifier ||
      input.itemType.toUpperCase().replace(/[^A-Z0-9]/g, "-") +
        "-" +
        crypto.randomUUID().slice(0, 8);
  } else {
    const attached = action as Extract<
      DemoFactoryAction,
      { type: "factory.attach" }
    >;
    validateRefs(s, factory.id, [attached.ref]);
    if (factory.draft.document.placements.some((p) => p.ref === attached.ref))
      throw Error("This item is already on the floor.");
    item = s.items.find((i) => i.ref === attached.ref)!;
    tag = attached.tag;
  }
  const next = namedFactoryDraft.parse({
    document: {
      ...factory.draft.document,
      placements: [
        ...factory.draft.document.placements,
        { ref: item.ref, ...point },
      ],
    },
    dimensions: { ...factory.draft.dimensions, [item.ref]: size },
    tags: { ...factory.draft.tags, [item.ref]: tag },
  });
  factory.draft = next;
  log(
    factory,
    input ? "inventory.created" : "inventory.attached",
    item.ref,
    null,
    itemState(factory, item.ref, item.name),
  );
  touch();
}
