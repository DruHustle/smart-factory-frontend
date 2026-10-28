import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { wsManager } from "../websocket";
import { getRuntimeContract } from "../runtimeContract";
import { telemetryWorkerReceipt } from "../operatingEvidence";
import { notificationConfiguration } from "../notifications";
import { apiProcessResources } from "./metrics";
import { healthPolicy } from "./policy";
import { monitoringInterval } from "./configuration";
import {
  healthSnapshot,
  recoveryReceipt,
  type HealthSnapshot,
  type ServiceEvidence,
  type QueueEvidence,
  type ResourceEvidence,
} from "../../shared/infrastructure";

/** A single existing two-connection pool; no monitoring-only database pool. */
export async function boundedRead<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
) {
  const db = await getDb();
  if (!db) throw Error("DATABASE_UNAVAILABLE");
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout='2000ms'`);
    await tx.execute(sql`set local lock_timeout='500ms'`);
    return tx.execute<T>(query);
  });
}
const iso = (v: unknown) => {
  if (v == null) return null;
  const n = new Date(String(v));
  return Number.isFinite(n.getTime()) ? n.toISOString() : null;
};
const number = (v: unknown) => (v == null ? null : Number(v));
function evidence(
  id: string,
  name: string,
  dimension: ServiceEvidence["dimension"],
  configured: boolean,
  at: string,
): ServiceEvidence {
  return {
    id,
    name,
    dimension,
    configured,
    state: configured ? "unknown" : "not_configured",
    source: "Application-owned collector",
    scope: "Configured application dependency",
    observedAt: null,
    collectedAt: at,
    lastSuccessAt: null,
    freshForSeconds: 90,
    reason: configured ? "NO_EVIDENCE" : "NOT_CONFIGURED",
    explanation: configured
      ? "No current observation is available."
      : "This optional dependency is not configured.",
    latencyMs: null,
  };
}
/** Targets come only from operator configuration or the fixed bundle service map, never API input. */
export function configuredProbe(
  raw: string | undefined,
  path: string,
): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (
      u.username ||
      u.password ||
      u.hash ||
      !["https:", "http:"].includes(u.protocol)
    )
      return null;
    if (
      u.protocol === "http:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    )
      return null;
    return new URL(path, u.origin).href;
  } catch {
    return null;
  }
}
async function probe(
  base: ServiceEvidence,
  url: string | null,
): Promise<ServiceEvidence> {
  if (!base.configured) return base;
  if (!url)
    return {
      ...base,
      reason: "NO_APPROVED_HEALTH_TARGET",
      explanation:
        "A connection is configured, but no supported health check is connected.",
    };
  const start = performance.now();
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    await r.body?.cancel();
    return {
      ...base,
      state: r.ok
        ? "healthy"
        : [401, 403, 404].includes(r.status)
          ? "unknown"
          : "unavailable",
      observedAt: base.collectedAt,
      latencyMs: performance.now() - start,
      reason: r.ok
        ? "CHECK_RESPONDED"
        : [401, 403].includes(r.status)
          ? "HEALTH_AUTH_REQUIRED"
          : r.status === 404
            ? "HEALTH_ROUTE_UNAVAILABLE"
            : "READINESS_REJECTED",
      explanation: r.ok
        ? "The configured readiness endpoint responded successfully. This does not establish equipment availability."
        : [401, 403, 404].includes(r.status)
          ? "The service responded, but this check could not establish readiness."
          : "The configured readiness endpoint did not report ready.",
    };
  } catch {
    return {
      ...base,
      state: "unavailable",
      observedAt: base.collectedAt,
      reason: "PROBE_UNAVAILABLE",
      explanation:
        "The bounded configured probe did not complete. Private endpoints and raw errors are withheld.",
    };
  }
}
async function parallel<T>(tasks: Array<() => Promise<T>>, limit = 2) {
  const values: T[] = Array(tasks.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        values[i] = await tasks[i]();
      }
    }),
  );
  return values;
}
export async function collectInfrastructure(): Promise<HealthSnapshot> {
  const at = new Date().toISOString(),
    policy = healthPolicy(),
    env = process.env;
  const services: ServiceEvidence[] = [
    {
      ...evidence("api", "Application API", "liveness", true, at),
      state: "healthy",
      observedAt: at,
      reason: "REQUEST_HANDLED",
      source: "Current API process",
      scope: "Node process liveness",
      explanation:
        "This process handled the collection request. Dependency readiness is checked separately.",
    },
  ];
  const resources: ResourceEvidence[] = apiProcessResources(),
    queues: QueueEvidence[] = [],
    collectors: HealthSnapshot["collectors"] = [];
  const dependencies: HealthSnapshot["dependencies"] = [
    { from: "frontend", to: "api", label: "Application requests" },
  ];
  const bundle = env.BACKEND_DEPLOYMENT_MODE === "render-bundle",
    dbConfigured = !!env.DATABASE_URL;
  let runtime: Awaited<ReturnType<typeof getRuntimeContract>> | null = null,
    worker: Awaited<ReturnType<typeof telemetryWorkerReceipt>> = null;
  let databaseAvailable = false;
  const dbBase = evidence(
      "database",
      "Application PostgreSQL",
      "readiness",
      dbConfigured,
      at,
    ),
    dbStart = performance.now();
  try {
    await boundedRead(sql`select 1 as ready`);
    databaseAvailable = true;
    services.push({
      ...dbBase,
      state: "healthy",
      observedAt: at,
      reason: "QUERY_COMPLETED",
      latencyMs: performance.now() - dbStart,
      explanation:
        "A read-only query completed in the application database. Other databases have separate service evidence.",
    });
  } catch {
    services.push({
      ...dbBase,
      state: dbConfigured ? "unavailable" : "not_configured",
      observedAt: dbConfigured ? at : null,
      reason: "DATABASE_CHECK_UNAVAILABLE",
      explanation: "Application database readiness could not be established.",
    });
  }
  if (dbConfigured)
    dependencies.push({
      from: "api",
      to: "database",
      label: "Configured dashboard database",
    });
  if (databaseAvailable) {
    const results = await Promise.allSettled([
      getRuntimeContract(),
      telemetryWorkerReceipt(),
    ]);
    if (results[0].status === "fulfilled") runtime = results[0].value;
    if (results[1].status === "fulfilled") worker = results[1].value;
  }
  const resource = (
    id: string,
    name: string,
    unit: ResourceEvidence["unit"],
    value: number | null,
    scope: string,
    explanation: string,
    observedAt: string | null = at,
  ) => ({
    id,
    name,
    unit,
    value,
    scope,
    explanation,
    observedAt: value == null ? null : observedAt,
  });
  try {
    if (!databaseAvailable) throw Error("DATABASE_UNAVAILABLE");
    const [r] = await boundedRead(
      sql`select (select count(*)::int from pg_stat_activity where datname=current_database()) as connections,pg_database_size(current_database())::float8 as bytes`,
    );
    resources.push(
      resource(
        "database-connections",
        "Database sessions",
        "connections",
        number(r.connections),
        "Application PostgreSQL database",
        "Observed sessions for this database; no managed-service connection quota is inferred.",
      ),
      resource(
        "database-storage",
        "Database allocation",
        "bytes",
        number(r.bytes),
        "Application PostgreSQL database",
        "Database allocation reported by PostgreSQL. This is not host free space or the provider's storage quota.",
      ),
    );
  } catch {
    resources.push(
      resource(
        "database-connections",
        "Database sessions",
        "connections",
        null,
        "Application PostgreSQL database",
        "No permitted session/storage observation is available.",
      ),
      resource(
        "database-storage",
        "Database allocation",
        "bytes",
        null,
        "Application PostgreSQL database",
        "Storage collector unavailable; host and provider capacity remain unknown.",
      ),
    );
  }
  resources.push(
    resource(
      "database-latency",
      "Database readiness latency",
      "ms",
      services.find((s) => s.id === "database")?.latencyMs ?? null,
      "Application PostgreSQL database",
      "Elapsed time for this bounded readiness query, including pool acquisition.",
    ),
  );
  const socket = wsManager.operatingEvidence();
  services.push({
    ...evidence("websocket", "WebSocket server", "liveness", true, at),
    state: socket.localReady ? "healthy" : "unknown",
    observedAt: socket.localReady ? at : null,
    scope: "Application WebSocket server",
    reason: socket.localReady
      ? "SOCKET_SERVER_INITIALIZED"
      : "NO_SOCKET_SERVER_EVIDENCE",
    explanation:
      "Socket server initialization is distinct from Redis readiness and delivery of equipment observations.",
  });
  resources.push(
    resource(
      "websocket-connections",
      "WebSocket connections",
      "connections",
      socket.localReady ? socket.connections : null,
      "Application API WebSocket server",
      "Observed authorized socket count; not a subscription quota or equipment-online count.",
    ),
  );
  dependencies.push({
    from: "api",
    to: "websocket",
    label: "Application-owned event channels",
  });
  const redisReady = socket.publisherReady && socket.subscriberReady;
  const redis = evidence(
    "redis",
    "Redis fan-out",
    "readiness",
    !!env.REDIS_URL,
    at,
  );
  services.push({
    ...redis,
    state: !redis.configured
      ? "not_configured"
      : redisReady
        ? "healthy"
        : "unavailable",
    observedAt: redis.configured ? at : null,
    reason: !redis.configured
      ? "LOCAL_FANOUT_ONLY"
      : redisReady
        ? "REDIS_CONNECTION_READY"
        : "REDIS_CONNECTION_UNAVAILABLE",
    explanation: redis.configured
      ? "Readiness of the existing Redis publisher and subscriber connections; no new monitoring connection is opened."
      : "WebSocket local fan-out is available; cross-process Redis fan-out is not configured.",
  });
  if (redis.configured)
    dependencies.push({
      from: "websocket",
      to: "redis",
      label: "Configured socket fan-out",
    });
  const frontendRaw =
    env.INFRASTRUCTURE_FRONTEND_ORIGIN ?? env.ALLOWED_ORIGIN?.split(",")[0];
  let frontendSource: string | null = null,
    frontendCapabilities: string[] | null = null;
  const frontend = evidence(
      "frontend",
      "Web frontend",
      "reachability",
      !!frontendRaw,
      at,
    ),
    frontTarget = configuredProbe(frontendRaw, "/release.json");
  if (frontTarget)
    try {
      const start = performance.now(),
        response = await fetch(frontTarget, {
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        });
      if (!response.ok) throw Error();
      const reader = response.body?.getReader();
      let size = 0,
        body = "";
      if (reader)
        while (true) {
          const p = await reader.read();
          if (p.done) break;
          size += p.value.length;
          if (size > 16384) {
            await reader.cancel();
            throw Error();
          }
          body += new TextDecoder().decode(p.value);
        }
      const release = JSON.parse(body);
      frontendSource = /^[a-f0-9]{40}$/.test(release.source ?? "")
        ? release.source
        : null;
      frontendCapabilities =
        Array.isArray(release.requiredCapabilities) &&
        release.requiredCapabilities.every(
          (c: unknown) => typeof c === "string",
        )
          ? release.requiredCapabilities
          : null;
      services.push({
        ...frontend,
        state: frontendSource ? "healthy" : "unknown",
        observedAt: at,
        latencyMs: performance.now() - start,
        reason: frontendSource
          ? "VERSIONED_FRONTEND_RESPONDED"
          : "FRONTEND_IDENTITY_UNKNOWN",
        explanation:
          "The configured frontend release endpoint responded. This measures reachability from the API, not independent browser availability.",
      });
    } catch {
      services.push({
        ...frontend,
        state: "unavailable",
        observedAt: at,
        reason: "FRONTEND_PROBE_UNAVAILABLE",
        explanation:
          "The configured release endpoint could not be verified by this bounded probe.",
      });
    }
  else
    services.push({
      ...frontend,
      reason: frontend.configured
        ? "NO_APPROVED_HEALTH_TARGET"
        : "NOT_CONFIGURED",
    });
  const configuredPorts = new Set(
    (env.BUNDLE_SERVICE_PORTS ?? (bundle ? "3102,3104,3105" : ""))
      .split(",")
      .map(Number),
  );
  const backendMap = [
    ["device-service", "Device / AAS service", 3102],
    ["identity-service", "Identity service", 3104],
    ["analytics-service", "Analytics service", 3105],
  ] as const;
  const backendChecks = await parallel(
    backendMap.map(([id, name, port]) => async () => {
      const b = evidence(
        id,
        name,
        "readiness",
        bundle && configuredPorts.has(port),
        at,
      );
      if (b.configured)
        dependencies.push({
          from: "api",
          to: id,
          label: "Configured bundled API",
        });
      return probe(
        b,
        b.configured ? `http://127.0.0.1:${port}/health/ready` : null,
      );
    }),
  );
  services.push(...backendChecks);
  const hasWorker = bundle || worker !== null;
  const w = evidence(
      "telemetry-worker",
      "Telemetry worker",
      "heartbeat",
      hasWorker,
      at,
    ),
    mqtt = evidence(
      "mqtt",
      "MQTT subscriber",
      "subscription",
      hasWorker && !!env.MqttBrokerHost,
      at,
    );
  services.push({
    ...w,
    state: !hasWorker
      ? "not_configured"
      : !worker
        ? "unknown"
        : !worker.fresh
          ? "stale"
          : runtime?.worker?.compatible === false
            ? "degraded"
            : "healthy",
    observedAt: worker?.observedAt ?? null,
    source: "Authenticated worker receipt",
    scope: "Telemetry process and its last accepted receipt",
    reason: !worker
      ? "NO_WORKER_RECEIPT"
      : !worker.fresh
        ? "WORKER_RECEIPT_EXPIRED"
        : runtime?.worker?.compatible === false
          ? "WORKER_RUNTIME_MISMATCH"
          : "FRESH_WORKER_RECEIPT",
    explanation:
      "A software heartbeat establishes the worker's last observation, not physical equipment connectivity.",
  });
  services.push({
    ...mqtt,
    state: !mqtt.configured
      ? "not_configured"
      : !worker
        ? "unknown"
        : !worker.fresh
          ? "stale"
          : worker.mqttSubscribed
            ? "healthy"
            : "unavailable",
    observedAt: worker?.observedAt ?? null,
    source: "Authenticated worker receipt",
    scope: "Broker subscription reported by the telemetry worker",
    reason: !worker
      ? "NO_SUBSCRIPTION_RECEIPT"
      : !worker.fresh
        ? "SUBSCRIPTION_RECEIPT_EXPIRED"
        : worker.mqttSubscribed
          ? "SUBSCRIPTION_REPORTED"
          : "SUBSCRIPTION_NOT_READY",
    explanation:
      "A reported subscription does not prove a current equipment sample or successful application delivery.",
  });
  if (hasWorker) {
    dependencies.push(
      {
        from: "mqtt",
        to: "telemetry-worker",
        label: "Configured broker subscription",
      },
      {
        from: "telemetry-worker",
        to: "api",
        label: "Authenticated delivery and receipts",
      },
    );
  }
  const queue = (
    id: string,
    name: string,
    pending: number | null,
    quarantined: number | null,
    failed: number | null,
    oldest: string | null,
    observedAt: string | null,
    stale = false,
    explanation = "",
  ): QueueEvidence => {
    const age = oldest
      ? Math.max(0, (Date.parse(at) - Date.parse(oldest)) / 1000)
      : null;
    return {
      id,
      name,
      pending,
      quarantined,
      failed,
      oldestAcceptedAt: oldest,
      oldestAgeSeconds: age,
      observedAt,
      collectedAt: at,
      scope:
        id === "telemetry"
          ? "Telemetry database · worker receipt"
          : "Application database",
      state: stale
        ? "stale"
        : pending == null
          ? "unknown"
          : pending >= policy.backlogWarning ||
              (age ?? 0) >= policy.oldestWarningSeconds ||
              (quarantined ?? 0) > 0 ||
              (failed ?? 0) > 0
            ? "degraded"
            : "healthy",
      explanation,
    };
  };
  queues.push(
    queue(
      "telemetry",
      "Telemetry forwarding",
      worker?.pending ?? null,
      worker?.quarantined ?? null,
      worker?.failedAttempts ?? null,
      worker?.oldestPendingAt ?? null,
      worker?.observedAt ?? null,
      !!worker && !worker.fresh,
      "Queue age uses worker acceptance time. Failed attempts count queued records with prior failures. Stale receipts retain last-known values; broker acceptance and application delivery are distinct.",
    ),
  );
  for (const [id, name, statement, explanation] of [
    [
      "security",
      "Security outbox",
      sql`select count(*) filter(where delivered_at is null and quarantined_at is null)::int as pending,count(*) filter(where quarantined_at is not null)::int as quarantined,count(*) filter(where delivered_at is null and attempts>0)::int as failed,min(accepted_at) filter(where delivered_at is null and quarantined_at is null) as oldest,count(*) filter(where delivered_at is null and quarantined_at is null and accepted_at is null)::int as unclassified from security_outbox`,
      "Age uses outbox acceptance, not event occurrence. Legacy acceptance times remain unknown.",
    ],
    [
      "email",
      "Notification delivery",
      sql`select count(*) filter(where "emailStatus" in('pending','processing','retrying'))::int as pending,0::int as quarantined,count(*) filter(where "emailStatus" in('failed','no_recipient','unconfigured'))::int as failed,min("createdAt") filter(where "emailStatus" in('pending','processing','retrying')) as oldest,0::int as unclassified from notification_inbox`,
      "Queue acceptance is inbox creation. Provider acceptance does not establish recipient delivery.",
    ],
  ] as const) {
    try {
      if (!databaseAvailable) throw Error("DATABASE_UNAVAILABLE");
      const [r] = await boundedRead(statement);
      queues.push(
        queue(
          id,
          name,
          number(r.pending),
          number(r.quarantined),
          number(r.failed),
          Number(r.unclassified) > 0 ? null : iso(r.oldest),
          at,
          false,
          explanation,
        ),
      );
    } catch {
      queues.push(
        queue(
          id,
          name,
          null,
          null,
          null,
          null,
          null,
          false,
          "This queue could not be read. An unavailable count is not an empty queue.",
        ),
      );
    }
  }
  const notification = notificationConfiguration()[0],
    n = evidence(
      "notifications",
      "Notification delivery",
      "delivery",
      notification.emailConfigured,
      at,
    );
  const notificationProcess = evidence(
    "notification-service",
    "Notification worker",
    "readiness",
    hasWorker,
    at,
  );
  services.push({
    ...notificationProcess,
    state: !hasWorker
      ? "not_configured"
      : !worker
        ? "unknown"
        : !worker.fresh
          ? "stale"
          : worker.notificationReady == null
            ? "unknown"
            : worker.notificationReady
              ? "healthy"
              : "unavailable",
    observedAt: worker?.observedAt ?? null,
    source: "Authenticated worker receipt · fixed local readiness check",
    scope: "Notification process and its database readiness",
    reason:
      !worker || worker.notificationReady == null
        ? "NO_NOTIFICATION_READINESS_RECEIPT"
        : !worker.fresh
          ? "NOTIFICATION_RECEIPT_EXPIRED"
          : worker.notificationReady
            ? "NOTIFICATION_PROCESS_READY"
            : "NOTIFICATION_PROCESS_UNAVAILABLE",
    explanation:
      "Readiness is reported separately from queued email, provider acceptance and recipient delivery.",
  });
  if (hasWorker)
    dependencies.push({
      from: "notification-service",
      to: "database",
      label: "Configured inbox delivery worker",
    });
  services.push({
    ...n,
    state: !n.configured
      ? "not_configured"
      : (queues.find((q) => q.id === "email")?.state ?? "unknown"),
    observedAt: queues.find((q) => q.id === "email")?.observedAt ?? null,
    source: "Persisted notification queue",
    scope: "Application inbox and provider-request lifecycle",
    reason: !n.configured ? "EMAIL_NOT_CONFIGURED" : "DELIVERY_QUEUE_OBSERVED",
    explanation:
      "Configured delivery and queue evidence are shown separately from confirmed recipient delivery, which is not collected.",
  });
  const aas = !!env.AAS_REPOSITORY_URL;
  services.push(
    await probe(
      evidence("aas-repository", "AAS repository", "readiness", aas, at),
      configuredProbe(env.AAS_REPOSITORY_URL, "/health/ready"),
    ),
  );
  if (aas)
    dependencies.push({
      from: "api",
      to: "aas-repository",
      label: "Configured AAS repository",
    });
  const onesa = evidence(
    "onesa",
    "Onesa exchange",
    "coverage",
    env.ONESA_ENABLED === "true",
    at,
  );
  services.push({
    ...onesa,
    explanation: onesa.configured
      ? "Exchange is configured. No consumer-health receipt is connected; successful external interoperability is a separate outcome."
      : onesa.explanation,
  });
  if (onesa.configured)
    dependencies.push({
      from: "api",
      to: "onesa",
      label: "Optional configured exchange",
    });
  try {
    if (!databaseAvailable) throw Error("DATABASE_UNAVAILABLE");
    const rows = await boundedRead(
      sql`select id,name,active,last_received_at,policy->>'staleAfterSeconds' as seconds,last_error is not null as failed from security_sources where is_demo=false order by last_received_at desc nulls last limit 101`,
    );
    collectors.push(
      ...rows.slice(0, 100).map((r) => {
        const observedAt = iso(r.last_received_at),
          freshForSeconds = Math.min(
            86400,
            Math.max(30, Number(r.seconds) || 300),
          ),
          active = Boolean(r.active);
        return {
          id: String(r.id),
          name: String(r.name),
          active,
          observedAt,
          collectedAt: at,
          freshForSeconds,
          state:
            !active || !observedAt
              ? ("unknown" as const)
              : Date.parse(at) - Date.parse(observedAt) > freshForSeconds * 1000
                ? ("stale" as const)
                : r.failed
                  ? ("degraded" as const)
                  : ("healthy" as const),
        };
      }),
    );
    const stale = collectors.some((c) => c.state === "stale"),
      unobserved =
        collectors.some((c) => c.state === "unknown") || rows.length > 100;
    const base = evidence(
      "collectors",
      "Security collectors",
      "heartbeat",
      rows.length > 0,
      at,
    );
    services.push({
      ...base,
      state: !rows.length
        ? "not_configured"
        : stale
          ? "stale"
          : rows.some((r) => r.failed)
            ? "degraded"
            : unobserved
              ? "unknown"
              : "healthy",
      observedAt: rows.length ? at : null,
      scope: "Up to 100 configured non-demo sources",
      source: "Recorded collector receipts",
      reason: !rows.length
        ? "NO_COLLECTORS"
        : stale
          ? "COLLECTOR_RECEIPT_EXPIRED"
          : "COLLECTOR_RECEIPTS_OBSERVED",
      explanation:
        "Collector freshness is evaluated against each recorded source policy. Up to 100 sources are shown; additional or unobserved sources remain unknown.",
    });
  } catch {
    services.push({
      ...evidence("collectors", "Security collectors", "heartbeat", true, at),
      reason: "COLLECTOR_QUERY_UNAVAILABLE",
    });
  }
  const pressure = evidence(
      "api-pressure",
      "API resource pressure",
      "readiness",
      true,
      at,
    ),
    memory = resources.find((r) => r.id === "api-rss")?.value ?? 0,
    occupied = resources.find((r) => r.id === "api-loop")?.value;
  services.push({
    ...pressure,
    state:
      memory > policy.memoryWarningBytes || (occupied ?? 0) > 90
        ? "degraded"
        : "healthy",
    observedAt: at,
    scope: "Node process only · configured warning policy",
    reason:
      memory > policy.memoryWarningBytes
        ? "PROCESS_MEMORY_WARNING"
        : (occupied ?? 0) > 90
          ? "EVENT_LOOP_WARNING"
          : "WITHIN_OBSERVED_POLICY",
    explanation:
      "Warning thresholds are operator policy, not inferred host or container capacities. Incidents require a sustained condition.",
  });
  const workerResources = worker?.resources;
  resources.push(
    resource(
      "worker-memory",
      "Worker resident memory",
      "bytes",
      workerResources?.residentBytes ?? null,
      "Telemetry worker · .NET process",
      workerResources
        ? "Last-known process working set from the authenticated worker receipt; receipt freshness governs currency."
        : "No resource collector is present in the installed worker receipt.",
      worker?.observedAt ?? null,
    ),
    resource(
      "worker-cpu",
      "Worker CPU consumption",
      "CPU ms/s",
      workerResources?.cpuMsPerSecond ?? null,
      "Telemetry worker · .NET process",
      "CPU time per elapsed second from worker receipts; no host utilization percentage is inferred.",
      worker?.observedAt ?? null,
    ),
    resource(
      "worker-db-latency",
      "Worker database query latency",
      "ms",
      workerResources?.databaseQueryMs ?? null,
      "Telemetry worker · telemetry PostgreSQL",
      "Elapsed time of the existing worker status queries, not managed database service utilization.",
      worker?.observedAt ?? null,
    ),
  );
  for (const [id, name, scope] of [
    ["host-memory", "Host memory", "Host"],
    ["container-memory", "Container total memory", "API container"],
    ["host-storage", "Host storage", "Host"],
  ] as const)
    resources.push(
      resource(
        id,
        name,
        "bytes",
        null,
        scope,
        "Not connected. A host/container collector is required; API process metrics do not establish this value.",
      ),
    );
  let recovery: HealthSnapshot["recovery"] = [];
  try {
    if (!databaseAvailable) throw Error("DATABASE_UNAVAILABLE");
    const rows = await boundedRead(
      sql`select distinct on(kind) receipt from infrastructure_recovery_receipts order by kind,observed_at desc limit 2`,
    );
    recovery = rows.map((r) => recoveryReceipt.parse(r.receipt));
  } catch {}
  const compatible = runtime
    ? runtime.schema.ready &&
      (!runtime.worker || runtime.worker.compatible) &&
      (!frontendCapabilities ||
        frontendCapabilities.every((c) => runtime!.capabilities.includes(c)))
    : null;
  services.push({
    ...evidence(
      "compatibility",
      "Runtime compatibility",
      "readiness",
      true,
      at,
    ),
    state: compatible == null ? "unknown" : compatible ? "healthy" : "degraded",
    observedAt: runtime ? at : null,
    source: "Applied migration hashes and runtime contract",
    scope: "API, bundled worker and available frontend contract",
    reason:
      compatible == null
        ? "RUNTIME_IDENTITY_UNAVAILABLE"
        : compatible
          ? "CONTRACT_COMPATIBLE"
          : "RUNTIME_CONTRACT_MISMATCH",
    explanation:
      "Compatibility is verified from available contract and migration evidence. Qualified edge source is not an installed hardware binary attestation.",
  });
  return healthSnapshot.parse({
    version: 1,
    collectedAt: at,
    synthetic: false,
    stale: false,
    services,
    dependencies: dependencies.filter(
      (d) =>
        services.some((s) => s.id === d.from && s.configured) &&
        services.some((s) => s.id === d.to && s.configured),
    ),
    resources,
    queues,
    collectors,
    release: {
      frontend: frontendSource,
      api: runtime?.source ?? null,
      backend: runtime?.backendSource ?? null,
      edgeSource: runtime?.edgeSource ?? null,
      schema: runtime?.schema.ready ? runtime.schema.revision : null,
      compatible,
    },
    recovery,
    coverage: {
      mode: monitoringInterval(env) === null ? "demand" : "scheduled",
      intervalSeconds: monitoringInterval(env) ?? 60,
      historyDays: 1,
      independentMonitor: env.INFRASTRUCTURE_EXTERNAL_STATUS_URL
        ? "configured"
        : "unknown",
      explanation:
        "Checks are cached and collected on demand unless a monitoring schedule is explicitly configured. This monitor cannot independently establish availability during its own complete outage. External-monitor and host collector evidence are unknown unless connected.",
    },
  });
}
