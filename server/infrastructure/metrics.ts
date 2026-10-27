import { performance } from "node:perf_hooks";
import type { Express } from "express";
import type { ResourceEvidence } from "../../shared/infrastructure";

const requests: Array<{ at: number; ms: number; failed: boolean }> = [];
let previous:
  | {
      at: number;
      cpu: NodeJS.CpuUsage;
      loop: ReturnType<typeof performance.eventLoopUtilization>;
    }
  | undefined;
export function installRequestMetrics(app: Express) {
  app.use((req, res, next) => {
    if (
      !req.path.startsWith("/api/") ||
      /infrastructure|worker-status|runtime\/contract/.test(req.path)
    )
      return next();
    const started = performance.now();
    res.once("finish", () => {
      requests.push({
        at: Date.now(),
        ms: performance.now() - started,
        failed: res.statusCode >= 500,
      });
      if (requests.length > 1024) requests.splice(0, requests.length - 1024);
    });
    next();
  });
}
export function apiProcessResources(now = Date.now()): ResourceEvidence[] {
  const at = new Date(now).toISOString(),
    cpu = process.cpuUsage(),
    loop = performance.eventLoopUtilization(),
    elapsed = previous ? now - previous.at : 0;
  const cpuRate =
    previous && elapsed >= 1000
      ? (cpu.user - previous.cpu.user + (cpu.system - previous.cpu.system)) /
        elapsed
      : null;
  const occupied =
    previous && elapsed >= 1000
      ? performance.eventLoopUtilization(loop, previous.loop).utilization * 100
      : null;
  previous = { at: now, cpu, loop };
  const recent = requests.filter((r) => r.at <= now && now - r.at <= 300000),
    sorted = recent.map((r) => r.ms).sort((a, b) => a - b);
  const make = (
    id: string,
    name: string,
    unit: ResourceEvidence["unit"],
    value: number | null,
    explanation: string,
  ): ResourceEvidence => ({
    id,
    name,
    unit,
    value: value != null && Number.isFinite(value) && value >= 0 ? value : null,
    observedAt: value == null ? null : at,
    scope: "Application API · Node process",
    explanation,
  });
  return [
    make(
      "api-rss",
      "Resident memory",
      "bytes",
      process.memoryUsage().rss,
      "Measured process RSS. This does not measure the host, container total or managed-service quota.",
    ),
    make(
      "api-cpu",
      "CPU consumption",
      "CPU ms/s",
      cpuRate,
      "CPU time per elapsed second across this process's threads; no host-capacity percentage is inferred. A second sample is required.",
    ),
    make(
      "api-loop",
      "Event-loop occupancy",
      "%",
      occupied,
      "Occupied time as a fraction of this Node event loop's measured interval. This is not VM CPU usage.",
    ),
    make(
      "api-latency",
      "Request latency · p95",
      "ms",
      sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      `Last ${recent.length} completed API requests, bounded to 1,024 in five minutes; collection and health requests excluded.`,
    ),
    make(
      "api-errors",
      "Server error rate",
      "%",
      recent.length
        ? (100 * recent.filter((r) => r.failed).length) / recent.length
        : null,
      `Responses with HTTP 5xx among the same ${recent.length} measured requests; no requests means unknown.`,
    ),
  ];
}
