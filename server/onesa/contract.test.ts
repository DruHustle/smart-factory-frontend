import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  batchSchema,
  CONTRACT,
  registrationSchema,
  mappingSchema,
  metricSchema,
  bindingSchema,
} from "./contract";
import { normalize, freshness } from "./normalize";
import { integrationConfig } from "./config";
import { classify, retryDelay } from "./worker";
import { appRouter } from "../routers";
const regs = JSON.parse(
  readFileSync("fixtures/equipment/equipment.json", "utf8"),
).map((r: unknown) => registrationSchema.parse(r));
const mappings = JSON.parse(
  readFileSync("fixtures/equipment/mappings.json", "utf8"),
).map((r: unknown) => mappingSchema.parse(r));
export const scope = {
  installationId: "53ded05b-c1aa-4faa-aa65-4747637baac0",
  workspaceId: "proposed-test-workspace",
};
export function sample(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: regs[0].deviceId,
    assetId: regs[0].externalAssetId,
    timestamp: Date.parse("2026-10-20T09:00:00Z"),
    temperature: 45,
    pressure: 2,
    vibration: 1,
    rpm: 1450,
    ingestionId: "a".repeat(64),
    integration: {
      mode: "simulated",
      scenarioRunId: "scenario-01",
      sourceQuality: "good",
      sourceConnection: "online",
      gatewayReceivedAt: "2026-10-20T09:00:00Z",
    },
    ...overrides,
  };
}
describe("proposed producer contract and semantics", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("pins generated schema content and provenance without independent copies", () => {
    const lock = JSON.parse(
      readFileSync("contracts/onesa/contract.lock.json", "utf8"),
    );
    expect(lock.schema).toBe(CONTRACT);
    expect(lock.status).toBe("proposed");
    for (const [p, digest] of Object.entries(lock.hashes))
      expect(createHash("sha256").update(readFileSync(p)).digest("hex")).toBe(
        digest,
      );
    expect(
      JSON.parse(readFileSync("contracts/onesa/batch.schema.json", "utf8")),
    ).toEqual({ ...z.toJSONSchema(batchSchema), $id: CONTRACT });
  });
  it("keeps instance and type identity separate with unique component IDs", () => {
    expect(regs[0].assetTypeId).toBe(regs[1].assetTypeId);
    expect(regs[0].equipmentId).not.toBe(regs[1].equipmentId);
    expect(
      new Set(
        regs.flatMap((r: (typeof regs)[0]) =>
          r.components.map((c) => c.componentId),
        ),
      ).size,
    ).toBe(6);
  });
  it("preserves identity across rename and mapping revision", () => {
    const a = normalize(sample(), regs[0], mappings[0], scope, 2);
    const b = normalize(
      sample(),
      { ...regs[0], name: "Renamed" },
      mappings[0],
      scope,
      3,
    );
    expect(a.map((e) => e.eventId)).toEqual(b.map((e) => e.eventId));
    expect(a[0].observedAt).toBe(b[0].observedAt);
  });
  it("validates explicit UTC and finite values", () => {
    expect(() =>
      normalize(sample({ temperature: NaN }), regs[0], mappings[0], scope, 2),
    ).toThrow();
    const s = sample();
    (s.integration as Record<string, unknown>).gatewayReceivedAt =
      "2026-10-20T09:00:00";
    expect(() => normalize(s, regs[0], mappings[0], scope, 2)).toThrow();
  });
  it("does not substitute zero for missing data or accept unclassified simulations", () => {
    expect(
      normalize(
        sample({ temperature: null }),
        regs[0],
        mappings[0],
        scope,
        2,
      ).some((e) => e.metric?.meaning === "temperature"),
    ).toBe(false);
    expect(() =>
      normalize(
        sample({ integration: undefined }),
        regs[0],
        mappings[0],
        scope,
        2,
      ),
    ).toThrow();
  });
  it("rejects velocity/acceleration and signal meaning mismatches", () => {
    expect(
      metricSchema.safeParse({
        ...regs[0].bindings[3].metric,
        meaning: "vibration_acceleration",
      }).success,
    ).toBe(false);
    expect(
      bindingSchema.safeParse({ ...regs[0].bindings[0], sourceUnit: "mm/s" })
        .success,
    ).toBe(false);
    expect(
      bindingSchema.safeParse({
        ...regs[0].bindings[0],
        sourceKey: "temperature",
      }).success,
    ).toBe(false);
  });
  it("uses actual preserved acquisition units instead of an assumed binding label", () => {
    const r = structuredClone(regs[0]);
    r.bindings[0].sourceUnit = "Pa";
    const measured = sample({
      pressure: 200,
      measurements: {
        pressure: {
          sourceValue: 200,
          sourceUnit: "kPa",
          canonicalValue: 200000,
          canonicalUnit: "Pa",
          quality: "good",
          conversionVersion: "sf-units-v1",
        },
      },
    });
    const event = normalize(measured, r, mappings[0], scope, 2).find(
      (e) => e.metric?.meaning === "pressure",
    )!;
    expect(event.value).toBeCloseTo(2);
    expect(event.provenance).toMatchObject({
      rawValue: 200,
      rawUnit: "kPa",
      conversion: { factor: 0.01, offset: 0 },
    });
  });
  it("records compatible conversion rules without aggregating", () => {
    const r = structuredClone(regs[0]);
    r.bindings[0].sourceUnit = "Pa";
    const e = normalize(
      sample({ pressure: 200000 }),
      r,
      mappings[0],
      scope,
      2,
    ).find((e) => e.metric?.meaning === "pressure")!;
    expect(e.value).toBeCloseTo(2);
    expect(e.provenance?.rawValue).toBe(200000);
    expect(e.provenance?.conversion?.factor).toBe(0.00001);
    expect(e.provenance?.aggregation).toBeNull();
  });
  it("keeps retained observation time and source quality separate from freshness", () => {
    const s = sample();
    s.integration = { ...s.integration, mode: "live", retained: true };
    const e = normalize(s, regs[0], mappings[0], scope, 2)[0];
    expect(freshness(e, Date.parse(e.observedAt) + 10000)).toBe("stale");
    expect(e.sourceQuality).toBe("good");
    expect(e.provenance?.retained).toBe(true);
  });
  it("rejects future clock skew and marks delayed acquisition", () => {
    const s = sample({ timestamp: Date.parse("2026-10-20T09:10:00Z") });
    expect(() => normalize(s, regs[0], mappings[0], scope, 2)).toThrow();
    const late = sample();
    late.integration = {
      ...late.integration,
      gatewayReceivedAt: "2026-10-20T09:05:00Z",
    };
    expect(normalize(late, regs[0], mappings[0], scope, 2)[0].clockSkew).toBe(
      "delayed",
    );
  });
  it("exposes disconnected state without a fabricated reading", () => {
    const s = sample({
      temperature: null,
      pressure: null,
      rpm: null,
      vibration: null,
    });
    s.integration = { ...s.integration, sourceConnection: "offline" };
    const e = normalize(s, regs[0], mappings[0], scope, 2)[0];
    expect(e.kind).toBe("source_connection");
    expect(e.value).toBeNull();
    expect(freshness(e)).toBe("disconnected");
  });
  it("requires explicit mapped identities and rejects ambiguous components", () => {
    expect(() =>
      normalize(sample(), regs[0], { ...mappings[0], targets: [] }, scope, 2),
    ).toThrow();
    expect(
      mappingSchema.safeParse({
        ...mappings[0],
        targets: [mappings[0].targets[0], mappings[0].targets[0]],
      }).success,
    ).toBe(false);
  });
  it("rejects a different workspace or schema version", () => {
    const items = normalize(sample(), regs[0], mappings[0], scope, 2);
    expect(
      batchSchema.safeParse({ schema: CONTRACT, ...scope, items }).success,
    ).toBe(true);
    expect(
      batchSchema.safeParse({ schema: "v9", ...scope, items }).success,
    ).toBe(false);
    expect(
      batchSchema.safeParse({
        schema: CONTRACT,
        ...scope,
        workspaceId: "another",
        items,
      }).success,
    ).toBe(false);
  });
  it("rejects event feedback from a derived Onesa event", () => {
    const s = sample();
    s.integration = {
      ...s.integration,
      sourceEvents: [
        {
          id: "incident",
          origin: "onesa",
          code: "hot",
          state: "active",
          componentId: regs[0].components[1].componentId,
        },
      ],
    };
    expect(() => normalize(s, regs[0], mappings[0], scope, 2)).toThrow();
  });
  it("classifies credentials/permanent/transient errors and bounds Retry-After", () => {
    expect(classify(401)).toBe("credentials");
    expect(classify(422)).toBe("permanent");
    expect(classify(429)).toBe("transient");
    expect(classify(503)).toBe("transient");
    expect(retryDelay(1, "120", 0, () => 0)).toBe(120000);
    expect(retryDelay(50, "999999", 0, () => 0)).toBe(3600000);
    expect(retryDelay(1, "Thu, 01 Jan 1970 00:00:05 GMT", 0, () => 0)).toBe(
      5000,
    );
  });
  it("requires explicit approved destination and contract; demo deployments fail closed", () => {
    const env = {
      ONESA_ENABLED: "true",
      ONESA_INSTALLATION_ID: scope.installationId,
      ONESA_WORKSPACE_ID: scope.workspaceId,
      ONESA_CONTRACT_ID: CONTRACT,
      ONESA_INGESTION_URL: "https://receiver.test/proposed/v1/batches",
      ONESA_APPROVED_ORIGIN: "https://receiver.test",
      ONESA_SERVICE_TOKEN: "synthetic-test-only-service-token",
    };
    expect(integrationConfig(env)?.workspaceId).toBe(scope.workspaceId);
    expect(() =>
      integrationConfig({
        ...env,
        ONESA_APPROVED_ORIGIN: "https://other.test",
      }),
    ).toThrow();
    expect(() =>
      integrationConfig({ ...env, ENABLE_DEMO_ACCOUNTS: "true" }),
    ).toThrow();
    expect(() =>
      integrationConfig({
        ...env,
        ONESA_INGESTION_URL: "https://receiver.test/path?token=x",
      }),
    ).toThrow();
  });
  it("protects private settings from ordinary users and shared demo engineering identities", async () => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
    vi.stubEnv("ONESA_ENABLED", "false");
    const ctx = (
      role: string,
      email = "individual@example.test",
      openId = "individual",
    ) => ({ user: { id: 5, role, email, openId }, req: {}, res: {} }) as any;
    await expect(
      appRouter.createCaller(ctx("operator")).onesa.status(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(ctx("admin", "admin@dev.local")).onesa.status(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(ctx("engineer")).onesa.retry(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(ctx("engineer")).onesa.status(),
    ).resolves.toMatchObject({ state: "Disabled" });
  });
});
