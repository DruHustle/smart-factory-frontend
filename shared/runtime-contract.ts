/** Wire capabilities are deliberately independent of a UI commit or readiness probe. */
export const runtimeContractVersion = 2;
export const requiredCapabilities = [
  "isolated-demo-v1",
  "persisted-session-v1",
  "scoped-evidence-v1",
  "canonical-units-v1",
  "verified-transport-v1",
  "encoded-topic-v1",
  "commissioned-routes-v1",
  "complete-reports-v1",
  "published-passports-v1",
  "inventory-v1",
  "native-equipment-v1",
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
