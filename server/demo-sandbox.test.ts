import { describe, it, expect } from "vitest";
import {
  applySandboxAction,
  seedDemoSandbox,
  demoSandbox,
  sandboxInventory,
  type SandboxAction,
} from "../shared/demo-sandbox";
import { demoAssistantContext } from "../shared/demo-assistant";
import { answerDemoQuestion } from "./demo-assistant";
const create: SandboxAction = {
  type: "item.save",
  item: { name: "My pump", kind: "asset", itemType: "pump", zone: "Assembly" },
};
function seeded() {
  return applySandboxAction(seedDemoSandbox([]), "engineer", create);
}
describe("editable browser demo boundaries and workflows", () => {
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
