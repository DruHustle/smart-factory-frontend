import type { AssetIdentity } from "./aasModel";
import { buildAasDocuments } from "./aasModel";

export type ProvisionedAas = ReturnType<typeof buildAasDocuments>;

function getProvisioningUrl() {
  const configuredUrl = process.env.AAS_PROVISIONING_API_URL;
  if (!configuredUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AAS provisioning is not configured. Set AAS_PROVISIONING_API_URL and AAS_PROVISIONING_TOKEN.");
    }
    return undefined;
  }

  const url = new URL(configuredUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("AAS_PROVISIONING_API_URL must be an HTTP(S) endpoint without credentials, query, or fragment");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" &&
      !(process.env.BACKEND_DEPLOYMENT_MODE === "render-bundle" && url.hostname === "127.0.0.1" && url.port === "3102")) {
    throw new Error("AAS_PROVISIONING_API_URL requires HTTPS, or the exact private Render bundle loopback endpoint");
  }
  const token = process.env.AAS_PROVISIONING_TOKEN;
  if (!token || Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("AAS_PROVISIONING_TOKEN must contain at least 32 bytes");
  }
  // Treat the configured value as the common /api/assets route so the JSON
  // and multipart workflows share one private service boundary.
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

async function publishConnectivityRequest(path: string, body: unknown) {
  const base = getProvisioningUrl();
  if (!base) return { published: false as const, reason: "provisioner_not_configured" as const };
  const response = await fetch(new URL(path, base), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-aas-provisioning-token": process.env.AAS_PROVISIONING_TOKEN! },
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Connectivity request was rejected (HTTP ${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("published" in result) || result.published !== true) throw new Error("DeviceService did not confirm connectivity publication");
  return { published: true as const };
}
export function publishIndustrialConfiguration(configuration: import("../shared/industrial-connectivity").IndustrialConfiguration) {
  return publishConnectivityRequest("connectivity/sync", configuration);
}
export function publishConnectivityProbe(input: { gatewayDeviceId: string; commandId: string; expiresAt: number; connection: import("../shared/industrial-connectivity").IndustrialConnection }) {
  return publishConnectivityRequest("connectivity/probe", input);
}

async function requestProvisioner(url: URL, method: "POST" | "PUT" | "DELETE", asset: AssetIdentity) {
  const token = process.env.AAS_PROVISIONING_TOKEN!;
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-aas-provisioning-token": token,
    },
    body: JSON.stringify(asset),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    if (response.status === 409) throw new Error("AAS version conflict: reload the asset before editing");
    const detail = response.status >= 500 ? "AAS repository or registry could not complete the request" : "Provisioning request was rejected";
    throw new Error(`${detail} (HTTP ${response.status})`);
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("shell" in result) || !result.shell || !("submodels" in result) || !Array.isArray(result.submodels)) {
    throw new Error("The AAS provisioner returned an invalid response");
  }
  return result as ProvisionedAas;
}

/** Generate AAS JSON in .NET and register it with the private repository/registry. */
export async function provisionAas(asset: AssetIdentity): Promise<{ documents: ProvisionedAas; remote: boolean }> {
  const url = getProvisioningUrl();
  if (!url) return { documents: buildAasDocuments(asset), remote: false };
  return { documents: await requestProvisioner(url, "POST", asset), remote: true };
}

/** Refresh repository documents after engineering data changes. */
export async function updateProvisionedAas(asset: AssetIdentity): Promise<ProvisionedAas> {
  const url = getProvisioningUrl();
  if (!url) return buildAasDocuments(asset);
  return requestProvisioner(url, "PUT", asset);
}

/** Compensate for an application database failure after remote provisioning. */
export async function removeProvisionedAas(asset: AssetIdentity) {
  const url = getProvisioningUrl();
  if (!url) return;
  await requestProvisioner(url, "DELETE", asset);
}

export type AasxImportResult = {
  packageId: string;
  assetAdministrationShells: Array<Record<string, unknown>>;
  submodels: Array<Record<string, unknown>>;
  conceptDescriptions: Array<Record<string, unknown>>;
};

export class AasProvisioningRequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "AasProvisioningRequestError";
  }
}

/** Forward the original multipart stream body to the private .NET AASX importer. */
export async function importAasxPackage(body: Buffer, contentType: string): Promise<AasxImportResult> {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) throw new Error("AASX import requires the private .NET AAS provisioner");
  const target = new URL("import", baseUrl);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": contentType,
      accept: "application/json",
      "x-aas-provisioning-token": process.env.AAS_PROVISIONING_TOKEN!,
    },
    body: body as unknown as BodyInit,
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    if ([400, 413, 415, 422].includes(response.status)) {
      throw new AasProvisioningRequestError("AASX package was rejected by the package validator", 422);
    }
    throw new Error(`AASX repository import failed (HTTP ${response.status})`);
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new Error("The AASX importer returned an invalid response");
  const candidate = result as Partial<AasxImportResult>;
  if (typeof candidate.packageId !== "string" || !candidate.packageId ||
      !Array.isArray(candidate.assetAdministrationShells) || candidate.assetAdministrationShells.length === 0 ||
      !Array.isArray(candidate.submodels) || !Array.isArray(candidate.conceptDescriptions)) {
    throw new Error("The AASX importer returned an invalid AAS environment");
  }
  return candidate as AasxImportResult;
}

/** Remove records created by an import if the dashboard database transaction fails. */
export async function rollbackAasxImport(result: AasxImportResult) {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) return;
  const response = await fetch(new URL("import", baseUrl), {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-aas-provisioning-token": process.env.AAS_PROVISIONING_TOKEN!,
    },
    body: JSON.stringify({
      packageId: result.packageId,
      assetIds: result.assetAdministrationShells.map((shell) => shell.id).filter((id): id is string => typeof id === "string"),
      submodelIds: result.submodels.map((model) => model.id).filter((id): id is string => typeof id === "string"),
      conceptDescriptionIds: result.conceptDescriptions.map((concept) => concept.id).filter((id): id is string => typeof id === "string"),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AASX rollback failed (HTTP ${response.status})`);
}

/** Remove the exact BaSyx resources represented by one persisted AASX asset. */
export async function removeImportedAasxAsset(asset: {
  assetId: string;
  aasxPackageId: string | null;
  aasSubmodels: Array<Record<string, unknown>>;
  aasConceptDescriptions: Array<Record<string, unknown>>;
}) {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) throw new Error("Imported AASX deletion requires the private .NET AAS provisioner");
  if (!asset.aasxPackageId) throw new Error("Imported AASX package receipt is missing");
  const response = await fetch(new URL("import", baseUrl), {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-aas-provisioning-token": process.env.AAS_PROVISIONING_TOKEN! },
    body: JSON.stringify({
      packageId: asset.aasxPackageId,
      assetIds: [asset.assetId],
      submodelIds: asset.aasSubmodels.map((item) => item.id).filter((id): id is string => typeof id === "string"),
      conceptDescriptionIds: asset.aasConceptDescriptions.map((item) => item.id).filter((id): id is string => typeof id === "string"),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AASX deletion failed (HTTP ${response.status})`);
}

export type EdgeConfiguration = {
  schemaVersion: 1;
  gatewayDeviceId: string;
  assets: Array<{ assetId: string; assetName: string; protocol: string; endpoint: string | null; tagMappings: Array<Record<string, unknown>> }>;
};

/** Ask DeviceService to publish the current, server-validated gateway profile over MQTT. */
export async function publishEdgeConfiguration(configuration: EdgeConfiguration) {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) return { published: false, reason: "provisioner_not_configured" as const };
  const target = new URL("sync", baseUrl);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-aas-provisioning-token": process.env.AAS_PROVISIONING_TOKEN!,
    },
    body: JSON.stringify(configuration),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Edge configuration publish failed (HTTP ${response.status})`);
  const result = await response.json() as { published?: boolean };
  if (result.published !== true) throw new Error("DeviceService did not confirm MQTT publication");
  return { published: true as const };
}

export type Ada031Command =
  | { action: "jog"; joint: "base" | "shoulder" | "elbow" | "wrist_rotation" | "gripper"; direction: "increase" | "decrease" }
  | { action: "set_profile"; profile: "pick_and_place_repeat" | "demonstration_moves" }
  | { action: "neutral" }
  | { action: "stop_program" };

/** Forward an engineer-authorized, short-lived ADA031 command using a signed user-role token. */
export async function publishAda031Control(input: {
  gatewayDeviceId: string;
  assetId: string;
  commandId: string;
  expiresAt: number;
} & Ada031Command, userToken: string) {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) throw new Error("ADA031 control requires the private .NET DeviceService");
  if (!userToken || Buffer.byteLength(userToken, "utf8") < 32) throw new Error("Authorized user token is missing");
  const response = await fetch(new URL("control", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ schemaVersion: 2, ...input }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("DeviceService rejected the engineer authorization");
  if (!response.ok) throw new Error(`ADA031 command publication failed (HTTP ${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("published" in result) || result.published !== true) {
    throw new Error("DeviceService returned an invalid ADA031 command acknowledgement");
  }
  return { published: true as const, commandId: input.commandId, physicalMotionConfirmed: false as const };
}

/** Forward an operator-authorized, short-lived WROVER indicator pulse. */
export async function publishWroverIndicator(input: {
  gatewayDeviceId: string;
  targetDeviceId: string;
  commandId: string;
  expiresAt: number;
}, userToken: string) {
  const baseUrl = getProvisioningUrl();
  if (!baseUrl) throw new Error("WROVER indicator control requires the private .NET DeviceService");
  if (!userToken || Buffer.byteLength(userToken, "utf8") < 32) throw new Error("Authorized user token is missing");
  const response = await fetch(new URL("gpio-control", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ schemaVersion: 1, gatewayDeviceId: input.gatewayDeviceId,
      targetDeviceId: input.targetDeviceId, pin: 18, value: 1, holdMs: 2_000,
      commandId: input.commandId, expiresAt: input.expiresAt }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("DeviceService rejected the operator authorization");
  if (!response.ok) throw new Error(`WROVER indicator publication failed (HTTP ${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("published" in result) || result.published !== true) {
    throw new Error("DeviceService returned an invalid WROVER indicator acknowledgement");
  }
  return { published: true as const, commandId: input.commandId, physicalStateConfirmed: false as const };
}
