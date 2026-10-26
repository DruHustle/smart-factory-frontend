import { demoAccountsEnabled, isDemoAccount } from "./demo-accounts";

export type AccessIdentity = { email?: string | null; openId: string };
export type DeploymentEnvironment = Record<string, string | undefined>;

/** Existing shared-account deployments retain their stronger private-data guard. */
export function publicDemoDeployment(env: DeploymentEnvironment = process.env): boolean {
  return env.PUBLIC_DEMO_DEPLOYMENT === "true" || demoAccountsEnabled(env);
}

export function sharedDemoIdentity(user: AccessIdentity | null | undefined): boolean {
  return !!user && (isDemoAccount(user.email ?? "") || user.openId.startsWith("demo-"));
}

export function demonstrationOnly(user: AccessIdentity | null | undefined, env: DeploymentEnvironment = process.env): boolean {
  return publicDemoDeployment(env) || sharedDemoIdentity(user);
}

export const DEMONSTRATION_READ_ONLY = "This shared product walkthrough is read-only. Use an individual account on a private installation for operational changes.";

export function operationalWritesAllowed(user: AccessIdentity | null | undefined, env: DeploymentEnvironment = process.env): boolean {
  return !!user && !demonstrationOnly(user, env);
}
