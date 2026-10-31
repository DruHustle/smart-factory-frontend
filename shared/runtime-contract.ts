/** Wire capabilities are deliberately independent of a UI commit or readiness probe. */
export const runtimeContractVersion = 2;
export const requiredCapabilities = [
  "isolated-demo-v1",
  "complete-showcase-v2",
  "assistant-visuals-v1",
  "infrastructure-monitor-v1",
  "persisted-session-v1",
  "scoped-evidence-v1",
  "canonical-units-v1",
  "verified-transport-v1",
  "encoded-topic-v1",
  "commissioned-routes-v1",
  "complete-reports-v1",
  "published-passports-v1",
  "inventory-v1",
  "factory-floor-v1",
  "factory-layouts-v1",
  "named-factories-v1",
  "account-requests-v1",
  "account-role-approval-v1",
  "password-reset-v1",
  "assistant-conversation-v1",
  "demo-sandbox-v1",
  "fx-tsn-diagnostics-v1",
  "native-equipment-v1",
  "raspberry-pi-model-v1",
  "factory-reference-models-v1",
  "native-security-v1",
] as const;
export type RuntimeContract = {
  contractVersion: number;
  source: string | null;
  backendSource: string | null;
  edgeSource: string | null;
  schema: { ready: boolean; revision: string; digest: string };
  capabilities: string[];
  deployment: "standalone" | "bundle";
  versioned: boolean;
  worker?: { fresh: boolean; compatible: boolean } | null;
};
export function runtimeCompatibility(
  value: unknown,
  requireVersioned = false,
): string | null {
  const r = value as Partial<RuntimeContract> | null;
  if (!r || r.contractVersion !== runtimeContractVersion)
    return "The application service requires a compatible software release.";
  if (!r.schema?.ready)
    return "The application service is waiting for its database migration checks.";
  if (
    !Array.isArray(r.capabilities) ||
    requiredCapabilities.some((c) => !r.capabilities!.includes(c))
  )
    return "The application service does not support all required workspace capabilities.";
  if (requireVersioned && !r.versioned)
    return "The application service has no verified source identity.";
  return null;
}

/** Promotion must attest the exact reviewed companion sources, not just readiness. */
export function promotionCompatibility(
  value: unknown,
  expected: { schemaDigest: string; backend: string; edge: string },
): string | null {
  const error = runtimeCompatibility(value, true);
  if (error) return error;
  const contract = value as RuntimeContract;
  if (!contract.source || !/^[a-f0-9]{40}$/.test(contract.source))
    return "The API has no valid immutable source revision.";
  if (
    contract.deployment !== "bundle" ||
    contract.worker?.fresh !== true ||
    contract.worker?.compatible !== true
  )
    return "A compatible current singleton telemetry-worker receipt is required for promotion.";
  if (contract.schema.digest !== expected.schemaDigest)
    return "The API migration manifest differs from the reviewed UI source.";
  if (
    contract.backendSource !== expected.backend ||
    contract.edgeSource !== expected.edge
  )
    return "The API companion sources differ from the qualified release sources.";
  return null;
}

/** A healthy origin can still be serving an older frontend artifact. */
export function releaseIdentityCompatibility(
  value: unknown,
  expectedSource: string,
): string | null {
  const release = value as {
    application?: unknown;
    source?: unknown;
    contractVersion?: unknown;
    requiredCapabilities?: unknown;
    builtAt?: unknown;
  } | null;
  if (
    !/^[a-f0-9]{40}$/.test(expectedSource) ||
    !release ||
    release.application !== "Smart Factory" ||
    release.source !== expectedSource
  )
    return "The deployed frontend does not match the approved release revision.";
  const capabilities = release.requiredCapabilities;
  if (
    release.contractVersion !== runtimeContractVersion ||
    !Array.isArray(capabilities) ||
    requiredCapabilities.some((c) => !capabilities.includes(c)) ||
    typeof release.builtAt !== "string" ||
    !Number.isFinite(Date.parse(release.builtAt))
  )
    return "The deployed frontend release manifest is incomplete or incompatible.";
  return null;
}
