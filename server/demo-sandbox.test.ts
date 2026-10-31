import { describe, it, expect } from "vitest";
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
