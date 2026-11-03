import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as store from "./mqttQosStore";
import { installMqttQosAckRoute } from "./mqttQosHttp";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs();
});

describe("QoS receipt service boundary", () => {
  it("requires the service token and verified non-retained evidence", async () => {
    vi.stubEnv("INGESTION_API_TOKEN", "fixture-token-for-testing-only-long-enough");
    const ingest = vi.spyOn(store, "ingestWroverQosAck").mockResolvedValue(true);
    const app = express(); app.use(express.json()); installMqttQosAckRoute(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const body = { action: "configure_mqtt_qos", deviceId: "wrover", gatewayDeviceId: "pi", commandId: "4ce07676-9ed8-4c70-b679-7fea17a82a16", status: "applied", timestamp: Date.now(), revision: 1, requestedRevision: 1, uplinkQos: 2, downlinkQos: 1, transportRetained: false, transportRetainVerified: true };
    const send = (token: string, data: unknown) => fetch(`http://127.0.0.1:${port}/api/internal/mqtt-qos-ack`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
    expect((await send("bad-token", body)).status).toBe(401);
    expect((await send("fixture-token-for-testing-only-long-enough", { ...body, transportRetained: true })).status).toBe(400);
    expect((await send("fixture-token-for-testing-only-long-enough", { ...body, transportRetainVerified: false })).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
    const accepted = await send("fixture-token-for-testing-only-long-enough", body);
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: true });
    expect(ingest).toHaveBeenCalledOnce();
  });
});
