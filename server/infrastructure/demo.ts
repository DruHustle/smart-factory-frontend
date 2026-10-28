import {
  healthSnapshot,
  type InfrastructureView,
  type HealthSnapshot,
} from "../../shared/infrastructure";
import { healthPolicy } from "./policy";
/** Isolated authored examples. This function reads neither deployment configuration nor private caches. */
export function demoInfrastructure(
  scenario: "normal" | "failure" | "recovery" = "normal",
  range: "2h" | "24h" = "2h",
): InfrastructureView {
  const end = Date.parse("2026-10-27T09:00:00Z"),
    at = new Date(end).toISOString(),
    broken = scenario === "failure";
  const base = (
    id: string,
    name: string,
    state: HealthSnapshot["services"][number]["state"],
    dimension: HealthSnapshot["services"][number]["dimension"],
  ) => ({
    id,
    name,
    state,
    dimension,
    configured: true,
    source: "Authored simulation fixture",
    scope: "Isolated example installation",
    observedAt: at,
    collectedAt: at,
    lastSuccessAt:
      broken && id === "mqtt" ? new Date(end - 600000).toISOString() : at,
    freshForSeconds: 90,
    reason:
      broken && id === "mqtt"
        ? "SIMULATED_SUBSCRIPTION_LOSS"
        : "SIMULATED_OBSERVATION",
    explanation:
      "Explicitly simulated software evidence. No physical device or production dependency was probed.",
    latencyMs: null,
  });
  const snapshot = healthSnapshot.parse({
    version: 1,
    collectedAt: at,
    synthetic: true,
    stale: false,
    services: [
      base("frontend", "Web frontend", "healthy", "reachability"),
      base("api", "Application API", "healthy", "liveness"),
      base("database", "Application PostgreSQL", "healthy", "readiness"),
      base(
        "mqtt",
        "MQTT subscriber",
        broken ? "unavailable" : "healthy",
        "subscription",
      ),
      base("telemetry-worker", "Telemetry worker", "healthy", "heartbeat"),
      base("notifications", "Notification delivery", "healthy", "delivery"),
      {
        ...base("host-collector", "Host collector", "unknown", "coverage"),
        observedAt: null,
        lastSuccessAt: null,
        reason: "NO_HOST_COLLECTOR",
        explanation: "No host or container resource collector is connected.",
      },
      {
        ...base(
          "aas-repository",
          "AAS repository",
          "not_configured",
          "readiness",
        ),
        configured: false,
        observedAt: null,
        lastSuccessAt: null,
        reason: "NOT_CONFIGURED",
      },
    ],
    dependencies: [
      { from: "frontend", to: "api", label: "Simulated application requests" },
      {
        from: "mqtt",
        to: "telemetry-worker",
        label: "Simulated broker subscription",
      },
      {
        from: "telemetry-worker",
        to: "api",
        label: "Simulated accepted forwarding",
      },
      { from: "api", to: "database", label: "Simulated configured database" },
    ],
    resources: [
      {
        id: "api-rss",
        name: "Resident memory",
        unit: "bytes",
        value: 140 * 1048576,
        observedAt: at,
        scope: "Simulated API process",
        explanation: "Authored example; not measured infrastructure usage.",
      },
      {
        id: "api-cpu",
        name: "CPU consumption",
        unit: "CPU ms/s",
        value: broken ? 185 : 42,
        observedAt: at,
        scope: "Simulated API process",
        explanation: "CPU time per second; no host percentage.",
      },
      {
        id: "api-latency",
        name: "Request latency · p95",
        unit: "ms",
        value: broken ? 420 : 34,
        observedAt: at,
        scope: "Simulated API request window",
        explanation: "Authored example response latency.",
      },
      {
        id: "host-memory",
        name: "Host memory",
        unit: "bytes",
        value: null,
        observedAt: null,
        scope: "Host",
        explanation: "Not connected. A host collector is required.",
      },
    ],
    queues: [
      {
        id: "telemetry",
        name: "Telemetry forwarding",
        state: broken || scenario === "normal" ? "degraded" : "healthy",
        pending: broken ? 142 : 0,
        quarantined: scenario === "normal" ? 2 : 0,
        failed: broken ? 6 : 0,
        oldestAcceptedAt: broken ? new Date(end - 540000).toISOString() : null,
        oldestAgeSeconds: broken ? 540 : null,
        observedAt: at,
        collectedAt: at,
        scope: "Simulated worker receipt",
        explanation:
          "Authored queue-acceptance times. This example sends no telemetry or email.",
      },
      {
        id: "security",
        name: "Security outbox",
        state: "healthy",
        pending: 0,
        quarantined: 0,
        failed: 0,
        oldestAcceptedAt: null,
        oldestAgeSeconds: null,
        observedAt: at,
        collectedAt: at,
        scope: "Simulated application database",
        explanation: "Isolated demonstration queue.",
      },
    ],
    collectors: [
      {
        id: "demo-edge-agent",
        name: "Simulated edge collector",
        active: true,
        state: broken ? "stale" : "healthy",
        observedAt: new Date(end - (broken ? 600000 : 12000)).toISOString(),
        collectedAt: at,
        freshForSeconds: 300,
      },
      {
        id: "demo-unobserved",
        name: "Simulated unobserved collector",
        active: true,
        state: "unknown",
        observedAt: null,
        collectedAt: at,
        freshForSeconds: 300,
      },
    ],
    release: {
      frontend: "SIM-frontend-v2",
      api: "SIM-api-v2",
      backend: "SIM-dotnet-10",
      edgeSource: null,
      schema: "SIM-infrastructure-schema",
      compatible: true,
    },
    recovery: [],
    coverage: {
      mode: "simulation",
      intervalSeconds: 60,
      historyDays: 1,
      independentMonitor: "unknown",
      explanation:
        "Recorded simulated walkthrough. Failure/recovery controls only select authored examples; no infrastructure action is performed.",
    },
  });
  const history = Array.from({ length: 121 }, (_, i) => {
    const failing = i >= 92 && (broken || i <= 103),
      missing = i === 80 || i === 81;
    return missing
      ? null
      : {
          at: new Date(end - (120 - i) * 60000).toISOString(),
          services: snapshot.services.map((s) => ({
            id: s.id,
            state:
              s.id === "mqtt" && failing ? ("unavailable" as const) : s.state,
          })),
          resources: [
            { id: "api-rss", value: (132 + i / 15) * 1048576 },
            {
              id: "api-cpu",
              value:
                i === 120
                  ? broken
                    ? 185
                    : 42
                  : failing
                    ? 180 + (i - 92) * 0.18
                    : 35 + (i % 8),
            },
            {
              id: "api-latency",
              value:
                i === 120
                  ? broken
                    ? 420
                    : 34
                  : failing
                    ? 400 + (i - 92) * 0.7
                    : 30 + (i % 9),
            },
          ],
          queues: [
            {
              id: "telemetry",
              pending: failing ? Math.min(142, (i - 91) * 5) : 0,
              state: failing ? ("degraded" as const) : ("healthy" as const),
            },
          ],
        };
  }).filter((p): p is NonNullable<typeof p> => p !== null);
  return {
    snapshot,
    history,
    events: [
      ...(!broken
        ? ([
            {
              id: "demo-recovery",
              serviceId: "mqtt",
              name: "MQTT subscriber",
              previous: "unavailable",
              state: "healthy",
              at: new Date(end - 15 * 60000).toISOString(),
              kind: "recovery",
              reason: "SIMULATED_RECONNECT",
            },
          ] as const)
        : []),
      {
        id: "demo-backlog",
        serviceId: "telemetry-worker",
        name: "Telemetry forwarding backlog",
        previous: "healthy",
        state: "degraded",
        at: new Date(end - 25 * 60000).toISOString(),
        kind: "incident",
        reason: "SIMULATED_SUSTAINED_BACKLOG",
      },
      {
        id: "demo-failure",
        serviceId: "mqtt",
        name: "MQTT subscriber",
        previous: "healthy",
        state: "unavailable",
        at: new Date(end - 28 * 60000).toISOString(),
        kind: "transition",
        reason: "SIMULATED_SUBSCRIPTION_LOSS",
      },
    ],
    historyWindow: {
      from: new Date(end - (range === "24h" ? 24 : 2) * 3600000).toISOString(),
      to: at,
      returned: history.length,
      points: history.length,
      coveredSlots: history.length,
      expected: (range === "24h" ? 24 : 2) * 60 + 1,
      gaps: (range === "24h" ? 24 : 2) * 60 + 1 - history.length,
      availabilityPercent: null,
    },
    policy: healthPolicy({}),
  };
}
