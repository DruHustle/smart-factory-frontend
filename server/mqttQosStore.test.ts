import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), device: vi.fn(), reading: vi.fn(), publish: vi.fn(), demo: vi.fn(), worker: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: async () => ({ execute: mock.execute, transaction: mock.transaction }),
  getDeviceById: mock.device, getLatestReading: mock.reading,
}));
vi.mock("./demoData", () => ({ demoOnlyRead: mock.demo }));
vi.mock("./operatingEvidence", () => ({ telemetryWorkerReceipt: mock.worker }));
vi.mock("./aasProvisioningClient", () => ({ publishWroverQos: mock.publish }));
import { getWroverQos, ingestGatewayQosRejection, ingestWroverQosAck, requestWroverQos } from "./mqttQosStore";

const input = { id: 7, expectedRevision: 0, uplink: 2 as const, downlink: 0 as const };

describe("WROVER QoS requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.demo.mockReturnValue(false);
    mock.device.mockResolvedValue({ id: 7, isDemo: false, type: "edge_device", deviceId: "wrover", observedStatus: "live", metadata: { gatewayId: "pi" } });
    mock.reading.mockResolvedValue({ timestamp: Date.now(), integration: { sourceQuality: "good" } });
    mock.publish.mockResolvedValue({ published: true });
    mock.execute.mockResolvedValue([]);
    mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: mock.execute }));
  });
  it("saves a revision and publishes without reporting it applied", async () => {
    const result = await requestWroverQos(input, 42, "engineer-token");
    expect(result).toMatchObject({ revision: 1, status: "published", applied: false });
    expect(mock.publish).toHaveBeenCalledWith(expect.objectContaining({ gatewayDeviceId: "pi", targetDeviceId: "wrover", revision: 1, uplinkQos: 2, downlinkQos: 0 }), "engineer-token");
  });
  it("rejects a stale revision before publication", async () => {
    mock.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: { revision: 1, uplink: 1, downlink: 1, commandId: "d7f2cd47-3410-4574-9705-8aa94ec673ad", requestedAt: "2026-11-03T20:00:00.000Z", status: "published" } }]);
    await expect(requestWroverQos(input, 42, "engineer-token")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("blocks demo and unhealthy devices", async () => {
    mock.demo.mockReturnValueOnce(true);
    await expect(requestWroverQos(input, 42, "engineer-token")).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.reading.mockResolvedValueOnce({ timestamp: Date.now(), integration: { acquisition: { sensorStatus: "read_error" } } });
    await expect(requestWroverQos(input, 42, "engineer-token")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("records failure when publication fails", async () => {
    mock.publish.mockRejectedValueOnce(new Error("offline"));
    await expect(requestWroverQos(input, 42, "engineer-token")).rejects.toThrow("offline");
    expect(mock.execute).toHaveBeenCalledTimes(6);
  });
});


describe("WROVER QoS acknowledgement", () => {
  const now = Date.parse("2026-11-03T20:00:30.000Z");
  const state = { revision: 7, uplink: 2, downlink: 0, commandId: "d7f2cd47-3410-4574-9705-8aa94ec673ad", requestedAt: "2026-11-03T20:00:00.000Z", status: "published" };
  const ack = { action: "configure_mqtt_qos", deviceId: "wrover", gatewayDeviceId: "pi", commandId: state.commandId,
    status: "applied", timestamp: now, revision: 7, requestedRevision: 7, uplinkQos: 2, downlinkQos: 0,
    transportRetained: false, transportRetainVerified: true };
  beforeEach(() => {
    vi.clearAllMocks();
    mock.execute.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: state }]).mockResolvedValueOnce([{ value: 7 }]).mockResolvedValue([]);
    mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: mock.execute }));
  });
  it("accepts a fresh matching receipt for the commissioned route", async () => {
    expect(await ingestWroverQosAck(ack, now)).toBe(true);
    expect(mock.execute).toHaveBeenCalledTimes(5);
  });
  it("does not mark a mismatched revision or QoS as applied", async () => {
    expect(await ingestWroverQosAck({ ...ack, uplinkQos: 1 }, now)).toBe(false);
    expect(mock.execute).toHaveBeenCalledTimes(4);
  });
  it("rejects stale and unverified receipts", async () => {
    expect(await ingestWroverQosAck({ ...ack, timestamp: now - 121_000 }, now)).toBe(false);
    await expect(ingestWroverQosAck({ ...ack, transportRetained: true }, now)).rejects.toThrow();
    await expect(ingestWroverQosAck({ ...ack, transportRetainVerified: false }, now)).rejects.toThrow();
    expect(mock.execute).not.toHaveBeenCalled();
  });
});


describe("cloud QoS readiness", () => {
  it("requires both a recent device acknowledgement and a fresh sufficient worker grant", async () => {
    vi.clearAllMocks(); mock.execute.mockReset(); mock.demo.mockReturnValue(false);
    mock.device.mockResolvedValue({ id: 7, isDemo: false, metadata: { gatewayId: "pi" } });
    const state = { revision: 1, uplink: 2, downlink: 1, commandId: "4ce07676-9ed8-4c70-b679-7fea17a82a16", requestedAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), status: "applied" };
    const rows = (value: unknown) => { mock.execute.mockResolvedValueOnce([{ value }]).mockResolvedValueOnce([{ value: 1 }]); };
    rows(state);
    mock.worker.mockResolvedValue({ fresh: true, mqttSubscribed: true, mqttMaxQos: 2 });
    expect(await getWroverQos(7)).toMatchObject({ cloudUplink: "ready" });
    rows(state); mock.worker.mockResolvedValue({ fresh: true, mqttSubscribed: true, mqttMaxQos: 1 });
    expect(await getWroverQos(7)).toMatchObject({ cloudUplink: "unconfirmed" });
    rows(state); mock.worker.mockResolvedValue({ fresh: false, mqttSubscribed: true, mqttMaxQos: 2 });
    expect(await getWroverQos(7)).toMatchObject({ cloudUplink: "unconfirmed" });
    rows({ ...state, acknowledgedAt: new Date(Date.now() - 121_000).toISOString() });
    mock.worker.mockResolvedValue({ fresh: true, mqttSubscribed: true, mqttMaxQos: 2 });
    expect(await getWroverQos(7)).toMatchObject({ cloudUplink: "unconfirmed" });
  });
});


describe("gateway QoS rejection", () => {
  const now = Date.parse("2026-11-03T20:00:30.000Z");
  const state = { revision: 7, uplink: 2, downlink: 0, commandId: "d7f2cd47-3410-4574-9705-8aa94ec673ad", requestedAt: "2026-11-03T20:00:00.000Z", status: "published" };
  const ack = { action: "configure_mqtt_qos", deviceId: "pi", gatewayDeviceId: "pi", targetDeviceId: "wrover", commandId: state.commandId,
    status: "rejected", timestamp: now, revision: 7, reason: "broker did not grant QoS", transportRetained: false, transportRetainVerified: true };
  beforeEach(() => {
    vi.clearAllMocks(); mock.execute.mockReset();
    mock.execute.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ value: state }]).mockResolvedValueOnce([{ value: 7 }]).mockResolvedValue([]);
    mock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: mock.execute }));
  });
  it("marks only the matching gateway's requested revision rejected", async () => {
    expect(await ingestGatewayQosRejection(ack, now)).toBe(true);
    expect(mock.execute).toHaveBeenCalledTimes(5);
  });
  it("does not overwrite newer requests or accept a mismatched gateway", async () => {
    expect(await ingestGatewayQosRejection({ ...ack, revision: 6 }, now)).toBe(false);
    await expect(ingestGatewayQosRejection({ ...ack, gatewayDeviceId: "other" }, now)).rejects.toThrow();
    expect(mock.execute).toHaveBeenCalledTimes(4);
  });
});
