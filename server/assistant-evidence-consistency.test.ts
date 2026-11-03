import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerFactoryQuestion } from "./assistantKnowledge";
import { loadInvestigationEvidence } from "./assistantInvestigation";
import { generateAssistantCompletion } from "./assistantProvider";
import { observationHref } from "../shared/inventory";

const database = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAssets: vi.fn(),
  getDevices: vi.fn(),
  getAlerts: vi.fn(),
  getAssetConnections: vi.fn(),
  getLatestAssetReadings: vi.fn(),
  getAlertStats: vi.fn(),
  getDeviceByDeviceId: vi.fn(),
  getDeviceById: vi.fn(),
  getAlertThresholds: vi.fn(),
}));
vi.mock("./db", () => database);
vi.mock("./assistantProvider", () => ({
  generateAssistantCompletion: vi.fn(async () => ({
    configured: false,
    completion: null,
  })),
}));
vi.mock("./trends", () => ({
  observationTrend: vi.fn(async (input) => ({
    scope: input.scope,
    metric: input.metric,
    startTime: input.startTime,
    endTime: input.endTime,
    intervalMs: input.intervalMs,
    unit: "°C",
    total: 0,
    verified: 0,
    unverified: 0,
    statisticsComplete: true,
    truncated: false,
    buckets: [],
    summary: {
      min: null,
      max: null,
      average: null,
      latest: null,
      latestAt: null,
    },
  })),
}));

const now = Date.parse("2026-11-02T22:15:00Z");
const source = {
  id: 8,
  deviceId: "test-source-8",
  name: "Test source",
  type: "sensor",
  observedStatus: "live",
  lastSeen: new Date(now),
  isDemo: false,
};
const asset = {
  id: 1,
  assetId: "urn:test:pump",
  name: "Test pump",
  assetType: "pump",
  manufacturer: "Test",
  model: "Test",
  location: "Line 1",
  zone: "north",
  lifecycleStage: "operational",
  aasVersion: 1,
  isDemo: false,
};
const reading = () => ({
  id: 12,
  deviceId: source.id,
  assetId: asset.assetId,
  timestamp: now - 1000,
  createdAt: new Date(now - 900),
  temperature: 25,
  integration: {
    mode: "live",
    sourceQuality: "good",
    evidence: {
      eligible: true,
      validForMs: 600_000,
      acquisitionMode: "on_change",
      commissioningRevision: 1,
    },
  },
  sourceContinuity: {
    offline: false,
    interruptedAt: null as number | null,
    commissioningRevision: 1,
  },
  measurements: {
    temperature: {
      sourceValue: 25,
      sourceUnit: "°C",
      canonicalValue: 25,
      canonicalUnit: "°C",
      conversionVersion: "sf-units-v1",
      quality: "good",
    },
  },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("ASSISTANT_INCLUDE_LIVE_CONTEXT", "true");
  vi.stubEnv("ENABLE_DEMO_DATA", "false");
  database.getDb.mockResolvedValue(null);
  database.getAssets.mockResolvedValue([asset]);
  database.getDevices.mockResolvedValue([source]);
  database.getAlerts.mockResolvedValue([]);
  database.getAssetConnections.mockResolvedValue([
    {
      deviceId: source.id,
      protocol: "mqtt",
      gatewayDeviceId: null,
      gatewayName: null,
      lastSeen: new Date(now),
    },
  ]);
  database.getLatestAssetReadings.mockResolvedValue([reading()]);
  database.getAlertStats.mockResolvedValue({
    critical: 0,
    warning: 0,
    activeDowntime: 0,
  });
  database.getDeviceByDeviceId.mockResolvedValue(source);
  database.getDeviceById.mockResolvedValue(source);
  database.getAlertThresholds.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Assistant and Monitoring share observation validity", () => {
  it("answers device count questions with the count of visible devices", async () => {
    const answer = await answerFactoryQuestion(
      "How many devices are visible?",
      {
        selection: { provider: "local" },
      },
    );
    expect(answer.answer).toContain("1 visible device");
    expect(answer.answer).toContain("0 gateways");
  });
  it.each([
    ["cyclic", "current"],
    ["held", "held"],
    ["expired", "stale"],
    ["offline", "unverified"],
    ["interrupted", "unverified"],
    ["recommissioned", "unverified"],
    ["uncommissioned", "unverified"],
    ["unknown-mode", "unverified"],
  ] as const)(
    "preserves %s evidence across context, provider input and visual presentation",
    async (kind, state) => {
      const sample = reading();
      if (kind === "cyclic")
        sample.integration.evidence.acquisitionMode = "cyclic";
      if (kind === "expired") sample.timestamp = now - 600_001;
      if (kind === "offline") sample.sourceContinuity.offline = true;
      if (kind === "interrupted")
        sample.sourceContinuity.interruptedAt = now - 500;
      if (kind === "recommissioned")
        sample.sourceContinuity.commissioningRevision = 2;
      if (kind === "uncommissioned")
        sample.integration.evidence.eligible = false;
      if (kind === "unknown-mode") sample.integration.mode = "unknown";
      database.getLatestAssetReadings.mockResolvedValue([sample]);

      const answer = await answerFactoryQuestion(
        "Show the latest temperature on Test pump",
        {
          selectedAssetId: asset.assetId,
          selection: { provider: "local" },
        },
      );

      expect(answer.presentation?.trend?.latest).toMatchObject({
        freshness: state,
        occurredAt: new Date(sample.timestamp).toISOString(),
        receivedAt: sample.createdAt.toISOString(),
        value: 25,
        unit: "°C",
      });
      const messages = vi.mocked(generateAssistantCompletion).mock.calls[0][0];
      const contextJson = messages
        .find((m) => m.role === "user")!
        .content.split("<smart_factory_context>\n")[1]
        .split("\n</smart_factory_context>")[0];
      const context = JSON.parse(contextJson);
      const observed =
        context.currentState.assets[0].latestObservation.telemetry;
      expect(observed.sourceContinuity).toEqual(sample.sourceContinuity);
      expect(observed.validity.state).toBe(state);
      expect(observed.timestamp).toBe(new Date(sample.timestamp).toISOString());
      expect(context.visualEvidence.latest.freshness).toBe(state);
    },
  );
});

describe("explicit source investigations", () => {
  const input = {
    deviceId: source.id,
    metric: "temperature" as const,
    scope: "operational" as const,
    startTime: now - 3_600_000,
    endTime: now,
  };

  it.each(["gateway", "sensor"])(
    "routes a %s citation to a supported source section and retains the window",
    async (type) => {
      database.getDeviceById.mockResolvedValue({ ...source, type });
      database.getDb.mockResolvedValue({ execute: vi.fn(async () => []) });
      const evidence = await loadInvestigationEvidence(input);
      const url = new URL(evidence.sources[0].href!, "https://example.test");
      expect(url.pathname).toBe(
        observationHref({
          ref: `device:${source.id}`,
          kind: "device",
          itemType: type,
        }),
      );
      expect(url.searchParams.get("metric")).toBe(input.metric);
      expect(url.searchParams.get("scope")).toBe(input.scope);
      expect(Date.parse(url.searchParams.get("from")!)).toBe(input.startTime);
      expect(Date.parse(url.searchParams.get("to")!)).toBe(input.endTime);
    },
  );

  it.each([
    "Show the evidence for this gateway in the selected window and provide a link to its source workspace.",
    "How do I review source freshness?",
    "Show the selected temperature evidence for the selected window.",
  ])(
    "keeps selected evidence ahead of a generic explanation: %s",
    async (question) => {
      database.getDeviceById.mockResolvedValue({
        ...source,
        type: "gateway",
        name: "Selected test gateway",
      });
      database.getDb.mockResolvedValue({ execute: vi.fn(async () => []) });
      const evidence = await loadInvestigationEvidence(input);
      const answer = await answerFactoryQuestion(question, {
        investigationEvidence: evidence,
        selection: { provider: "local" },
      });
      expect(answer.investigation).toMatchObject({
        name: "Selected test gateway",
        deviceId: source.id,
        snapshot: {
          startTime: input.startTime,
          endTime: input.endTime,
          metric: "temperature",
          scope: "operational",
        },
      });
      expect(answer.answer).toContain("Selected test gateway");
      expect(answer.answer).toContain(
        "No good-quality canonical temperature values",
      );
      expect(answer.answer).not.toContain("A gateway connects equipment");
      expect(
        answer.sources.some(
          (s) =>
            s.path === `investigation:device:${source.id}` &&
            s.href?.includes("/connected?"),
        ),
      ).toBe(true);
    },
  );
});
