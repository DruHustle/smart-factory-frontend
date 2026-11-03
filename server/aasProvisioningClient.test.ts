import { afterEach, describe, expect, it, vi } from "vitest";
import { importAasxPackage, provisionAas, publishAda031Control, publishEdgeConfiguration, publishWroverIndicator } from "./aasProvisioningClient";

const asset = {
  assetId: "urn:test:asset:01",
  name: "Compressor 01",
  assetType: "compressor",
  manufacturer: "Example Works",
  model: "CX-1",
  manufacturerStreet: "Industrial Road 1",
  manufacturerZipcode: "10115",
  manufacturerCityTown: "Berlin",
  manufacturerNationalCode: "DE",
  manufacturerArticleNumber: "CX-1-ART",
  orderCodeOfManufacturer: "CX-1-ORDER",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AAS provisioning client", () => {
  it("publishes a bounded WROVER pulse without claiming physical confirmation", async () => {
    vi.stubEnv(
      "AAS_PROVISIONING_API_URL",
      "http://device-service:8080/api/assets",
    );
    vi.stubEnv(
      "AAS_PROVISIONING_TOKEN",
      "fixture-provisioning-token-at-least-32-bytes",
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ published: true }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await publishWroverIndicator(
      {
        gatewayDeviceId: "pi-edge-01",
        targetDeviceId: "esp32-wrover-01",
        commandId: "command-123",
        expiresAt: Date.now() + 10000,
      },
      "signed-operator-session-token-long-enough",
    );
    expect(result).toMatchObject({
      published: true,
      physicalStateConfirmed: false,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.pathname).toBe("/api/assets/gpio-control");
    expect(JSON.parse(String(init.body))).toMatchObject({
      targetDeviceId: "esp32-wrover-01",
      pin: 18,
      value: 1,
      holdMs: 2000,
    });
  });
  it("keeps local development usable when the private provisioner is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "");

    const result = await provisionAas(asset);

    expect(result.remote).toBe(false);
    expect(result.documents.shell.modelType).toBe("AssetAdministrationShell");
    expect(result.documents.submodels).toHaveLength(4);
  });

  it("sends asset identity to the private .NET provisioner with its service-only token", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "http://device-service:8080/api/assets");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "a-separate-provisioning-secret-long-enough");
    const documents = { shell: { modelType: "AssetAdministrationShell", id: asset.assetId }, submodels: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(documents), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionAas(asset);

    expect(result).toEqual({ documents, remote: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://device-service:8080/api/assets/");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-aas-provisioning-token")).toBe("a-separate-provisioning-secret-long-enough");
    expect(JSON.parse(String(init.body))).toMatchObject({ assetId: asset.assetId, manufacturer: asset.manufacturer });
  });

  it("fails closed in production when provisioning is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "");

    await expect(provisionAas(asset)).rejects.toThrow(/AAS provisioning is not configured/);
  });

  it("forwards the original multipart body to the AASX route", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "http://device-service:8080/api/assets");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "a-separate-provisioning-secret-long-enough");
    const result = { packageId: "pkg-1", assetAdministrationShells: [{ id: "urn:test:a" }], submodels: [], conceptDescriptions: [] };
    const body = Buffer.from("--boundary\r\nfixture\r\n--boundary--");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(importAasxPackage(body, "multipart/form-data; boundary=boundary")).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://device-service:8080/api/assets/import");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).get("x-aas-provisioning-token")).toBe("a-separate-provisioning-secret-long-enough");
  });

  it("publishes the complete edge desired-state profile to DeviceService", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "http://device-service:8080/api/assets");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "a-separate-provisioning-secret-long-enough");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ published: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const profile = { schemaVersion: 1 as const, gatewayDeviceId: "pi-edge-01", assets: [] };

    await expect(publishEdgeConfiguration(profile)).resolves.toEqual({ published: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://device-service:8080/api/assets/sync");
    expect(JSON.parse(String(init.body))).toEqual(profile);
  });

  it("forwards ADA031 motion only with an engineer bearer token and as an expiring command", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "http://device-service:8080/api/assets");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "a-separate-provisioning-secret-long-enough");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ published: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const expiresAt = Date.now() + 5000;

    await expect(publishAda031Control({
      gatewayDeviceId: "pi-edge-01", assetId: "urn:test:arm", action: "jog", joint: "base", direction: "increase",
      commandId: "command-0001", expiresAt,
    }, "signed-engineer-session-token-long-enough")).resolves.toMatchObject({ published: true, physicalMotionConfirmed: false });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://device-service:8080/api/assets/control");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer signed-engineer-session-token-long-enough");
    expect(new Headers(init.headers).has("x-aas-provisioning-token")).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({ schemaVersion: 2, assetId: "urn:test:arm", action: "jog", joint: "base", direction: "increase", commandId: "command-0001", expiresAt });
  });

  it("publishes a bounded ADA031 operation profile", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AAS_PROVISIONING_API_URL", "http://device-service:8080/api/assets");
    vi.stubEnv("AAS_PROVISIONING_TOKEN", "a-separate-provisioning-secret-long-enough");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ published: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await publishAda031Control({ gatewayDeviceId: "pi-edge-01", assetId: "urn:test:arm", action: "set_profile", profile: "pick_and_place_repeat", commandId: "command-2", expiresAt: Date.now() + 5000 }, "signed-engineer-session-token-long-enough");
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "set_profile", profile: "pick_and_place_repeat" });
  });
});
