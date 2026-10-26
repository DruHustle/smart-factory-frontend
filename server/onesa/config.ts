import { z } from "zod";
import { CONTRACT } from "./contract";
const scopeId = z.string().regex(/^[A-Za-z0-9:_.-]{1,128}$/);
export function integrationConfig(env = process.env) {
  if (env.ONESA_ENABLED !== "true") return null;
  if (env.ENABLE_DEMO_ACCOUNTS === "true")
    throw new Error(
      "Private integration requires a deployment without shared demo accounts",
    );
  const installationId = z.uuid().parse(env.ONESA_INSTALLATION_ID);
  const workspaceId = scopeId.parse(env.ONESA_WORKSPACE_ID);
  if (env.ONESA_CONTRACT_ID !== CONTRACT)
    throw new Error("Explicit proposed contract approval is required");
  const url = new URL(env.ONESA_INGESTION_URL ?? "");
  const approvedOrigin = new URL(env.ONESA_APPROVED_ORIGIN ?? "");
  if (
    url.origin !== approvedOrigin.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    approvedOrigin.pathname !== "/" ||
    approvedOrigin.search ||
    approvedOrigin.hash ||
    approvedOrigin.username ||
    approvedOrigin.password
  )
    throw new Error("Destination is not approved");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(
      env.NODE_ENV !== "production" &&
      env.ONESA_ALLOW_LOCAL_HTTP === "true" &&
      local &&
      url.protocol === "http:"
    )
  )
    throw new Error("HTTPS destination required");
  if (!env.ONESA_SERVICE_TOKEN || env.ONESA_SERVICE_TOKEN.length < 24)
    throw new Error("Service credential missing");
  const bounded = (key: string, fallback: number, min: number, max: number) =>
    z.coerce
      .number()
      .int()
      .min(min)
      .max(max)
      .parse(env[key] ?? fallback);
  return {
    installationId,
    workspaceId,
    url: url.href,
    origin: url.origin,
    token: env.ONESA_SERVICE_TOKEN,
    batchSize: bounded("ONESA_BATCH_SIZE", 50, 1, 100),
    maxRows: bounded("ONESA_MAX_QUEUE_ROWS", 10000, 10, 1000000),
    retentionHours: bounded("ONESA_RETENTION_HOURS", 168, 1, 720),
    timeoutMs: bounded("ONESA_TIMEOUT_MS", 10000, 100, 30000),
    maxAttempts: bounded("ONESA_MAX_ATTEMPTS", 12, 1, 50),
  };
}
export type Config = NonNullable<ReturnType<typeof integrationConfig>>;
