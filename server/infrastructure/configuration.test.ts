import { describe, it, expect } from "vitest";
import { monitoringInterval } from "./configuration";
import { healthPolicy, nextHealthState } from "./policy";

describe("infrastructure collection continuity", () => {
  const at = (n: number) =>
    new Date(Date.parse("2026-10-27T08:00:00Z") + n * 1000).toISOString();
  it("defaults to demand collection and rejects invalid schedules", () => {
    expect(monitoringInterval({})).toBeNull();
    for (const n of ["0", "59", "60.5", "901", "bad"])
      expect(
        monitoringInterval({ INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: n }),
      ).toBeNull();
  });
  it("reports only schedules that can actually run under the deployment policy", () => {
    expect(
      monitoringInterval({ INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: "900" }),
    ).toBe(900);
    for (const flag of ["PUBLIC_DEMO_DEPLOYMENT", "ENABLE_DEMO_ACCOUNTS"])
      expect(
        monitoringInterval({
          INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: "900",
          [flag]: "true",
        }),
      ).toBeNull();
  });
  it("can sustain a finding across expected scheduled checks", () => {
    const p = healthPolicy({ INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: "900" });
    const first = nextHealthState(undefined, "degraded", at(0), p);
    const second = nextHealthState(first.next, "degraded", at(900), p);
    expect(second.notification).toBe("incident");
    expect(second.next.since).toBe(at(0));
  });
  it("does not count a missing scheduled interval as continuous evidence", () => {
    const p = healthPolicy({ INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS: "900" });
    const first = nextHealthState(undefined, "degraded", at(0), p);
    const second = nextHealthState(first.next, "degraded", at(1800), p);
    expect(second.notification).toBeNull();
    expect(second.next.since).toBe(at(1800));
  });
  it("ignores an older result delivered after a newer incident", () => {
    const p = healthPolicy({});
    let current = nextHealthState(undefined, "unavailable", at(0), p);
    current = nextHealthState(current.next, "unavailable", at(60), p);
    current = nextHealthState(current.next, "unavailable", at(120), p);
    expect(current.next.alerted).toBe(true);
    const late = nextHealthState(current.next, "healthy", at(30), p);
    expect(late).toEqual({
      next: current.next,
      changed: false,
      notification: null,
    });
  });
});
