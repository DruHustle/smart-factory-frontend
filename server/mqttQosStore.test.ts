import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  execute: vi.fn(), transaction: vi.fn(), device: vi.fn(), reading: vi.fn(), publish: vi.fn(), demo: vi.fn(),
}));
vi.mock("./db", () => ({
  getDb: async () => ({ execute: mock.execute, transaction: mock.transaction }),
  getDeviceById: mock.device, getLatestReading: mock.reading,
}));
vi.mock("./demoData", () => ({ demoOnlyRead: mock.demo }));
vi.mock("./aasProvisioningClient", () => ({ publishWroverQos: mock.publish }));
import { requestWroverQos } from "./mqttQosStore";

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
    expect(mock.execute).toHaveBeenCalledTimes(4);
  });
});
