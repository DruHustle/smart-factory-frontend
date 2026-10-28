import { describe, it, expect } from "vitest";
import { ageSnapshot } from "../../shared/infrastructure";
import { demoInfrastructure } from "./demo";

describe("current infrastructure evidence eligibility", () => {
  const fixture = () => {
    const s = demoInfrastructure("failure").snapshot;
    s.synthetic = false;
    return s;
  };
  it("expires failures as well as successful checks without rewriting history", () => {
    const original = fixture(),
      now = Date.parse(original.collectedAt) + 180000;
    expect(original.services.find((s) => s.id === "mqtt")?.state).toBe(
      "unavailable",
    );
    const aged = ageSnapshot(original, now);
    expect(aged.services.find((s) => s.id === "mqtt")?.state).toBe("stale");
    expect(aged.stale).toBe(true);
    expect(original.services.find((s) => s.id === "mqtt")?.state).toBe(
      "unavailable",
    );
  });
  it("retains last-known backlog counts while removing expired current measurements", () => {
    const original = fixture(),
      aged = ageSnapshot(original, Date.parse(original.collectedAt) + 180000);
    expect(aged.queues[0].pending).toBe(142);
    expect(aged.queues[0].state).toBe("stale");
    expect(aged.resources.find((r) => r.id === "api-rss")?.value).toBeNull();
    expect(aged.resources.find((r) => r.id === "api-rss")?.observedAt).toBe(
      original.resources.find((r) => r.id === "api-rss")?.observedAt,
    );
  });
  it("does not accept future collection or measurement timestamps as current", () => {
    const original = fixture(),
      now = Date.parse(original.collectedAt) - 1,
      aged = ageSnapshot(original, now);
    expect(aged.stale).toBe(true);
    expect(aged.services.find((s) => s.id === "api")?.state).toBe("stale");
    expect(aged.resources.filter((r) => r.value !== null)).toEqual([]);
  });
  it("ages each collector with its own policy while preserving unknown coverage", () => {
    const original = fixture(),
      now = Date.parse(original.collectedAt);
    original.collectors = [
      {
        id: "old",
        name: "Delayed collector",
        active: true,
        state: "healthy",
        collectedAt: original.collectedAt,
        observedAt: new Date(now - 31000).toISOString(),
        freshForSeconds: 30,
      },
      {
        id: "future",
        name: "Future collector",
        active: true,
        state: "healthy",
        collectedAt: original.collectedAt,
        observedAt: new Date(now + 1).toISOString(),
        freshForSeconds: 300,
      },
    ];
    expect(ageSnapshot(original, now).collectors.map((c) => c.state)).toEqual([
      "stale",
      "stale",
    ]);
    expect(
      ageSnapshot(original, now).resources.find((r) => r.id === "host-memory")
        ?.value,
    ).toBeNull();
  });
});
