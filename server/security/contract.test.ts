import { describe, it, expect } from "vitest";
import {
  envelope,
  parseBatch,
  canonical,
  digest,
  ownedEnvelope,
} from "./contract";
const base = {
  schemaVersion: "ot-security-evidence/v1",
  producerNamespace: "fixture",
  sourceEventId: "event-001",
  occurredAt: "2026-10-26T09:00:00Z",
  mode: "live",
  eventType: "auth.authentication_failed",
  assetRef: null,
  summary: "A sign-in was rejected.",
  quality: "good",
  producerVersion: "fixture-1",
  attributes: {
    service: "dashboard",
    outcome: "denied",
    reasonCode: "INVALID_CREDENTIALS",
  },
};
describe("owned evidence profile", () => {
  it("normalizes real UTC calendar values and hashes canonical content", () => {
    const a = envelope.parse({
      ...base,
      occurredAt: "2024-02-29T12:00:00.123456789+00:00",
    });
    expect(a.occurredAt).toBe("2024-02-29T12:00:00.123Z");
    expect(digest(a)).toBe(digest(JSON.parse(JSON.stringify(a))));
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });
  for (const stamp of [
    "2026-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:00:60Z",
    "2026-01-01T00:00:00+01:00",
    "2026-01-01T00:00:00-00:00",
    "0000-01-01T00:00:00Z",
    "2026-01-01",
    "bad",
  ])
    it(`rejects invalid UTC ${stamp}`, () =>
      expect(envelope.safeParse({ ...base, occurredAt: stamp }).success).toBe(
        false,
      ));
  for (const value of [null, 1, true, "", " ", "x".repeat(129)])
    for (const mode of ["simulated", "replay"])
      it(`rejects ${mode} run ${String(value).slice(0, 8)}`, () =>
        expect(
          envelope.safeParse({
            ...base,
            mode,
            [mode === "simulated" ? "scenarioRunId" : "replayRunId"]: value,
          }).success,
        ).toBe(false));
  for (const mode of ["simulated", "replay"])
    it(`requires a ${mode} run`, () =>
      expect(envelope.safeParse({ ...base, mode }).success).toBe(false));
  for (const extra of [
    "sourceId",
    "ingestedAt",
    "tenantId",
    "siteId",
    "userId",
    "localAssetId",
  ])
    it(`rejects caller authority ${extra}`, () =>
      expect(envelope.safeParse({ ...base, [extra]: "forged" }).success).toBe(
        false,
      ));
  for (const sequence of [-1, null, true, "1", Number.MAX_SAFE_INTEGER + 1])
    it(`rejects sequence ${sequence}`, () =>
      expect(envelope.safeParse({ ...base, sequence }).success).toBe(false));
  it("accepts explicit simulation and replay without upgrading either to live", () => {
    expect(
      envelope.parse({ ...base, mode: "simulated", scenarioRunId: "run" }).mode,
    ).toBe("simulated");
    expect(
      envelope.parse({ ...base, mode: "replay", replayRunId: "run" }).mode,
    ).toBe("replay");
  });
  it("rejects unsupported fields, profiles and untyped attribute blobs", () => {
    for (const change of [
      { schemaVersion: "v2" },
      { quality: "trusted" },
      { eventType: "process.high_temperature" },
      { attributes: { arbitrary: "data" } },
      { assetRef: { namespace: "a", assetId: "b" } },
      {
        attributes: { ...base.attributes, principalRef: "person@example.test" },
      },
      { attributes: { ...base.attributes, password: "never-store-me" } },
    ])
      expect(envelope.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it("separates the owned transport extension from the neutral exact-v1 profile", () => {
    const e = {
      ...base,
      schemaVersion: "smart-factory-ot-observation/v1",
      eventType: "transport.connection_observed",
      attributes: {
        connectionRef: "mqtt-cloud",
        protocol: "mqtt",
        tlsActive: false,
        evidenceBasis: "runtime_socket",
      },
    };
    expect(ownedEnvelope.safeParse(e).success).toBe(true);
    expect(envelope.safeParse(e).success).toBe(false);
  });
  it("enforces body, batch, event, encoding and NDJSON bounds before normal processing", () => {
    expect(() => parseBatch(Buffer.alloc(1048577))).toThrow("batch_too_large");
    expect(() =>
      parseBatch(
        Buffer.from(JSON.stringify({ events: Array(101).fill(base) })),
      ),
    ).toThrow("invalid_batch");
    expect(() =>
      parseBatch(
        Buffer.from(
          JSON.stringify({ events: [{ ...base, summary: "x".repeat(9000) }] }),
        ),
      ),
    ).toThrow("event_too_large");
    expect(() => parseBatch(Buffer.from([0xff]))).toThrow("invalid_batch");
    expect(
      parseBatch(
        Buffer.from(
          JSON.stringify(base) +
            "\n" +
            JSON.stringify({ ...base, sourceEventId: "second" }),
        ),
        true,
      ),
    ).toHaveLength(2);
  });
  it("sanitizes account/address/credential text without executing source content", () => {
    const e = envelope.parse({
      ...base,
      summary:
        "password=private-value person@example.test at 10.0.0.2 https://private.invalid <script>",
    });
    expect(e.summary).not.toContain("private-value");
    expect(e.summary).not.toContain("person@example.test");
    expect(e.summary).not.toContain("10.0.0.2");
    expect(e.summary).not.toContain("<script>");
  });
});
