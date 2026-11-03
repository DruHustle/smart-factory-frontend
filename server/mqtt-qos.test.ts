import { describe, expect, it } from "vitest";
import { mqttQosDesiredSchema, mqttQosLinkStatus } from "../shared/mqtt-qos";

const desired = { revision: 3, uplink: 2 as const, downlink: 1 as const };
const now = Date.parse("2026-11-03T20:00:30.000Z");
const maxAge = 60_000;
const report = (revision: number, level: 0 | 1 | 2) => ({ revision, level, observedAt: "2026-11-03T20:00:00.000Z" });

describe("MQTT delivery evidence", () => {
  it("requires reports from both participants for the current revision", () => {
    expect(mqttQosLinkStatus(desired, "deviceToGateway", { publisher: report(3, 2) }, now, maxAge).status).toBe("pending");
    expect(mqttQosLinkStatus(desired, "deviceToGateway", { publisher: report(3, 2), subscriber: report(2, 2) }, now, maxAge).effective).toBeNull();
    expect(mqttQosLinkStatus(desired, "deviceToGateway", { publisher: report(3, 2), subscriber: report(3, 2) }, now, maxAge).status).toBe("applied");
  });
  it("does not treat old or future evidence as current", () => {
    const evidence = { publisher: report(3, 2), subscriber: report(3, 2) };
    expect(mqttQosLinkStatus(desired, "deviceToGateway", evidence, now + 120_000, maxAge).status).toBe("pending");
    expect(mqttQosLinkStatus(desired, "deviceToGateway", evidence, now - 120_000, maxAge).status).toBe("pending");
  });
  it("shows a broker subscription downgrade instead of claiming the requested delivery", () => {
    expect(mqttQosLinkStatus(desired, "gatewayToCloud", { publisher: report(3, 2), subscriber: report(3, 1) }, now, maxAge)).toMatchObject({ requested: 2, effective: 1, status: "mismatch" });
  });
  it("uses the downlink setting for cloud and device commands", () => {
    expect(mqttQosLinkStatus(desired, "cloudToGateway", { publisher: report(3, 1), subscriber: report(3, 1) }, now, maxAge).status).toBe("applied");
    expect(mqttQosLinkStatus(desired, "cloudToGateway", { publisher: report(3, 1), subscriber: report(3, 2) }, now, maxAge).status).toBe("applied");
    expect(mqttQosLinkStatus(desired, "gatewayToDevice", { publisher: report(3, 0), subscriber: report(3, 1) }, now, maxAge).effective).toBe(0);
  });
  it("rejects invalid levels and unknown fields", () => {
    expect(mqttQosDesiredSchema.safeParse({ revision: 1, uplink: 3, downlink: 1 }).success).toBe(false);
    expect(mqttQosDesiredSchema.safeParse({ revision: 0x100000000, uplink: 1, downlink: 1 }).success).toBe(false);
    expect(mqttQosDesiredSchema.safeParse({ revision: 1, uplink: 0, downlink: 1, unknown: true }).success).toBe(false);
  });
});
