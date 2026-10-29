import { afterEach, describe, expect, it, vi } from "vitest";
import {
  networkSnapshot,
  networkScenarios,
} from "../../shared/network-diagnostics";
import { demoNetwork } from "./demo";
import { networkCollectorAuthorized } from "./http";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

afterEach(() => vi.unstubAllEnvs());
describe("FX and TSN evidence contracts", () => {
  it("offers bounded, explicitly synthetic normal, late, clock-loss and recovered scenarios", () => {
    for (const scenario of networkScenarios) {
      const view = demoNetwork(scenario);
      expect(view.synthetic).toBe(true);
      expect(view.provenance).toBe("authored-simulation");
      expect(networkSnapshot.safeParse(view.snapshots[0]).success).toBe(true);
    }
    expect(
      demoNetwork("late-delivery").snapshots[0].streams[0].deadlineMisses,
    ).toBeGreaterThan(0);
    expect(demoNetwork("recovery").snapshots[0].streams[0].deadlineMisses).toBe(
      0,
    );
    const loss = demoNetwork("clock-loss").snapshots[0];
    expect(
      loss.streams.every(
        (s) =>
          s.latencyEvidence === "unavailable" &&
          s.deadlineMisses === null &&
          s.samples.every((p) => p.latencyUs === null),
      ),
    ).toBe(true);
  });
  it("rejects hardware latency without two distinct, locked clocks in the same domain and grandmaster", () => {
    for (const change of [
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.ports[1].syncState = "unlocked";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.ports[1].timestamping = "software";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.ports[1].clockDomain = 1;
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.ports[1].grandmasterId = "different";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.ports.forEach((port) => {
          port.grandmasterId = "";
        });
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.streams[0].subscriberPortId = s.streams[0].publisherPortId;
      },
    ]) {
      const s = structuredClone(demoNetwork().snapshots[0]);
      change(s);
      expect(networkSnapshot.safeParse(s).success).toBe(false);
    }
  });
  it("rejects unavailable timing assertions, bad identities, out-of-order samples and credential-bearing endpoints", () => {
    const modify = [
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.streams[0].latencyEvidence = "unavailable";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.connections[0].publisher = "missing";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.connections[0].publisherEntity = "other-entity";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.components.push(s.components[0]);
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.streams[0].samples.reverse();
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.streams[0].samples[0].at = "2099-01-01T00:00:00Z";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.streams[0].lost = 99999999;
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.components[0].endpoint = "opc.tcp://user:secret@plc:4840";
      },
      (s: ReturnType<typeof networkSnapshot.parse>) => {
        s.components[0].endpoint = "https://plc/?token=secret";
      },
    ];
    for (const change of modify) {
      const s = structuredClone(demoNetwork().snapshots[0]);
      change(s);
      expect(networkSnapshot.safeParse(s).success).toBe(false);
    }
  });
  it("requires a separately commissioned collector token and constant-length Bearer match", () => {
    const token = "diagnostics-only-" + "x".repeat(32);
    expect(networkCollectorAuthorized(`Bearer ${token}`, token)).toBe(true);
    for (const header of [
      undefined,
      token,
      "Bearer short",
      `Bearer ${token}extra`,
      `Bearer ${token.slice(0, -1)}y`,
    ])
      expect(networkCollectorAuthorized(header, token)).toBe(false);
    expect(networkCollectorAuthorized("Bearer short", "short")).toBe(false);
  });
  it("keeps shared demo reports synthetic and forbids even engineering imports on demo sessions", async () => {
    vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const demo = appRouter.createCaller({
      user: {
        id: 42,
        role: "engineer",
        openId: "demo-engineer",
        email: "tech@dev.local",
      },
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
    const result = await demo.networkDiagnostics.overview({
      scenario: "clock-loss",
    });
    expect(result.synthetic).toBe(true);
    await expect(
      demo.networkDiagnostics.importSnapshot(demoNetwork().snapshots[0]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const viewer = appRouter.createCaller({
      user: {
        id: 42,
        role: "viewer",
        openId: "individual",
        email: "viewer@example.test",
      },
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
    await expect(
      viewer.networkDiagnostics.importSnapshot(demoNetwork().snapshots[0]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
