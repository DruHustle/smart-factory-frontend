import { installRequestMetrics } from "../infrastructure/metrics";
import { installRecoveryEvidence, startInfrastructureMonitoring } from "../infrastructure/store";
import { requestedDataWorkspace } from "../../shared/data-workspace";
import { installOperatingEvidence } from "../operatingEvidence";
import { getRuntimeContract } from "../runtimeContract";
import { TelemetryPolicyError } from "../observationPolicy";
import { installSecurityBodies, installSecurityRoutes } from "../security/http";
import { startSecurity, nativeEvent } from "../security/runtime";
import "dotenv/config";
import { installEquipmentFiles } from "../equipment/files";
import { startOnesaWorker } from "../onesa/worker";
import { installArtifactRoutes } from "../onesa/artifacts";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { wsManager } from "../websocket";
import * as db from "../db";
import { initializeDemoAccounts } from "../initDemoAccounts";
import { demoAccountsEnabled } from "../../shared/demo-accounts";
import {
  demonstrationOnly,
  DEMONSTRATION_READ_ONLY,
} from "../../shared/access-policy";

// Import the cors package
import cors from "cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { aasRepositoryProxy } from "../aasRepositoryProxy";
import { edgeTagMappingsSchema } from "../../shared/edge-configuration";
import { sdk } from "./sdk";
import {
  importAasxPackage,
  rollbackAasxImport,
  publishEdgeConfiguration,
  AasProvisioningRequestError,
  type AasxImportResult,
} from "../aasProvisioningClient";
import { buildAutomationMlPlantLayout } from "../automationml";
import { edgeTelemetrySchema, telemetryRejection } from "../telemetrySchema";

const edgeHeartbeatSchema = z
  .object({
    transportRetained: z.boolean().optional(),
    transportRetainVerified: z.boolean().optional(),
    deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/),
    timestamp: z.number().int().positive().max(8_640_000_000_000_000),
    status: z.enum(["online", "offline"]),
  })
  .strict();

let lastLoginWindowPrune = 0;
let activeAasxUploads = 0;

function configureTrustedProxies(app: express.Express) {
  const configured = process.env.TRUST_PROXY?.trim();
  if (!configured) {
    app.set("trust proxy", false);
    return;
  }

  const hopCount = Number(configured);
  if (Number.isInteger(hopCount) && hopCount >= 0) {
    app.set("trust proxy", hopCount);
    return;
  }

  const trustedRanges = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!trustedRanges.length)
    throw new Error(
      "TRUST_PROXY must be a hop count or a comma-separated list of trusted proxy IP ranges",
    );
  // Never trust every X-Forwarded-* sender by default. Production operators
  // must list the addresses/ranges of the actual reverse proxies.
  app.set("trust proxy", trustedRanges);
}

function isPostgresUniqueViolation(error: unknown) {
  let candidate = error;
  for (
    let depth = 0;
    depth < 5 && candidate && typeof candidate === "object";
    depth += 1
  ) {
    if ("code" in candidate && candidate.code === "23505") return true;
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
}

async function loginRateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const now = Date.now();
  if (now - lastLoginWindowPrune > 60_000) {
    lastLoginWindowPrune = now;
    try {
      await db.pruneExpiredLoginAttempts(new Date(now));
    } catch (error) {
      console.error(
        "[Authentication] Could not prune shared login limits:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  const email =
    typeof req.body?.json?.email === "string"
      ? req.body.json.email.trim().toLowerCase()
      : "";
  const identifiers = [
    `ip:${req.ip || "unknown"}`,
    ...(email ? [`email:${email}`] : []),
  ];
  try {
    const windows = await Promise.all(
      identifiers.map(async (identifier) => {
        const key = createHash("sha256").update(identifier).digest("hex");
        return {
          ...(await db.recordLoginAttempt(key, 15 * 60_000)),
          limit: identifier.startsWith("ip:") ? 100 : 20,
        };
      }),
    );

    const blocked = windows.find((window) => window.attempts > window.limit);
    if (blocked) {
      res.setHeader(
        "Retry-After",
        String(
          Math.max(1, Math.ceil((blocked.resetAt.getTime() - now) / 1000)),
        ),
      );
      return res
        .status(429)
        .json({ error: "Too many login attempts. Try again later." });
    }
    return next();
  } catch (error) {
    console.error(
      "[Authentication] Shared login limit is unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return res
      .status(503)
      .json({ error: "Authentication is temporarily unavailable" });
  }
}

async function startServer() {
  const app = express();
  installRequestMetrics(app);
  app.disable("x-powered-by");
  configureTrustedProxies(app);
  const server = createServer(app);
  let bootstrapReady = false;
  const stopSecurity = startSecurity();
  server.on("close", stopSecurity);
  server.on("upgrade", (_request, socket) => {
    if (!bootstrapReady)
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
      );
  });

  app.get("/health/live", (_req, res) =>
    res.status(200).json({ status: "live" }),
  );
  app.get("/health/ready", async (_req, res) => {
    if (!bootstrapReady)
      return res
        .status(503)
        .json({ status: "not-ready", dependency: "startup" });
    try {
      await db.checkDatabaseHealth();
      if (!wsManager.isReady())
        return res
          .status(503)
          .json({ status: "not-ready", dependency: "redis" });
      if (process.env.BACKEND_DEPLOYMENT_MODE === "render-bundle") {
        const servicePorts = (
          process.env.BUNDLE_SERVICE_PORTS ?? "3102,3103,3104,3105,3106"
        )
          .split(",")
          .map(Number)
          .filter((port) => Number.isInteger(port) && port > 0);
        const services = await Promise.all(
          servicePorts.map(async (port) => {
            try {
              return (
                await fetch(`http://127.0.0.1:${port}/health/ready`, {
                  signal: AbortSignal.timeout(4000),
                })
              ).ok;
            } catch {
              return false;
            }
          }),
        );
        if (services.some((ready) => !ready))
          return res
            .status(503)
            .json({ status: "not-ready", dependency: "backend-services" });
      }
      return res.status(200).json({ status: "ready" });
    } catch {
      return res.status(503).json({ status: "not-ready" });
    }
  });
  app.get("/health", async (_req, res) => {
    try {
      await db.checkDatabaseHealth();
      return res.status(200).json({ status: "ready" });
    } catch {
      return res.status(503).json({ status: "not-ready" });
    }
  });

  // The API does not accept bulk file uploads. Keep JSON request bodies bounded.
  installSecurityBodies(app);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "100kb", extended: true }));

  app.use("/api", (_req, res, next) => {
    if (!bootstrapReady)
      return res
        .status(503)
        .json({ error: "Application startup is in progress" });
    next();
  });

  app.get("/api/runtime/contract", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const contract = await getRuntimeContract();
      return res.status(contract.schema.ready ? 200 : 503).json(contract);
    } catch {
      return res
        .status(503)
        .json({ error: "Runtime identity or schema verification unavailable" });
    }
  });

  installOperatingEvidence(app);
  installRecoveryEvidence(app);
  installArtifactRoutes(app);

  // Export only to engineers and admins; the generated file contains the
  // asset hierarchy and identity fields already visible in the dashboard.
  app.get("/api/assets/export/automationml", async (req, res) => {
    let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication is required" });
    }
    if (user.passwordChangeRequired)
      return res.status(403).json({
        error:
          "Change your temporary password before opening the factory workspace",
      });
    if (user.role !== "engineer" && user.role !== "admin")
      return res.status(403).json({ error: "Requires engineer access" });
    if (
      demonstrationOnly(user) ||
      requestedDataWorkspace(req.headers.cookie) === "demo"
    )
      return res.status(403).json({ error: DEMONSTRATION_READ_ONLY });

    try {
      const xml = buildAutomationMlPlantLayout(await db.getAssets());
      return res
        .status(200)
        .setHeader("Content-Type", "application/xml; charset=utf-8")
        .setHeader(
          "Content-Disposition",
          'attachment; filename="smart-factory.aml"',
        )
        .send(xml);
    } catch (error) {
      console.error(
        "[AutomationML export] Failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return res.status(500).json({ error: "AutomationML export failed" });
    }
  });

  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
    }),
  );

  // Cookie-authenticated mutations require an allowed browser origin. Requests
  // without Origin remain available to non-browser clients which use bearer auth.
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    if (!origin) return next();
    const sameOrigin = origin === `${req.protocol}://${req.get("host")}`;
    if (sameOrigin || allowedOrigins.has(origin)) return next();
    void nativeEvent(
      "auth.authorization_denied",
      {
        service: "browser-origin-policy",
        outcome: "denied",
        reasonCode: "ORIGIN_DENIED",
      },
      "A mutation was rejected by the browser origin policy.",
    );
    return res.status(403).json({ error: "Request origin is not allowed" });
  });

  installSecurityRoutes(app);
  installEquipmentFiles(app);

  // Shared PostgreSQL counters enforce the same login limits across replicas.
  app.use("/api/trpc", (req, res, next) => {
    const procedures = req.path.replace(/^\/+/, "").split(",");
    if (
      req.method === "POST" &&
      procedures.some((path) =>
        ["auth.login", "auth.changePassword"].includes(path),
      )
    ) {
      return loginRateLimit(req, res, next);
    }
    return next();
  });

  // Private .NET-to-Node bridge. Credentials are service-only and never returned to the browser.
  app.post("/api/internal/telemetry", async (req, res) => {
    const expectedToken = process.env.INGESTION_API_TOKEN;
    if (!expectedToken)
      return res
        .status(503)
        .json({ error: "Telemetry ingestion bridge is not configured" });
    const authorization = req.header("authorization") ?? "";
    const providedToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(providedToken);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      void nativeEvent(
        "auth.authentication_failed",
        {
          service: "internal-ingestion",
          outcome: "denied",
          reasonCode: "INVALID_SERVICE_CREDENTIAL",
        },
        "An internal ingestion request was rejected by its service credential check.",
      );
      return res.status(401).json({ error: "Unauthorized service" });
    }
    const parsed = edgeTelemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      await nativeEvent(
        "input.rejected",
        { inputRef: "telemetry-ingress", reasonCode: "INVALID_PAYLOAD" },
        "Authorized telemetry ingestion rejected an invalid payload.",
      );
      return res.status(400).json(telemetryRejection(parsed.error));
    }
    const timestamp =
      typeof parsed.data.timestamp === "number"
        ? parsed.data.timestamp
        : Date.parse(parsed.data.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp > Date.now() + 300_000
    ) {
      return res.status(400).json({
        error:
          "Telemetry timestamp must be valid and no more than five minutes in the future",
      });
    }
    try {
      const result = await db.ingestTelemetryByDeviceId({
        ...parsed.data,
        timestamp,
      });
      return res.status(202).json({ status: "accepted", ...result });
    } catch (error) {
      if (error instanceof TelemetryPolicyError)
        return res.status(422).json({
          error: "Telemetry quarantined by source policy",
          reason: error.code,
        });
      console.error("[Telemetry bridge] Persistence unavailable");
      return res
        .status(500)
        .json({ error: "Telemetry could not be persisted" });
    }
  });

  app.post("/api/internal/heartbeat", async (req, res) => {
    const expectedToken = process.env.INGESTION_API_TOKEN;
    if (!expectedToken)
      return res
        .status(503)
        .json({ error: "Heartbeat ingestion bridge is not configured" });
    const authorization = req.header("authorization") ?? "";
    const providedToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(providedToken);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      void nativeEvent(
        "auth.authentication_failed",
        {
          service: "internal-ingestion",
          outcome: "denied",
          reasonCode: "INVALID_SERVICE_CREDENTIAL",
        },
        "An internal ingestion request was rejected by its service credential check.",
      );
      return res.status(401).json({ error: "Unauthorized service" });
    }
    const parsed = edgeHeartbeatSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.timestamp > Date.now() + 300_000) {
      return res.status(400).json({ error: "Invalid heartbeat payload" });
    }
    try {
      const found = await db.recordDeviceHeartbeat(parsed.data);
      return res
        .status(found ? 202 : 404)
        .json(
          found
            ? { status: "accepted" }
            : { error: "Gateway is not registered" },
        );
    } catch (error) {
      console.error("[Heartbeat bridge] Persistence unavailable");
      return res
        .status(500)
        .json({ error: "Heartbeat could not be persisted" });
    }
  });

  // Engineers upload AASX packages through this role-checked streaming boundary.
  // The browser session is never forwarded to DeviceService; only the service token is.
  app.post("/api/assets/import", async (req, res) => {
    let user: Awaited<ReturnType<typeof sdk.authenticateRequest>>;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication is required" });
    }
    if (user.passwordChangeRequired)
      return res.status(403).json({
        error:
          "Change your temporary password before opening the factory workspace",
      });
    if (user.role !== "engineer" && user.role !== "admin")
      return res.status(403).json({ error: "Requires engineer access" });
    if (
      demonstrationOnly(user) ||
      requestedDataWorkspace(req.headers.cookie) === "demo"
    )
      return res.status(403).json({ error: DEMONSTRATION_READ_ONLY });

    const contentType = req.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
      return res
        .status(415)
        .json({ error: "Upload one AASX package as multipart/form-data" });
    }
    if (activeAasxUploads >= 2)
      return res
        .status(429)
        .json({ error: "AASX import capacity is busy; retry shortly" });
    activeAasxUploads += 1;

    // Allow multipart headers and boundaries beyond the 50 MiB package limit;
    // DeviceService validates the extracted file bytes against that limit.
    express.raw({ type: () => true, limit: "51mb" })(
      req,
      res,
      async (parseError) => {
        if (parseError) {
          activeAasxUploads -= 1;
          const status =
            typeof parseError === "object" &&
            parseError &&
            "status" in parseError &&
            typeof parseError.status === "number"
              ? parseError.status
              : 400;
          return res.status(status).json({
            error:
              status === 413
                ? "AASX package exceeds the 50 MB upload limit"
                : "Multipart upload could not be read",
          });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          activeAasxUploads -= 1;
          return res.status(400).json({ error: "AASX package is empty" });
        }

        let imported: AasxImportResult | undefined;
        try {
          imported = await importAasxPackage(req.body, contentType);
          if (imported.assetAdministrationShells.length > 25)
            throw new AasProvisioningRequestError(
              "AASX package contains more than 25 asset shells",
              422,
            );
          const gatewayHeader = req.get("x-edge-gateway-device-pk");
          let connection:
            | {
                mode: "gateway";
                deviceId: number;
                protocol: string;
                endpoint?: string;
                tagMappings: Array<Record<string, unknown>>;
              }
            | { mode: "direct_mqtt"; deviceId: string }
            | undefined;
          const directDeviceId = req.get("x-edge-direct-device-id");
          if (gatewayHeader && directDeviceId)
            throw new AasProvisioningRequestError(
              "Choose either a gateway or direct MQTT connection",
              400,
            );
          if (gatewayHeader) {
            if (!/^\d{1,10}$/.test(gatewayHeader))
              throw new AasProvisioningRequestError(
                "Invalid gateway selection",
                400,
              );
            if (imported.assetAdministrationShells.length !== 1)
              throw new AasProvisioningRequestError(
                "Select a gateway only when the package contains exactly one AAS shell",
                400,
              );
            const protocol = req.get("x-edge-protocol") ?? "";
            if (
              ![
                "mqtt",
                "opcua",
                "modbus_tcp",
                "modbus_rtu",
                "serial",
                "ada031_v4_serial",
              ].includes(protocol)
            )
              throw new AasProvisioningRequestError(
                "Unsupported edge protocol",
                400,
              );
            const endpoint = req.get("x-edge-endpoint") ?? "";
            if (endpoint.length > 512 || /:\/\/[^/]*@/.test(endpoint))
              throw new AasProvisioningRequestError(
                "Machine endpoint must not contain credentials and must be at most 512 characters",
                400,
              );
            const mappingsJson = req.get("x-edge-tag-mappings") ?? "[]";
            if (mappingsJson.length > 8_000)
              throw new AasProvisioningRequestError(
                "Tag mapping profile exceeds the request limit",
                400,
              );
            let mappings: unknown;
            try {
              mappings = JSON.parse(mappingsJson);
            } catch {
              throw new AasProvisioningRequestError(
                "Tag mappings are not valid JSON",
                400,
              );
            }
            const parsedMappings = edgeTagMappingsSchema.safeParse(mappings);
            if (!parsedMappings.success)
              throw new AasProvisioningRequestError(
                "Tag mappings contain unsupported fields or values",
                400,
              );
            connection = {
              mode: "gateway",
              deviceId: Number(gatewayHeader),
              protocol,
              endpoint: endpoint || undefined,
              tagMappings: parsedMappings.data,
            };
          } else if (directDeviceId) {
            if (imported.assetAdministrationShells.length !== 1)
              throw new AasProvisioningRequestError(
                "Direct MQTT assignment is supported when the package contains exactly one AAS shell",
                400,
              );
            if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(directDeviceId))
              throw new AasProvisioningRequestError(
                "Invalid direct MQTT device ID",
                400,
              );
            connection = { mode: "direct_mqtt", deviceId: directDeviceId };
          }
          const savedAssets = await db.importAasxAssets(
            imported.assetAdministrationShells.map((shell) => {
              const references = Array.isArray(shell.submodels)
                ? shell.submodels
                : [];
              const referencedIds = new Set(
                references.flatMap((reference) => {
                  if (!reference || typeof reference !== "object") return [];
                  const keys = (reference as Record<string, unknown>).keys;
                  return Array.isArray(keys)
                    ? keys.flatMap((key) => {
                        if (!key || typeof key !== "object") return [];
                        const item = key as Record<string, unknown>;
                        return item.type === "Submodel" &&
                          typeof item.value === "string"
                          ? [item.value]
                          : [];
                      })
                    : [];
                }),
              );
              return {
                shell,
                submodels: imported!.submodels.filter(
                  (model) =>
                    typeof model.id === "string" && referencedIds.has(model.id),
                ),
                conceptDescriptions: imported!.conceptDescriptions,
              };
            }),
            user.id,
            connection,
            imported.packageId,
          );
          let edgeSync: "not_requested" | "published" | "pending" =
            "not_requested";
          if (connection?.mode === "gateway") {
            const gateway = await db.getDeviceById(connection.deviceId);
            if (gateway) {
              try {
                const published = await publishEdgeConfiguration({
                  schemaVersion: 1,
                  gatewayDeviceId: gateway.deviceId,
                  assets: await db.getGatewayAssetConnections(gateway.deviceId),
                });
                edgeSync = published.published ? "published" : "pending";
              } catch (syncError) {
                console.error(
                  "[AASX import] Edge configuration publish failed:",
                  syncError instanceof Error
                    ? syncError.message
                    : "unknown error",
                );
                edgeSync = "pending";
              }
            }
          }
          return res.status(201).json({
            packageId: imported.packageId,
            assets: savedAssets,
            edgeSync,
          });
        } catch (error) {
          const isDuplicateAsset = isPostgresUniqueViolation(error);
          if (imported) {
            try {
              await rollbackAasxImport(imported);
            } catch (rollbackError) {
              console.error(
                "[AASX import] Compensating cleanup failed:",
                rollbackError instanceof Error
                  ? rollbackError.message
                  : "unknown error",
              );
            }
          }
          if (isDuplicateAsset)
            console.warn(
              "[AASX import] Duplicate shell identifier rejected; the existing asset was preserved.",
            );
          else
            console.error(
              "[AASX import] Import failed with",
              error instanceof Error ? error.name : "an unknown error",
            );
          const status =
            error instanceof AasProvisioningRequestError
              ? error.statusCode
              : isDuplicateAsset
                ? 409
                : 502;
          const message = isDuplicateAsset
            ? "An asset with this AAS shell identifier already exists. Import the package with a new shell identifier to preserve the existing asset."
            : error instanceof Error
              ? error.message
              : "AASX import failed";
          return res.status(status).json({ error: message });
        } finally {
          activeAasxUploads -= 1;
        }
      },
    );
  });

  // The backed AAS service is private. Browser and API clients pass through
  // this authenticated role-checking gateway before any IDTA API operation.
  app.all("/api/aas", aasRepositoryProxy);
  app.all("/api/aas/*", aasRepositoryProxy);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // Development mode uses Vite, production mode uses static files
  if (process.env.API_ONLY === "true") {
    app.get("/", (_req, res) => res.json({ service: "smart-factory-api" }));
    app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
  } else if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  async function initializeRuntime() {
    if (demoAccountsEnabled()) {
      await initializeDemoAccounts().catch((error) =>
        console.warn("[Bootstrap] Demo accounts were not initialized:", error),
      );
    }
    // Fixture creation is an explicit isolated setup operation, never a viewing/startup side effect.

    await wsManager.initialize(server, "/ws", async (request) => {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return false;
      try {
        const { user, session } = await sdk.authenticateRequestWithSession(
          request as express.Request,
        );
        if (
          demonstrationOnly(user) ||
          requestedDataWorkspace(request.headers.cookie) === "demo" ||
          user.passwordChangeRequired ||
          !session.sessionId ||
          !session.expiresAt
        )
          return false;
        return {
          userId: user.id,
          sessionId: session.sessionId,
          expiresAt: session.expiresAt,
          reauthorize: async () => {
            try {
              const current = await sdk.authenticateRequest(
                request as express.Request,
              );
              return (
                !demonstrationOnly(current) && !current.passwordChangeRequired
              );
            } catch {
              return false;
            }
          },
        };
      } catch {
        return false;
      }
    });

    bootstrapReady = true;
    startInfrastructureMonitoring();
    if (process.env.ONESA_ENABLED === "true") startOnesaWorker();
  }

  /**
   * PORT LOGIC:
   * On Render, process.env.PORT is automatically set (e.g., 10000).
   * We must listen on that exact port.
   */
  const port = parseInt(process.env.PORT || "3000");

  // IMPORTANT: Bind to '0.0.0.0' for deployment
  server.listen(port, "0.0.0.0", () => {
    const host =
      process.env.NODE_ENV === "production"
        ? "Render/Production"
        : `http://localhost:${port}`;
    console.log(`Server running on ${host} (Port: ${port})`);
    void initializeRuntime().catch((error) => {
      console.error(
        "Runtime initialization failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      server.close(() => process.exit(1));
    });
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM signal received: closing HTTP server");
    wsManager.shutdown();
    server.close(() => {
      void db.closeDatabase().finally(() => {
        console.log("HTTP server and database pool closed");
        process.exit(0);
      });
    });
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exitCode = 1;
});
