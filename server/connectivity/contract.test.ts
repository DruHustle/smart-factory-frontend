import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach, vi } from "vitest";
import {
  industrialConfigurationSchema,
  industrialConnectionSchema,
  connectivityObservationSchema,
} from "../../shared/industrial-connectivity";
import { demoConnectivity } from "./demo";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/connectivity/industrial-v1.json", import.meta.url),
    "utf8",
  ),
);
afterEach(() => vi.unstubAllEnvs());
describe("Industrial connectivity wire boundaries", () => {
  it("accepts the independently maintained .NET/edge wire fixture, including exact 64-bit values", () => {
    expect(
      industrialConfigurationSchema.parse(fixture.configuration).connections,
    ).toHaveLength(6);
    expect(
      connectivityObservationSchema.parse(fixture.observation).tags[2].value,
    ).toBe("18446744073709551615");
  });
  it("keeps two pressure tags independent and rejects duplicate identities", () => {
    const c = structuredClone(fixture.configuration.connections[0]);
    c.tags[1] = {
      ...c.tags[0],
      tagId: "inlet-pressure",
      name: "Inlet pressure",
      source: { nodeId: "s=InletPressure", namespaceUri: "urn:fixture:line1" },
    };
    expect(industrialConnectionSchema.safeParse(c).success).toBe(true);
    c.tags[1].tagId = c.tags[0].tagId;
    expect(industrialConnectionSchema.safeParse(c).success).toBe(false);
  });
  it("uses the same OPC UA node identity forms as the gateway", () => {
    const c = structuredClone(fixture.configuration.connections[0]);
    for (const source of [
      { nodeId: "ns=2;s=Pressure", namespaceUri: "urn:fixture:line1" },
      { nodeId: "Pressure", namespaceUri: "urn:fixture:line1" },
      { nodeId: "ns=two;s=Pressure" },
      { nodeId: "i=-1" },
    ]) {
      c.tags[0].source = source;
      expect(industrialConnectionSchema.safeParse(c).success).toBe(false);
    }
    for (const source of [
      { nodeId: "s=Pressure", namespaceUri: "urn:fixture:line1" },
      { nodeId: "ns=2;s=Pressure" },
      { nodeId: "i=42" },
      { nodeId: "ns=2;s=" + "x".repeat(505) },
      { nodeId: "s=" + "x".repeat(510), namespaceUri: "urn:fixture:line1" },
    ]) {
      c.tags[0].source = source;
      expect(industrialConnectionSchema.safeParse(c).success).toBe(true);
    }
  });
  it.each([
    [
      "embedded credentials",
      (c: any) => {
        c.endpoint = "opc.tcp://user:secret@plc:4840";
      },
    ],
    [
      "unknown write action",
      (c: any) => {
        c.write = true;
      },
    ],
    [
      "reserved identity",
      (c: any) => {
        c.connectionId = "gateway-configuration";
      },
    ],
    [
      "wrong protocol address",
      (c: any) => {
        c.tags[0].source = { topic: "plant/temperature", path: "/value" };
      },
    ],
    [
      "simulation without identity",
      (c: any) => {
        c.mode = "simulated";
      },
    ],
    [
      "FX claim on ordinary OPC UA",
      (c: any) => {
        c.fx = { mode: "diagnostics" };
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const c = structuredClone(fixture.configuration.connections[0]);
    mutate(c);
    expect(industrialConnectionSchema.safeParse(c).success).toBe(false);
  });
  it("rejects serial path traversal, duplicate settings, wrong widths and unsafe 64-bit scaling", () => {
    const serial = fixture.configuration.connections[2];
    for (const endpoint of [
      "serial:///dev/../../etc/passwd",
      "serial:///dev/ttyUSB0?baudrate=9600&baudrate=115200",
      "serial:///dev/ttyUSB0?command=reset",
    ])
      expect(
        industrialConnectionSchema.safeParse({ ...serial, endpoint }).success,
      ).toBe(false);
    const meter = structuredClone(fixture.configuration.connections[1]);
    meter.tags[0].source.count = 2;
    expect(industrialConnectionSchema.safeParse(meter).success).toBe(false);
    meter.tags[0].source.count = 4;
    meter.tags[0].scale = 0.1;
    expect(industrialConnectionSchema.safeParse(meter).success).toBe(false);
  });
  it("requires explicit unsecured UADP observation and never accepts a determinism claim", () => {
    const c = structuredClone(fixture.configuration.connections[5]);
    expect(
      industrialConnectionSchema.safeParse({ ...c, tags: [] }).success,
    ).toBe(false);
    const gap = structuredClone(c);
    gap.tags[0].source.fieldIndex = 4;
    expect(industrialConnectionSchema.safeParse(gap).success).toBe(false);
    delete c.fx.allowUnsecured;
    expect(industrialConnectionSchema.safeParse(c).success).toBe(false);
    const report = structuredClone(fixture.observation);
    report.tsn.determinism = "verified";
    expect(connectivityObservationSchema.safeParse(report).success).toBe(false);
    report.tsn.determinism = "unverified";
    report.fx.mode = "udp_uadp";
    expect(connectivityObservationSchema.safeParse(report).success).toBe(false);
  });
  it("accepts an empty configuration receipt and refuses observations disguised as receipts", () => {
    const receipt = {
      schemaVersion: "industrial-observation/v1",
      connectionId: "gateway-configuration",
      configurationRevision: 1,
      eventId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      state: "waiting",
      tags: [],
    };
    expect(connectivityObservationSchema.safeParse(receipt).success).toBe(true);
    expect(
      connectivityObservationSchema.safeParse({
        ...receipt,
        discoveredTags: [],
      }).success,
    ).toBe(false);
    expect(
      connectivityObservationSchema.safeParse({
        ...receipt,
        state: "connected",
      }).success,
    ).toBe(false);
  });
  it("does not accept precision loss, mismatched boolean types, or good null readings", () => {
    for (const tag of [
      {
        tagId: "counter",
        dataType: "uint64",
        value: 18446744073709551615,
        quality: "good",
      },
      {
        tagId: "counter",
        dataType: "uint64",
        value: "18446744073709551616",
        quality: "good",
      },
      { tagId: "state", dataType: "boolean", value: 1, quality: "good" },
      { tagId: "state", dataType: "boolean", value: null, quality: "good" },
    ])
      expect(
        connectivityObservationSchema.safeParse({
          ...fixture.observation,
          tags: [tag],
        }).success,
      ).toBe(false);
  });
  it("keeps authored demo evidence read-only and prevents querying real gateway configuration", async () => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
    const caller = appRouter.createCaller({
      user: {
        id: 71,
        role: "engineer",
        openId: "demo-engineer",
        email: "tech@dev.local",
      },
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
    const gateways = await caller.connectivity.gateways();
    const view = await caller.connectivity.get({
      gatewayDeviceId: gateways[0].gatewayDeviceId,
    });
    expect(view.synthetic).toBe(true);
    expect(view.canConfigure).toBe(false);
    expect(
      view.configuration?.connections.every((c) => c.mode === "simulated"),
    ).toBe(true);
    await expect(
      caller.connectivity.get({ gatewayDeviceId: "operational-gateway" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.connectivity.save({
        gatewayDeviceId: gateways[0].gatewayDeviceId,
        expectedRevision: 0,
        connections: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      demoConnectivity().observations.every(
        (o) => connectivityObservationSchema.safeParse(o).success,
      ),
    ).toBe(true);
  });
});
