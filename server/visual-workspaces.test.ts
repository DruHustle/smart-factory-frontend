import { describe, it, expect } from "vitest";
import {
  assistantLink,
  assistantPresentation,
  validatedAssistantPresentation,
  type AssistantPresentation,
} from "../shared/assistant";
import {
  ageSnapshot,
  healthSnapshot,
  recoveryReceipt,
} from "../shared/infrastructure";
import { demoInfrastructure } from "./infrastructure/demo";
import { nextHealthState, healthPolicy } from "./infrastructure/policy";
import { configuredProbe } from "./infrastructure/collector";
const start = Date.parse("2026-10-27T08:00:00Z"),
  end = start + 3600000;
const visual = (): AssistantPresentation => ({
  version: 1,
  format: "operational",
  context: {
    ref: "asset:1",
    assetId: "urn:example:pump",
    name: "Pump",
    itemType: "pump",
    location: null,
    isDemo: true,
    equipmentId: null,
    componentId: null,
    componentName: null,
  },
  trend: {
    assetId: "urn:example:pump",
    metric: "temperature",
    scope: "simulated",
    from: start,
    to: end,
    latest: {
      value: 82,
      unit: "°C",
      occurredAt: new Date(end).toISOString(),
      receivedAt: new Date(end + 1000).toISOString(),
      source: "Test source",
      quality: "good",
      freshness: "stale",
    },
    threshold: { value: 80, unit: "°C", label: "Source warning maximum" },
    sourceNumbers: [1, 2],
    snapshot: {
      scope: "simulated",
      metric: "temperature",
      unit: "°C",
      startTime: start,
      endTime: end,
      intervalMs: 60000,
      total: 2,
      verified: 2,
      unverified: 0,
      statisticsComplete: true,
      truncated: false,
      summary: { min: 32, max: 82, average: 57, latest: 82, latestAt: end },
      buckets: [
        { timestamp: start, value: 32, count: 1 },
        { timestamp: start + 60000, value: null, count: 0 },
        { timestamp: end, value: 82, count: 1 },
      ],
    },
  },
  events: [],
  workflow: [],
});
describe("trusted graphical answer contracts", () => {
  it("retains stored gaps, units and stable source references", () => {
    const v = validatedAssistantPresentation(visual(), 2)!;
    expect(v.trend?.snapshot?.buckets[1].value).toBeNull();
    expect(v.trend?.sourceNumbers).toEqual([1, 2]);
    expect(validatedAssistantPresentation(visual(), 1)).toBeUndefined();
  });
  it("rejects cross-equipment, incompatible unit/window and unbounded descriptors", () => {
    const a = visual();
    a.trend!.assetId = "different";
    expect(assistantPresentation.safeParse(a).success).toBe(false);
    const b = visual();
    b.trend!.threshold!.unit = "°F";
    expect(assistantPresentation.safeParse(b).success).toBe(false);
    const c = visual();
    c.trend!.snapshot!.scope = "live";
    expect(assistantPresentation.safeParse(c).success).toBe(false);
    const d = visual();
    d.trend!.snapshot!.buckets = Array.from({ length: 62 }, (_, i) => ({
      timestamp: start + i,
      value: 1,
      count: 1,
    }));
    expect(assistantPresentation.safeParse(d).success).toBe(false);
    const e = { ...visual(), html: "<script>execute()</script>" };
    expect(assistantPresentation.safeParse(e).success).toBe(false);
  });
  it("normalizes actual hash routes and refuses executable or API destinations", () => {
    for (const route of [
      "/inventory/asset:1/3d",
      "#/inventory/asset:1/3d",
      "/#/inventory/asset:1/3d",
    ])
      expect(assistantLink(route)).toEqual({
        kind: "internal",
        href: "/inventory/asset:1/3d",
      });
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,test",
      "/api/internal/telemetry",
      "//example.test/path",
      "https://user:password@example.test/",
      "/inventory\\bad",
    ])
      expect(assistantLink(bad)).toBeNull();
    expect(assistantLink("https://example.test/guide")?.kind).toBe("external");
  });
});
describe("infrastructure evidence policy", () => {
  it("requires bounded sustained observations, deduplicates alerts and records recovery", () => {
    const policy = healthPolicy({}),
      at = (seconds: number) => new Date(start + seconds * 1000).toISOString();
    let r = nextHealthState(undefined, "unavailable", at(0), policy);
    expect(r.notification).toBeNull();
    r = nextHealthState(r.next, "unavailable", at(60), policy);
    expect(r.notification).toBeNull();
    r = nextHealthState(r.next, "unavailable", at(120), policy);
    expect(r.notification).toBe("incident");
    r = nextHealthState(r.next, "unavailable", at(180), policy);
    expect(r.notification).toBeNull();
    r = nextHealthState(r.next, "healthy", at(240), policy);
    expect(r.notification).toBeNull();
    r = nextHealthState(r.next, "healthy", at(300), policy);
    expect(r.notification).toBe("recovery");
    r = nextHealthState(r.next, "healthy", at(360), policy);
    expect(r.notification).toBeNull();
  });
  it("does not interpret an unobserved gap or unknown/unconfigured evidence as a sustained outage", () => {
    const p = healthPolicy({}),
      at = (n: number) => new Date(start + n * 1000).toISOString();
    let r = nextHealthState(undefined, "degraded", at(0), p);
    r = nextHealthState(r.next, "degraded", at(3600), p);
    expect(r.notification).toBeNull();
    expect(r.next.since).toBe(at(3600));
    for (const state of ["unknown", "not_configured"] as const) {
      let x = nextHealthState(undefined, state, at(0), p);
      x = nextHealthState(x.next, state, at(120), p);
      expect(x.notification).toBeNull();
    }
  });
  it("expires current receipt states without replacing retained queue counts with zero", () => {
    const original = demoInfrastructure("failure").snapshot;
    original.synthetic = false;
    const aged = ageSnapshot(
      original,
      Date.parse(original.collectedAt) + 180000,
    );
    expect(aged.stale).toBe(true);
    expect(aged.services.find((s) => s.id === "telemetry-worker")?.state).toBe(
      "stale",
    );
    expect(aged.queues[0].state).toBe("stale");
    expect(aged.queues[0].pending).toBe(142);
  });
  it("keeps explicitly synthetic scenarios separate and never invents backup evidence", () => {
    const failed = demoInfrastructure("failure"),
      recovered = demoInfrastructure("recovery");
    expect(healthSnapshot.safeParse(failed.snapshot).success).toBe(true);
    expect(failed.snapshot.synthetic).toBe(true);
    expect(failed.snapshot.services.find((s) => s.id === "mqtt")?.state).toBe(
      "unavailable",
    );
    expect(
      recovered.snapshot.services.find((s) => s.id === "mqtt")?.state,
    ).toBe("healthy");
    expect(recovered.snapshot.queues[0].pending).toBe(0);
    expect(
      recovered.snapshot.resources.find((r) => r.id === "host-memory")?.value,
    ).toBeNull();
    expect(recovered.snapshot.recovery).toEqual([]);
    expect(recovered.historyWindow.availabilityPercent).toBeNull();
  });
  it("bounds operator policies, targets and recovery receipts without an arbitrary probe interface", () => {
    expect(
      healthPolicy({ INFRASTRUCTURE_ALERT_AFTER_SECONDS: "0" })
        .alertAfterSeconds,
    ).toBe(120);
    expect(
      configuredProbe("http://private.example/", "/health/ready"),
    ).toBeNull();
    expect(
      configuredProbe("https://user:secret@example.test/", "/health/ready"),
    ).toBeNull();
    expect(configuredProbe("http://127.0.0.1:3102", "/health/ready")).toBe(
      "http://127.0.0.1:3102/health/ready",
    );
    expect(
      recoveryReceipt.safeParse({
        kind: "backup",
        receiptId: "test",
        observedAt: new Date(end).toISOString(),
        outcome: "verified",
        source: "operator-verifier",
        scope: "application-databases",
        artifactSha256: "a".repeat(64),
        sourceRevision: null,
        password: "leak",
      }).success,
    ).toBe(false);
  });
});
