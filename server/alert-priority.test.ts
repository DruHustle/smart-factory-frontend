import { describe, expect, it } from "vitest";
import { alerts } from "../drizzle/schema";
import { registerDevice } from "./deviceRegistration";
import { getAlerts, getDb } from "./db";
import { disposableDatabase } from "./test/disposableDatabase";

describe.skipIf(!process.env.TEST_DATABASE_URL)("incident priority", () => {
  disposableDatabase("alert_priority");

  it("limits after severity ranking without changing the default newest-first order", async () => {
    const device = await registerDevice({
      deviceId: "priority-sensor",
      name: "Priority test sensor",
      type: "sensor",
      route: "direct",
    });
    const db = (await getDb())!;
    const createdAt = new Date("2026-01-01T00:00:00Z");
    await db.insert(alerts).values([
      {
        deviceId: device.id,
        type: "system_error",
        severity: "critical",
        message: "Older critical",
        createdAt,
      },
      {
        deviceId: device.id,
        type: "system_error",
        severity: "warning",
        message: "Newer warning",
        createdAt: new Date(createdAt.getTime() + 1000),
      },
      {
        deviceId: device.id,
        type: "system_error",
        severity: "info",
        message: "Newest information",
        createdAt: new Date(createdAt.getTime() + 2000),
      },
      {
        deviceId: device.id,
        type: "system_error",
        severity: "critical",
        status: "resolved",
        message: "Resolved critical",
        createdAt: new Date(createdAt.getTime() + 3000),
      },
    ]);
    expect(
      (await getAlerts({ openOnly: true, limit: 2, order: "severity" })).map(
        (a) => a.message,
      ),
    ).toEqual(["Older critical", "Newer warning"]);
    expect(
      (await getAlerts({ openOnly: true, limit: 2 })).map((a) => a.message),
    ).toEqual(["Newest information", "Newer warning"]);
  });
});
