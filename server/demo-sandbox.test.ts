import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { namedFactoryDraft } from "../shared/named-factory";
import {
  applySandboxAction,
  seedDemoSandbox,
  demoSandbox,
  sandboxInventory,
  type SandboxAction,
} from "../shared/demo-sandbox";
import { demoAssistantContext } from "../shared/demo-assistant";
import { gatewayLinksForFloor } from "../shared/factory-floor";
import { answerDemoQuestion } from "./demo-assistant";
import { buildDemoAssistantContext } from "../client/src/lib/demo-assistant-context";
import {
  buildPiBenchPreset,
  findPiBenchFactory,
  PI_BENCH_NAME,
} from "../shared/pi-bench";
const create: SandboxAction = {
  type: "item.save",
  item: { name: "My pump", kind: "asset", itemType: "pump", zone: "Assembly" },
};
function seeded() {
  return applySandboxAction(seedDemoSandbox([]), "engineer", create);
}
describe("editable browser demo boundaries and workflows", () => {
  it("starts the public showcase with a two-device, editable bench topology", () => {
    const state = seedDemoSandbox([
      {
        ref: "device:1",
        kind: "device",
        identifier: "smart-factory-public-simulator",
        name: "Showcase simulator",
        itemType: "gateway",
        zone: "Showcase",
        configured: true,
        equipmentId: null,
        isDemo: true,
      } as any,
    ]);
    const factory = state.factories.find(
      (f) => f.draft.document.name === "Current Pi + DHT11 setup",
    );
    expect(factory?.draft.document.placements).toHaveLength(2);
    const refs = new Set(factory!.draft.document.placements.map((p) => p.ref));
    const bench = sandboxInventory(state).filter((item) => refs.has(item.ref));
    expect(bench.map((item) => item.identifier).sort()).toEqual([
      "esp32-wrover-01",
      "pi-edge-01",
    ]);
    expect(gatewayLinksForFloor(bench)).toMatchObject([
      { from: bench[0].ref, to: bench[1].ref, kind: "gateway" },
    ]);
    expect(bench.every((item) => item.isDemo && item.sandbox)).toBe(true);
    expect(state.factoryActivity).toEqual([]);
    expect(state.audit).toEqual([]);
    expect(
      buildDemoAssistantContext(
        state,
        "Why does Showcase simulator need attention?",
        [],
      ),
    ).toBeUndefined();
  });
  it("does not admit private inventory into its reference seed", () => {
    expect(
      seedDemoSandbox([{ isDemo: false, name: "private" } as any]).items,
    ).toEqual([]);
  });
  it.each(["viewer", "operator"] as const)(
    "requires engineering permission to create equipment as %s",
    (role) => {
      expect(() =>
        applySandboxAction(seedDemoSandbox([]), role, create),
      ).toThrow(/engineer/);
    },
  );
  it("creates independent workspaces and never mutates its input", () => {
    const first = seedDemoSandbox([]),
      second = seedDemoSandbox([]);
    const edited = applySandboxAction(first, "admin", create);
    expect(first.items).toHaveLength(0);
    expect(second.items).toHaveLength(0);
    expect(edited.items).toHaveLength(1);
    expect(first.id).not.toBe(second.id);
    expect(edited.items[0].custom).toBe(true);
  });
  it("keeps retained server evidence for an untouched reference copy and captures local edits", () => {
    const reference = seedDemoSandbox(
      sandboxInventory(seeded()).map((item) => ({ ...item, isDemo: true })),
    );
    expect(reference.items).toHaveLength(1);
    expect(reference.items[0].custom).toBe(false);
    expect(
      buildDemoAssistantContext(
        reference,
        "Why does My pump need attention?",
        [],
      ),
    ).toBeUndefined();
    const edited = applySandboxAction(reference, "operator", {
      type: "sample",
      ref: reference.items[0].ref,
      metric: "temperature",
      value: 85,
    });
    expect(
      buildDemoAssistantContext(edited, "What is My pump temperature?", [])
        ?.items[0].samples,
    ).toMatchObject([{ metric: "temperature", value: 85, unit: "°C" }]);
    expect(reference.audit).toEqual([]);
  });
  it("persists validated changes and resets to a separate reference workspace", () => {
    const s = seeded();
    expect(demoSandbox.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(seedDemoSandbox([]).id).not.toBe(s.id);
    expect(seedDemoSandbox([]).audit).toEqual([]);
  });
  it("does not reuse custom item references after reset and preserves restored identities", () => {
    const first = seeded();
    const afterReset = seeded();
    expect(first.items[0].ref).not.toBe(afterReset.items[0].ref);
    expect(first.items[0].identifier).not.toBe(afterReset.items[0].identifier);
    const restored = demoSandbox.parse(JSON.parse(JSON.stringify(first)));
    expect(restored.items[0].ref).toBe(first.items[0].ref);
    const edited = applySandboxAction(restored, "engineer", {
      ...create,
      item: {
        ...create.item,
        ref: restored.items[0].ref,
        name: "Renamed pump",
      },
    });
    expect(edited.items[0].ref).toBe(first.items[0].ref);
    expect(edited.items[0].identifier).toBe(first.items[0].identifier);
    expect(Number.isSafeInteger(Number(first.items[0].ref.split(":")[1]))).toBe(
      true,
    );
  });
  it("creates an incident using canonical units and keeps acknowledgement separate from resolution", () => {
    let s = seeded();
    const ref = s.items[0].ref;
    s = applySandboxAction(s, "engineer", {
      type: "threshold",
      ref,
      metric: "temperature",
      warning: 60,
      critical: 80,
      direction: "above",
    });
    s = applySandboxAction(s, "operator", {
      type: "sample",
      ref,
      metric: "temperature",
      value: 85,
    });
    expect(s.samples[0].unit).toBe("°C");
    expect(s.incidents[0]).toMatchObject({
      severity: "critical",
      status: "open",
    });
    s = applySandboxAction(s, "operator", {
      type: "incident",
      id: s.incidents[0].id,
      status: "acknowledged",
    });
    expect(s.incidents[0].status).toBe("acknowledged");
    s = applySandboxAction(s, "operator", {
      type: "incident",
      id: s.incidents[0].id,
      status: "resolved",
    });
    expect(s.incidents[0].status).toBe("resolved");
    const view = sandboxInventory(s)[0];
    expect(view).toMatchObject({
      mode: "simulated",
      status: "unknown",
      isDemo: true,
      sandbox: true,
    });
  });
  it.each(["ascending", "restored out of order", "same timestamp"])(
    "uses the newest reading in inventory and frozen assistant context: %s",
    (order) => {
      const s = seeded(),
        ref = s.items[0].ref;
      const at = "2026-10-30T07:00:00.000Z";
      const first = {
        id: crypto.randomUUID(),
        itemRef: ref,
        metric: "temperature" as const,
        value: 85,
        unit: "°C",
        at,
      };
      s.samples = [first];
      const frozen = buildDemoAssistantContext(
        s,
        "What is My pump temperature?",
        [],
      );
      const newer = {
        ...first,
        id: crypto.randomUUID(),
        value: 95,
        at: order === "same timestamp" ? at : "2026-10-30T07:01:00.000Z",
      };
      s.samples =
        order === "restored out of order" ? [newer, first] : [first, newer];
      expect(sandboxInventory(s)[0].values?.temperature).toBe(95);
      const context = buildDemoAssistantContext(
        s,
        "What is My pump temperature?",
        [],
      );
      expect(context?.items[0].samples[0].value).toBe(95);
      expect(frozen?.items[0].samples[0].value).toBe(85);
      expect(
        answerDemoQuestion("What is My pump temperature?", context!).answer,
      ).toContain("95");
    },
  );
  it("rejects an inverted rule, missing equipment and non-finite readings", () => {
    const s = seeded(),
      ref = s.items[0].ref;
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "threshold",
        ref,
        metric: "power",
        direction: "above",
        warning: 80,
        critical: 60,
      }),
    ).toThrow(/critical threshold/);
    expect(() =>
      applySandboxAction(s, "operator", {
        type: "sample",
        ref: "other",
        metric: "power",
        value: 1,
      }),
    ).toThrow(/Choose an item/);
    expect(() =>
      applySandboxAction(s, "operator", {
        type: "sample",
        ref,
        metric: "power",
        value: Infinity,
      }),
    ).toThrow();
  });
  it("requires an administrator for users and settings while viewers can explore diagnostics", () => {
    const s = seeded();
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "user",
        name: "Demo technician",
        role: "admin",
      }),
    ).toThrow(/admin/);
    expect(
      applySandboxAction(s, "viewer", {
        type: "scenario",
        scenario: "clock-loss",
      }).scenario,
    ).toBe("clock-loss");
    expect(
      applySandboxAction(s, "admin", {
        type: "user",
        name: "Demo technician",
        role: "operator",
      }).users.at(-1)?.role,
    ).toBe("operator");
  });
  it("queues and completes a simulated firmware workflow with an audit trail", () => {
    let s = seeded();
    const ref = s.items[0].ref;
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "deploy",
        ref,
        version: "2.0",
      }),
    ).toThrow(/metadata/);
    s = applySandboxAction(s, "engineer", { type: "firmware", version: "2.0" });
    s = applySandboxAction(s, "engineer", {
      type: "deploy",
      ref,
      version: "2.0",
    });
    expect(s.deployments[0].status).toBe("queued");
    s = applySandboxAction(s, "engineer", {
      type: "completeDeployment",
      id: s.deployments[0].id,
    });
    expect(s.deployments[0].status).toBe("completed");
    expect(s.audit.at(-1)?.action).toBe("completeDeployment");
  });
  it("requires a recorded investigation decision", () => {
    let s = seeded();
    s = applySandboxAction(s, "engineer", {
      type: "finding",
      ref: s.items[0].ref,
    });
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "decision",
        id: s.findings[0].id,
        state: "resolved",
        decision: "",
      }),
    ).toThrow();
    s = applySandboxAction(s, "engineer", {
      type: "decision",
      id: s.findings[0].id,
      state: "investigated",
      decision: "Reviewed simulated evidence",
    });
    expect(s.findings[0].state).toBe("investigated");
  });
  it("bounds imported backups and simulation context", () => {
    expect(
      demoSandbox.safeParse({
        ...seeded(),
        items: Array(501).fill(seeded().items[0]),
      }).success,
    ).toBe(false);
    expect(demoAssistantContext.safeParse({ name: "malformed" }).success).toBe(
      false,
    );
  });
  it("answers about edited simulated equipment without adding unrelated measurements", () => {
    const c = demoAssistantContext.parse({
      name: "My demo",
      capturedAt: new Date().toISOString(),
      itemCount: 1,
      assetCount: 1,
      deviceCount: 0,
      openIncidents: 0,
      scenario: "clock-loss",
      items: [
        {
          ref: "asset:2000000000",
          identifier: "urn:demo:pump",
          name: "My pump",
          itemType: "pump",
          connected: true,
          samples: [
            {
              metric: "temperature",
              value: 85,
              unit: "°C",
              at: new Date().toISOString(),
            },
          ],
        },
      ],
      incidents: [],
      findings: [],
    });
    const answer = answerDemoQuestion("What is my pump temperature?", c);
    expect(answer.answer).toContain("My pump");
    expect(answer.answer).toContain("85 °C");
    expect(answer.answer).toContain("browser simulation");
    expect(answer.answer).not.toMatch(/rpm|humidity/);
    expect(answerDemoQuestion("Check network timing", c).answer).toContain(
      "one-way latency is unavailable",
    );
  });
});

describe("adding the Pi bench to a saved browser demo", () => {
  const add: SandboxAction = { type: "factory.addPiBench" };
  const emptyFloor = (name = "Saved factory") => ({
    document: { name, width: 6, depth: 6, zones: [], placements: [] },
    dimensions: {},
    tags: {},
  });
  const saved = () =>
    applySandboxAction(seeded(), "engineer", {
      type: "factory.create",
      draft: emptyFloor(),
    });

  it("preserves saved inventory, samples and factory history while recording the new floor", () => {
    let source = saved();
    source = applySandboxAction(source, "operator", {
      type: "sample",
      ref: source.items[0].ref,
      metric: "temperature",
      value: 25,
    });
    const before = structuredClone(source);
    const added = applySandboxAction(source, "engineer", add);
    const bench = findPiBenchFactory(added)!;
    expect(source).toEqual(before);
    expect(added.items.slice(0, before.items.length)).toEqual(before.items);
    expect(added.factories.slice(0, before.factories.length)).toEqual(
      before.factories,
    );
    expect(added.samples).toEqual(before.samples);
    expect(
      added.factoryActivity.slice(0, before.factoryActivity.length),
    ).toEqual(before.factoryActivity);
    expect(
      added.factoryActivity
        .slice(before.factoryActivity.length)
        .map((row) => row.action),
    ).toEqual(["factory.created", "inventory.attached", "inventory.attached"]);
    expect(bench.draft.document.placements).toHaveLength(2);
    expect(added.audit.at(-1)).toMatchObject({
      role: "engineer",
      action: add.type,
    });
    expect(demoSandbox.parse(JSON.parse(JSON.stringify(added)))).toEqual(added);
  });

  it("reuses a renamed preset and legacy bench without adding equipment or duplicate history", () => {
    const added = applySandboxAction(saved(), "admin", add);
    const bench = findPiBenchFactory(added)!;
    const draft = structuredClone(bench.draft);
    draft.document.name = "My renamed hardware bench";
    const renamed = applySandboxAction(added, "engineer", {
      type: "factory.save",
      id: bench.id,
      expectedVersion: bench.version,
      draft,
    });
    expect(applySandboxAction(renamed, "admin", add)).toEqual(renamed);
    const legacy = structuredClone(renamed);
    for (const entry of legacy.factoryActivity)
      if (entry.after) delete entry.after.preset;
    expect(applySandboxAction(legacy, "admin", add)).toEqual(legacy);
    const edited = structuredClone(renamed);
    const gateway = edited.items.find(
      (item) => item.identifier === "pi-edge-01",
    )!;
    gateway.identifier = "renamed-gateway";
    expect(findPiBenchFactory(edited)?.id).toBe(bench.id);
    expect(applySandboxAction(edited, "admin", add)).toEqual(edited);
  });

  it("keeps newly saved preset factories readable by the prior strict v2 factory schema", () => {
    // A rollback still reads these exact factory fields. Extra metadata belongs
    // in the already-extensible history payload rather than the strict record.
    const previousFactorySchema = z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        updatedAt: z.string().datetime(),
        draft: namedFactoryDraft,
      })
      .strict();
    const added = applySandboxAction(saved(), "admin", add);
    const restored = demoSandbox.parse(JSON.parse(JSON.stringify(added)));
    for (const factory of restored.factories)
      expect(previousFactorySchema.parse(factory)).toEqual(factory);
    const bench = findPiBenchFactory(restored)!;
    expect(
      restored.factoryActivity.find(
        (entry) =>
          entry.factoryId === bench.id && entry.action === "factory.created",
      )?.after,
    ).toMatchObject({ name: PI_BENCH_NAME, preset: "pi-dht11" });
  });

  it("keeps existing device identities and factory names when choosing distinct preset values", () => {
    let source = saved();
    source.factories[0].draft.document.name = PI_BENCH_NAME;
    source.items = ["pi-edge-01", "ESP32-WROVER-01"].map(
      (identifier, index) => ({
        ...source.items[0],
        ref: `device:${index + 1}`,
        identifier,
        kind: "device" as const,
      }),
    );
    source = demoSandbox.parse(source);
    const added = applySandboxAction(source, "admin", add);
    const bench = findPiBenchFactory(added)!;
    const refs = new Set(bench.draft.document.placements.map((p) => p.ref));
    const items = sandboxInventory(added).filter((item) => refs.has(item.ref));
    expect(bench.draft.document.name).toBe(PI_BENCH_NAME + " (2)");
    expect(items.map((item) => item.identifier)).toEqual([
      "pi-edge-01-2",
      "esp32-wrover-01-2",
    ]);
    expect(gatewayLinksForFloor(items)).toMatchObject([
      { from: items[0].ref, to: items[1].ref },
    ]);
    expect(added.items.slice(0, source.items.length)).toEqual(source.items);
    expect(applySandboxAction(added, "admin", add)).toEqual(added);
  });

  it("recognizes a fresh seed with colliding device identifiers without marking it edited", () => {
    const reference = sandboxInventory(seeded())[0];
    const state = seedDemoSandbox(
      ["smart-factory-public-simulator", "pi-edge-01", "esp32-wrover-01"].map(
        (identifier, index) => ({
          ...reference,
          ref: `device:${index + 1}`,
          identifier,
          kind: "device" as const,
        }),
      ),
    );
    expect(findPiBenchFactory(state)?.draft.document.name).toBe(PI_BENCH_NAME);
    expect(
      state.items
        .filter((item) => item.serial === "DEMO-TOPOLOGY")
        .map((item) => item.identifier),
    ).toEqual(["pi-edge-01-2", "esp32-wrover-01-2"]);
    expect(state.audit).toEqual([]);
    expect(state.factoryActivity).toEqual([]);
    expect(applySandboxAction(state, "engineer", add)).toEqual(state);
  });

  it("does not reuse deleted inventory references", () => {
    const source = saved();
    source.factoryDeletedRefs.push("device:3000000001");
    const random = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    try {
      const preset = buildPiBenchPreset(source);
      expect(
        preset.items.every(
          (item) => !source.factoryDeletedRefs.includes(item.ref),
        ),
      ).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it.each(["viewer", "operator"] as const)(
    "requires engineering permission for %s",
    (role) => {
      expect(() => applySandboxAction(saved(), role, add)).toThrow(/engineer/);
    },
  );

  it.each(["items", "factories", "history"] as const)(
    "leaves saved data intact when %s capacity is exhausted",
    (capacity) => {
      const source = saved();
      if (capacity === "items")
        source.items = Array.from({ length: 499 }, (_, index) => ({
          ...source.items[0],
          ref: `device:${index + 1}`,
          identifier: `saved-${index}`,
          kind: "device" as const,
        }));
      else if (capacity === "factories")
        source.factories.push(
          ...Array.from({ length: 99 }, (_, index) => ({
            id: crypto.randomUUID(),
            version: 1,
            updatedAt: source.updatedAt,
            draft: emptyFloor(`Saved floor ${index}`),
          })),
        );
      else
        source.factoryActivity = Array.from({ length: 4998 }, (_, index) => ({
          ...source.factoryActivity[0],
          id: String(index + 1),
        }));
      demoSandbox.parse(source);
      const before = structuredClone(source);
      expect(() => applySandboxAction(source, "admin", add)).toThrow(
        /500-item|100 factories|5,000 activity/,
      );
      expect(source).toEqual(before);
    },
  );
});

describe("named demo factories, inventory and attributed history", () => {
  const empty = (name: string) => ({
    document: { name, width: 30, depth: 20, zones: [], placements: [] },
    dimensions: {},
    tags: {},
  });
  function factory() {
    return applySandboxAction(seedDemoSandbox([]), "engineer", {
      type: "factory.create",
      draft: empty("Demo team factory"),
    });
  }
  it("creates canonical inventory, saves placement, preserves deletion history and resets independently", () => {
    const initial = factory(),
      id = initial.factories[0].id;
    let s = applySandboxAction(initial, "engineer", {
      type: "factory.add",
      id,
      expectedVersion: 1,
      item: {
        name: "Physical pump",
        identifier: "P-01",
        kind: "asset",
        itemType: "pump",
        dimensions: { width: 2, depth: 1, height: 1.5 },
      },
    });
    const ref = s.items[0].ref;
    expect(sandboxInventory(s)).toHaveLength(1);
    expect(s.factories[0].draft.document.placements[0].ref).toBe(ref);
    const draft = structuredClone(s.factories[0].draft);
    draft.document.placements[0].x = 4;
    s = applySandboxAction(s, "engineer", {
      type: "factory.save",
      id,
      expectedVersion: s.factories[0].version,
      draft,
    });
    expect(s.factoryActivity.at(-1)).toMatchObject({
      action: "placement.changed",
      actorName: "Demo Engineer",
      before: { x: 0 },
      after: { x: 4 },
    });
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "factory.deleteItem",
        id,
        expectedVersion: s.factories[0].version,
        ref,
      }),
    ).toThrow(/admin/);
    s = applySandboxAction(s, "admin", {
      type: "factory.deleteItem",
      id,
      expectedVersion: s.factories[0].version,
      ref,
    });
    expect(sandboxInventory(s)).toHaveLength(0);
    expect(s.factories[0].draft.document.placements).toEqual([]);
    expect(s.factoryActivity.at(-1)).toMatchObject({
      action: "inventory.deleted",
      actorName: "Demo Admin",
      before: { name: "Physical pump", tag: "P-01", x: 4 },
      after: null,
    });
    expect(demoSandbox.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(seedDemoSandbox([]).factoryActivity).toEqual([]);
    expect(initial.factoryActivity).toHaveLength(1);
  });
  it("enforces roles, stale versions, distinct names/tags and one factory per item", () => {
    const s = factory(),
      id = s.factories[0].id;
    expect(() =>
      applySandboxAction(s, "viewer", {
        type: "factory.create",
        draft: empty("Forbidden"),
      }),
    ).toThrow(/engineer/);
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "factory.create",
        draft: empty("demo team factory"),
      }),
    ).toThrow(/distinct/);
    expect(() =>
      applySandboxAction(s, "engineer", {
        type: "factory.save",
        id,
        expectedVersion: 2,
        draft: empty("Stale"),
      }),
    ).toThrow(/newer/);
    const item = applySandboxAction(s, "engineer", create);
    const attached = applySandboxAction(item, "engineer", {
      type: "factory.attach",
      id,
      expectedVersion: 1,
      ref: item.items[0].ref,
      tag: "P1",
      dimensions: { width: 2, depth: 1, height: 1.5 },
    });
    const other = applySandboxAction(attached, "engineer", {
      type: "factory.create",
      draft: empty("Another floor"),
    });
    expect(() =>
      applySandboxAction(other, "engineer", {
        type: "factory.attach",
        id: other.factories[1].id,
        expectedVersion: 1,
        ref: item.items[0].ref,
        tag: "P1",
        dimensions: { width: 1, depth: 1, height: 1 },
      }),
    ).toThrow(/another factory/);
  });
  it("keeps assistant evidence inside the selected factory", () => {
    let s = factory();
    const id = s.factories[0].id;
    s = applySandboxAction(s, "engineer", {
      type: "factory.add",
      id,
      expectedVersion: 1,
      item: {
        name: "Inside pump",
        identifier: "P1",
        kind: "asset",
        itemType: "pump",
        dimensions: { width: 1, depth: 1, height: 1 },
      },
    });
    s = applySandboxAction(s, "engineer", {
      type: "item.save",
      item: {
        name: "Outside pump",
        kind: "asset",
        itemType: "pump",
        zone: null,
      },
    });
    const context = buildDemoAssistantContext(
      s,
      "How many items in this factory?",
      [],
      undefined,
      id,
    )!;
    expect(context.name).toBe("Demo team factory");
    expect(context.itemCount).toBe(1);
    expect(context.items.map((i) => i.name)).toEqual(["Inside pump"]);
  });
  it("upgrades the old demo without discarding inventory, samples or identity", async () => {
    const { upgradeDemoSandbox } = await import("../shared/demo-sandbox");
    const current = seeded();
    const { factories, factoryActivity, factoryDeletedRefs, ...legacy } =
      current;
    const upgraded = upgradeDemoSandbox({ ...legacy, version: 1 });
    expect(upgraded.items).toEqual(current.items);
    expect(upgraded.id).toBe(current.id);
    expect(upgraded.samples).toEqual(current.samples);
    expect(upgraded.factories).toEqual([]);
    expect(upgraded.version).toBe(2);
  });
});
