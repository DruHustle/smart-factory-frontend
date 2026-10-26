import { describe, expect, it } from "vitest";
import { edgeTelemetrySchema, telemetryRejection } from "./telemetrySchema";

describe("edge telemetry wire contract", () => {
  it("normalizes the .NET direct-device bridge's null gateway without relaxing identity validation",()=>{
    const sample={deviceId:"standalone-sensor",gatewayId:null,assetId:null,timestamp:Date.now(),temperature:22};
    expect(edgeTelemetrySchema.parse(sample).gatewayId).toBeUndefined();
    expect(edgeTelemetrySchema.safeParse({...sample,gatewayId:"unsafe/topic"}).success).toBe(false);
  });
  it("normalizes the .NET bridge's nullable assetSignals field", () => {
    const parsed = edgeTelemetrySchema.parse({
      deviceId: "esp32-wrover-01",
      gatewayId: "pi-edge-01",
      assetId: null,
      sensorType: "DHT11",
      sensorStatus: "ok",
      assetSignals: null,
      timestamp: 1_791_222_498_582,
      temperature: 25.7,
      humidity: 35,
      vibration: null,
      power: null,
      pressure: null,
      rpm: null,
    });

    expect(parsed.assetSignals).toBeUndefined();
    expect(parsed.sensorType).toBe("DHT11");
    expect(parsed.sensorStatus).toBe("ok");
  });

  it("normalizes nullable .NET sensor metadata for asset telemetry", () => {
    const parsed = edgeTelemetrySchema.parse({
      deviceId: "pi-edge-01",
      gatewayId: "pi-edge-01",
      assetId: "urn:smart-factory:asset:ada031-v4-arm-01",
      sensorType: null,
      sensorStatus: null,
      assetSignals: { movement_active: 1, cycle_count: 2 },
      timestamp: 1_791_222_498_582,
    });

    expect(parsed.sensorType).toBeUndefined();
    expect(parsed.sensorStatus).toBeUndefined();
    expect(parsed.assetSignals).toEqual({ movement_active: 1, cycle_count: 2 });
  });

  it("rejects impossible relative-humidity values", () => {
    const sample = {
      deviceId: "esp32-wrover-01",
      gatewayId: "pi-edge-01",
      timestamp: 1_791_222_498_582,
      temperature: 25.7,
    };

    expect(
      edgeTelemetrySchema.safeParse({ ...sample, humidity: -0.1 }).success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({ ...sample, humidity: 100.1 }).success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({ ...sample, humidity: 0 }).success,
    ).toBe(true);
    expect(
      edgeTelemetrySchema.safeParse({ ...sample, humidity: 100 }).success,
    ).toBe(true);
  });

  it("rejects unknown sensor health states and control characters", () => {
    const sample = {
      deviceId: "esp32-wrover-01",
      timestamp: 1_791_222_498_582,
    };
    expect(
      edgeTelemetrySchema.safeParse({ ...sample, sensorStatus: "healthy" })
        .success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({ ...sample, sensorType: "DHT11\nspoofed" })
        .success,
    ).toBe(false);
  });

  it("requires internally consistent DHT11 health and measurement fields", () => {
    const sample = {
      deviceId: "esp32-wrover-01",
      sensorType: "DHT11",
      timestamp: 1_791_222_498_582,
    };

    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        temperature: 25,
        humidity: 40,
      }).success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        sensorStatus: "ok",
        temperature: 25,
      }).success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        sensorStatus: "read_error",
        temperature: 25,
        humidity: 40,
      }).success,
    ).toBe(false);
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        sensorStatus: "ok",
        temperature: 25,
        humidity: 40,
      }).success,
    ).toBe(true);
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        sensorStatus: "read_error",
        temperature: null,
        humidity: null,
      }).success,
    ).toBe(true);
  });

  it("accepts the full Arduino uint32 counter range", () => {
    const sample = {
      deviceId: "ada031-v4-arm-01",
      timestamp: 1_791_222_498_582,
    };
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        assetSignals: { uptime_ms: 4_294_967_295 },
      }).success,
    ).toBe(true);
    expect(
      edgeTelemetrySchema.safeParse({
        ...sample,
        assetSignals: { uptime_ms: 4_294_967_296 },
      }).success,
    ).toBe(false);
  });
});

it("bounds validation diagnostics without echoing invalid values or unknown keys", () => {
  const secret = "private-invalid-input".repeat(1000);
  const result = edgeTelemetrySchema.safeParse({
    deviceId: "test",
    timestamp: 1,
    assetSignals: Object.fromEntries(
      Array.from({ length: 100 }, (_, n) => [`${n}${secret}`, null]),
    ),
    integration: {
      mode: "simulated",
      scenarioRunId: secret,
      gatewayReceivedAt: secret,
      [secret]: true,
    },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const body = telemetryRejection(result.error),
      wire = JSON.stringify(body);
    expect(body.details.length).toBe(8);
    expect(body.truncated).toBe(true);
    expect(Buffer.byteLength(wire)).toBeLessThan(2048);
    expect(wire).not.toContain(secret);
    expect(body.details[0].code).toBeTruthy();
  }
});
