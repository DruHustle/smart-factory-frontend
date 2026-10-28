import {
  publicDemoDeployment,
  type DeploymentEnvironment,
} from "../../shared/access-policy";

/** One policy for actual collection, displayed coverage and alert continuity. */
export function monitoringInterval(env: DeploymentEnvironment = process.env) {
  const seconds = Number(env.INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS);
  return !publicDemoDeployment(env) &&
    Number.isInteger(seconds) &&
    seconds >= 60 &&
    seconds <= 900
    ? seconds
    : null;
}
