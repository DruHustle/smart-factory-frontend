import { z } from "zod";
import express from "express";
import {
  parseBatch,
  MAX_BODY,
  SecurityError,
  target,
  text,
  identifier,
} from "./contract";
import { sourceCredential, ingest } from "./store";
import { sdk } from "../_core/sdk";
import { demoOnly } from "./router";
import { nativeEvent } from "./runtime";
import { importReport } from "./service";
export function installSecurityBodies(app: express.Express) {
  let bodies = 0;
  app.use(
    [
      "/api/security/evidence",
      "/api/security/observations",
      "/api/security/reports",
    ],
    (req, res, next) => {
      if (bodies >= 4)
        return res
          .status(429)
          .setHeader("Retry-After", "5")
          .json({ error: "security_request_backpressure" });
      bodies++;
      let done = false;
      const release = () => {
        if (!done) {
          done = true;
          bodies--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
  );
  // Before the general JSON parser: limits are enforced on raw bytes first.
  app.use(
    ["/api/security/evidence", "/api/security/observations"],
    express.raw({ type: () => true, limit: MAX_BODY, inflate: false }),
  );
  app.use(
    "/api/security/reports",
    express.raw({ type: () => true, limit: 4 * 1024 * 1024, inflate: false }),
  );
  app.use(
    [
      "/api/security/evidence",
      "/api/security/observations",
      "/api/security/reports",
    ],
    ((error, req, res, next) => {
      res
        .status(error?.status === 413 ? 413 : 422)
        .json({ error: "request_size_or_encoding" });
    }) as express.ErrorRequestHandler,
  );
}
const failure = (e: unknown, res: express.Response) => {
  const error =
    e instanceof SecurityError
      ? e
      : new SecurityError(503, "security_processing_unavailable");
  if (error.status === 429) res.setHeader("Retry-After", "60");
  return res.status(error.status).json({ error: error.code });
};
export function installSecurityRoutes(app: express.Express) {
  app.post(
    ["/api/security/evidence", "/api/security/observations"],
    async (req, res) => {
      try {
        const token = req.get("authorization")?.replace(/^Bearer /, "") ?? "",
          source = await sourceCredential(token);
        const events = parseBatch(
          req.body,
          req.get("content-type")?.includes("ndjson"),
          req.path.endsWith("/observations"),
        );
        return res.status(202).json(await ingest(source.id, events));
      } catch (e) {
        if (e instanceof SecurityError && [401, 403, 422].includes(e.status))
          void nativeEvent(
            e.status === 401
              ? "auth.authentication_failed"
              : e.status === 403
                ? "auth.authorization_denied"
                : "input.rejected",
            e.status === 422
              ? {
                  inputRef: "security-evidence",
                  reasonCode: "INVALID_EVIDENCE",
                }
              : {
                  service: "security-ingestion",
                  outcome: "denied",
                  reasonCode:
                    e.status === 401
                      ? "INVALID_SOURCE_CREDENTIAL"
                      : "SOURCE_SCOPE_DENIED",
                },
            "The security ingestion boundary rejected a request after validation.",
          );
        return failure(e, res);
      }
    },
  );
  app.post("/api/security/reports", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => {
        throw new SecurityError(401, "user_authentication_required");
      });
      if (!["engineer", "admin"].includes(user.role) || demoOnly(user))
        throw new SecurityError(403, "private_engineer_required");
      const sourceId = String(req.query.sourceId ?? "");
      if (!z.uuid().safeParse(sourceId).success)
        throw new SecurityError(422, "source_required");
      let t;
      try {
        t = target.parse({
          kind: req.query.targetKind,
          id: req.query.targetId ? Number(req.query.targetId) : null,
        });
      } catch {
        throw new SecurityError(422, "invalid_report_scope");
      }
      return res.status(201).json(
        await importReport(
          (() => {
            try {
              return new TextDecoder("utf-8", { fatal: true }).decode(req.body);
            } catch {
              throw new SecurityError(422, "invalid_report_encoding");
            }
          })(),
          sourceId,
          t,
          user.id,
          (() => {
            const p = z
              .object({
                mode: z.enum(["live", "simulated", "replay", "unknown"]),
                producerVersion: text(64),
                runId: identifier.optional(),
              })
              .safeParse({
                mode: req.query.mode ?? "unknown",
                producerVersion: req.query.producerVersion ?? "unknown",
                runId: req.query.runId,
              });
            if (!p.success)
              throw new SecurityError(422, "invalid_report_provenance");
            return p.data;
          })(),
        ),
      );
    } catch (e) {
      return failure(e, res);
    }
  });
}
