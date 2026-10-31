import { describe, expect, it } from "vitest";
import { connectivityNetworkEvidence } from "./network-evidence";
import { demoConnectivity } from "./demo";
describe("Observed FX/TSN network view", () => {
  it("does not promote synthetic reports into the operational network view", () => {
    const demo = demoConnectivity();
    expect(
      connectivityNetworkEvidence(demo.configuration, demo.observations),
    ).toBeNull();
  });
  it("preserves clock evidence without claiming timestamp activation, topology or deterministic streams", () => {
    const demo = demoConnectivity();
    demo.configuration.connections.forEach((c) => {
      c.mode = "live";
      delete c.scenarioRunId;
    });
    const report = demo.observations.find((o) => o.tsn)!;
    report.tsn!.capabilities.hardwareTimestamping = "supported";
    report.tsn!.qdiscs = [{ kind: "taprio" }];
    report.tsn!.observedAt = new Date(
      Date.parse(report.observedAt) - 60000,
    ).toISOString();
    const snapshot = connectivityNetworkEvidence(demo.configuration, [report])!;
    expect(snapshot.ports[0]).toMatchObject({
      timestamping: "unknown",
      features: [],
      scheduleConfigured: true,
      scheduleHardwareVerified: false,
    });
    expect(snapshot.connections).toEqual([]);
    expect(snapshot.streams).toEqual([]);
    expect(snapshot.observedAt).toBe(report.tsn!.observedAt);
  });
});
