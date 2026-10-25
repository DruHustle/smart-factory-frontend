import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { edgeTelemetrySchema } from "../telemetrySchema";
const fixture = JSON.parse(
  readFileSync("fixtures/telemetry/provenance-v1.json", "utf8"),
);
for (const c of fixture.cases)
  test(`provenance policy: ${c.name}`, () => {
    const r = edgeTelemetrySchema.safeParse({
      deviceId: "sensor",
      timestamp: 1792486800000,
      temperature: 45,
      integration: c.integration,
    });
    expect(r.success).toBe(c.valid);
    if (c.valid && r.success)
      expect(r.data.integration ?? null).toEqual(c.normalized);
  });

import { classify } from "../onesa/worker";
for (const status of [404, 408, 409, 423, 425, 428, 429, 500, 503])
  test(`recoverable receiver status ${status}`, () =>
    expect(classify(status)).toBe("transient"));
for (const status of [400, 413, 415, 422])
  test(`permanent receiver validation status ${status}`, () =>
    expect(classify(status)).toBe("permanent"));
