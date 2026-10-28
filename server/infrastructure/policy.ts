import type { HealthState } from "../../shared/infrastructure";
import { monitoringInterval } from "./configuration";
export type HealthPolicy = {
  observationIntervalSeconds: number;
  alertAfterSeconds: number;
  recoveryAfterSeconds: number;
  backlogWarning: number;
  oldestWarningSeconds: number;
  memoryWarningBytes: number;
};
const setting = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const n = Number(env[key]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
export function healthPolicy(env = process.env): HealthPolicy {
  return {
    observationIntervalSeconds: monitoringInterval(env) ?? 60,
    alertAfterSeconds: setting(
      env,
      "INFRASTRUCTURE_ALERT_AFTER_SECONDS",
      120,
      30,
      3600,
    ),
    recoveryAfterSeconds: setting(
      env,
      "INFRASTRUCTURE_RECOVERY_AFTER_SECONDS",
      60,
      30,
      1800,
    ),
    backlogWarning: setting(
      env,
      "INFRASTRUCTURE_BACKLOG_WARNING",
      100,
      1,
      1000000,
    ),
    oldestWarningSeconds: setting(
      env,
      "INFRASTRUCTURE_OLDEST_WARNING_SECONDS",
      300,
      10,
      86400,
    ),
    memoryWarningBytes: setting(
      env,
      "INFRASTRUCTURE_API_RSS_WARNING_BYTES",
      536870912,
      16777216,
      68719476736,
    ),
  };
}
export type PersistedHealthState = {
  state: HealthState;
  since: string;
  alerted: boolean;
  incidentState: HealthState | null;
  lastSuccessAt: string | null;
  lastObservedAt: string;
};
export function nextHealthState(
  previous: PersistedHealthState | undefined,
  state: HealthState,
  at: string,
  policy: HealthPolicy,
) {
  const interval = previous
    ? Date.parse(at) - Date.parse(previous.lastObservedAt)
    : NaN;
  // A slow older collection must not undo a newer state or revoke its incident.
  if (previous && interval < 0)
    return { next: previous, changed: false, notification: null };
  const changed = previous?.state !== state;
  const gap =
    !previous?.lastObservedAt ||
    !Number.isFinite(interval) ||
    interval > (policy.observationIntervalSeconds * 1.5 + 15) * 1000;
  const next: PersistedHealthState = {
    state,
    since: changed || gap ? at : previous!.since,
    alerted: previous?.alerted ?? false,
    incidentState: previous?.incidentState ?? null,
    lastSuccessAt: state === "healthy" ? at : (previous?.lastSuccessAt ?? null),
    lastObservedAt: at,
  };
  const age = Math.max(0, (Date.parse(at) - Date.parse(next.since)) / 1000),
    bad = ["unavailable", "degraded", "stale"].includes(state);
  let notification: "incident" | "recovery" | null = null;
  if (bad && age >= policy.alertAfterSeconds && !next.alerted) {
    notification = "incident";
    next.alerted = true;
    next.incidentState = state;
  }
  if (
    state === "healthy" &&
    next.alerted &&
    age >= policy.recoveryAfterSeconds
  ) {
    notification = "recovery";
    next.alerted = false;
    next.incidentState = null;
  }
  return { next, changed, notification };
}
