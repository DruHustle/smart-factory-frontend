/** Small shared list used by workspace navigation without loading operations calculations. */
export const operationScenarios = [
  "healthy",
  "pump-warning",
  "utility-loss",
  "gateway-outage",
  "maintenance",
  "recovery",
] as const;
export type OperationScenario = (typeof operationScenarios)[number];
export const operationScenarioLabels: Record<OperationScenario, string> = {
  healthy: "Healthy operation",
  "pump-warning": "Pump condition warning",
  "utility-loss": "Utility loss and slowdown",
  "gateway-outage": "Gateway outage",
  maintenance: "Planned maintenance",
  recovery: "Recovery and handover",
};
