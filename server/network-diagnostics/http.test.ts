import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { installNetworkDiagnostics } from "./http";
import { demoNetwork } from "./demo";
import { saveNetworkSnapshot } from "./store";
vi.mock("./store", () => ({ saveNetworkSnapshot: vi.fn() }));
let server: Server, base: string;
const token = "collector-auth-test-" + "x".repeat(32);
beforeEach(async () => {
  vi.stubEnv("NETWORK_DIAGNOSTICS_INGESTION_TOKEN", token);
  vi.stubEnv("NETWORK_DIAGNOSTICS_ALLOWED_GATEWAYS", "commissioned-gateway");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  installNetworkDiagnostics(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/internal/network-diagnostics`;
  vi.mocked(saveNetworkSnapshot).mockResolvedValue({
    accepted: true,
    gatewayId: "commissioned-gateway",
    observedAt: new Date().toISOString(),
  });
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const freshReport = () => {
  const r = demoNetwork().snapshots[0],
    delta = Date.now() - Date.parse(r.observedAt);
  r.observedAt = new Date().toISOString();
  r.gatewayId = "commissioned-gateway";
  r.streams.forEach((s) =>
    s.samples.forEach(
      (p) => (p.at = new Date(Date.parse(p.at) + delta).toISOString()),
    ),
  );
  return r;
};
const post = (
  body: unknown,
  authorization: string | null = `Bearer ${token}`,
) =>
  fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
it("authenticates before parsing, restricts gateway scope, and requires fresh valid reports", async () => {
  expect((await post({}, null)).status).toBe(401);
  expect((await post({})).status).toBe(400);
  expect(
    (await post({ ...freshReport(), gatewayId: "unapproved" })).status,
  ).toBe(403);
  expect(
    (
      await post({
        ...freshReport(),
        observedAt: "2000-01-01T00:00:00Z",
        streams: [],
      })
    ).status,
  ).toBe(422);
  expect(saveNetworkSnapshot).not.toHaveBeenCalled();
  vi.stubEnv("NETWORK_DIAGNOSTICS_ALLOWED_GATEWAYS", "");
  expect((await post(freshReport())).status).toBe(503);
});
it("records authenticated collector provenance and handles replay/storage errors without leaking details", async () => {
  const r = freshReport();
  r.source = "operator-import";
  expect((await post(r)).status).toBe(202);
  expect(saveNetworkSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      source: "collector",
      gatewayId: "commissioned-gateway",
    }),
    null,
  );
  vi.mocked(saveNetworkSnapshot).mockRejectedValue({
    code: "CONFLICT",
    message: "private database details",
  });
  const response = await post(freshReport());
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("private database details");
});
