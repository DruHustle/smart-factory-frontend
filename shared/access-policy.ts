import { demoAccountsEnabled, isDemoAccount } from "./demo-accounts";

export type AccessIdentity = { email?: string | null; openId: string };
export type AccountCapabilities = {
  demoOnly: boolean;
  canSwitchData?: boolean;
  workspaceView?: "demo" | "live" | "configured";
  canOperate: boolean;
  canEngineer: boolean;
  canAdminister: boolean;
};
export type DeploymentEnvironment = Record<string, string | undefined>;

/** Deployment flag controls showcase setup and global integration policy. */
export function publicDemoDeployment(
  env: DeploymentEnvironment = process.env,
): boolean {
  return env.PUBLIC_DEMO_DEPLOYMENT === "true" || demoAccountsEnabled(env);
}

export function sharedDemoIdentity(
  user: AccessIdentity | null | undefined,
): boolean {
  return (
    !!user &&
    (isDemoAccount(user.email ?? "") || user.openId.startsWith("demo-"))
  );
}

export function demonstrationOnly(
  user: AccessIdentity | null | undefined,
): boolean {
  // A shared demo identity stays isolated even when individual accounts use
  // the same origin. Anonymous requests never inherit operational visibility.
  return !user || sharedDemoIdentity(user);
}

export const DEMONSTRATION_READ_ONLY =
  "This demonstration view is read-only. Sign in with an approved individual account and select Live data for operational changes.";

export function operationalWritesAllowed(
  user: AccessIdentity | null | undefined,
): boolean {
  return !!user && !demonstrationOnly(user);
}

/** UI hints mirror the server boundary; clients never grant their own authority. */
export function accountCapabilities(
  user: AccessIdentity & {
    role: string;
    passwordChangeRequired?: boolean;
    disabledAt?: Date | null;
  },
): AccountCapabilities {
  const demoOnly = demonstrationOnly(user),
    allowed = !demoOnly && !user.passwordChangeRequired && !user.disabledAt;
  const rank =
    (
      { user: 0, viewer: 0, operator: 1, engineer: 2, admin: 3 } as Record<
        string,
        number
      >
    )[user.role] ?? -1;
  return {
    demoOnly,
    canOperate: allowed && rank >= 1,
    canEngineer: allowed && rank >= 2,
    canAdminister: allowed && rank >= 3,
  };
}
