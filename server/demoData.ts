import { AsyncLocalStorage } from "node:async_hooks";
import {
  demonstrationOnly,
  type AccessIdentity,
} from "../shared/access-policy";
import { sql, type SQLWrapper } from "drizzle-orm";

export type VisibilityPolicy = { demoOnly: boolean; includeDemo: boolean };
const requestVisibility = new AsyncLocalStorage<VisibilityPolicy>();
/** Resolve from PostgreSQL for each authenticated request, never a replica-local toggle. */
export async function resolveVisibility(
  user: AccessIdentity | null,
): Promise<VisibilityPolicy> {
  if (demonstrationOnly(user)) return { demoOnly: true, includeDemo: true };
  const { refreshDemoDataSetting } = await import("./db");
  try {
    return { demoOnly: false, includeDemo: await refreshDemoDataSetting() };
  } catch {
    return { demoOnly: false, includeDemo: false };
  } // Fail closed for optional demo data; documentation remains usable during storage outages.
}
export function withVisibility<T>(policy: VisibilityPolicy, fn: () => T): T {
  return requestVisibility.run(policy, fn);
}
export function visibilityPolicy(
  env: NodeJS.ProcessEnv = process.env,
): VisibilityPolicy {
  return (
    requestVisibility.getStore() ?? {
      demoOnly: false,
      includeDemo: env.ENABLE_DEMO_DATA === "true",
    }
  );
}
export const demoOnlyRead = () => visibilityPolicy().demoOnly;
export function visibleRecordSql(isDemo: SQLWrapper) {
  const policy = visibilityPolicy();
  return policy.demoOnly
    ? sql`${isDemo}=true`
    : policy.includeDemo
      ? sql`true`
      : sql`${isDemo}=false`;
}
export function demoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return visibilityPolicy(env).includeDemo;
}
/** Kept for old startup callers; request visibility no longer uses process-local state. */
export function setRuntimeDemoDataEnabled(_enabled: boolean | undefined) {}
export function visibleWhenDemoDataEnabled(
  record: { isDemo: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const policy = visibilityPolicy(env);
  return record.isDemo ? policy.includeDemo : !policy.demoOnly;
}
