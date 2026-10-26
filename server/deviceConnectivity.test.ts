import { describe, expect, it } from "vitest";
import type { Device } from "../drizzle/schema";
import {
  DEVICE_OFFLINE_AFTER_MS,
  deviceWithCurrentStatus,
} from "./deviceConnectivity";

const now = Date.UTC(2026, 9, 5, 10);
const gateway = (
  status: Device["status"],
  lastSeen: Date | null,
  isDemo = false,
) => ({ status, lastSeen, isDemo, type: "gateway" }) as Device;

describe("gateway connectivity", () => {
  it("uses recent reports for online status", () => {
    expect(
      deviceWithCurrentStatus(
        gateway("online", new Date(now - DEVICE_OFFLINE_AFTER_MS)),
        now,
      ).status,
    ).toBe("online");
    expect(
      deviceWithCurrentStatus(
        gateway("online", new Date(now - DEVICE_OFFLINE_AFTER_MS - 1)),
        now,
      ).status,
    ).toBe("offline");
  });

  it("does not show never-seen or future-dated gateways as online", () => {
    expect(deviceWithCurrentStatus(gateway("online", null), now).status).toBe(
      "offline",
    );
    expect(
      deviceWithCurrentStatus(gateway("online", new Date(now + 1)), now).status,
    ).toBe("offline");
  });

  it("preserves operator fault and maintenance states and explicit demo fixtures", () => {
    expect(deviceWithCurrentStatus(gateway("error", null), now).status).toBe(
      "error",
    );
    expect(
      deviceWithCurrentStatus(gateway("maintenance", null), now).status,
    ).toBe("maintenance");
    expect(
      deviceWithCurrentStatus(gateway("online", null, true), now).status,
    ).toBe("online");
  });
});

it("keeps unknown observation policy separate from a stored online flag", () => {
  const now = Date.now();
  expect(
    deviceWithCurrentStatus(
      { ...gateway("online", new Date(now)), type: "sensor" },
      now,
    ).observedStatus,
  ).toBe("unknown");
});
it("honors a direct device's commissioned age instead of applying the gateway timeout", () => {
  const now = Date.now(),
    d = {
      ...gateway("online", new Date(now - 600000)),
      type: "sensor" as const,
      metadata: { connectionMode: "direct_mqtt", freshnessMs: 3600000 },
    };
  expect(deviceWithCurrentStatus(d, now)).toMatchObject({
    status: "online",
    observedStatus: "live",
  });
  expect(deviceWithCurrentStatus(d, now + 3600000).observedStatus).toBe(
    "stale",
  );
});
