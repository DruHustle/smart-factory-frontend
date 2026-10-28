import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { recordLoginAttempt, pruneExpiredLoginAttempts } from "../db";

type Store = {
  record: typeof recordLoginAttempt;
  prune: typeof pruneExpiredLoginAttempts;
};

/** Match the Express tRPC adapter's final path segment and single decoding pass. */
function procedures(path: string) {
  try {
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)).split(",");
  } catch {
    return [];
  }
}

export function createLoginRateLimit(
  store: Store = {
    record: recordLoginAttempt,
    prune: pruneExpiredLoginAttempts,
  },
): RequestHandler {
  let lastPrune = 0;
  return async (req, res, next) => {
    const paths = procedures(req.path);
    if (
      req.method !== "POST" ||
      !paths.some(
        (path) => path === "auth.login" || path === "auth.changePassword",
      )
    )
      return next();

    // The client batches even a single mutation. Do not allow multiple credential
    // checks to share one IP/account charge, including mixed-procedure batches.
    // tRPC reads the first URLSearchParams value. Express's query parser turns
    // duplicate keys into arrays, which must not bypass account accounting.
    const batched =
      new URL(req.originalUrl, "http://localhost").searchParams.get("batch") ===
      "1";
    const reject = (status: 400 | 429 | 503, message: string) => {
      const code =
        status === 429
          ? "TOO_MANY_REQUESTS"
          : status === 503
            ? "SERVICE_UNAVAILABLE"
            : "BAD_REQUEST";
      const error = {
        error: {
          json: {
            message,
            code: status === 429 ? -32029 : status === 503 ? -32003 : -32600,
            data: { code, httpStatus: status },
          },
        },
      };
      return res.status(status).json(batched ? paths.map(() => error) : error);
    };
    if (paths.length !== 1)
      return void reject(
        400,
        "Submit one sign-in or password change at a time.",
      );

    const now = Date.now();
    if (now - lastPrune > 60_000) {
      lastPrune = now;
      try {
        await store.prune(new Date(now));
      } catch {
        console.error("[Authentication] Could not prune shared login limits");
      }
    }
    const input = batched ? req.body?.[0]?.json : req.body?.json;
    const email =
      typeof input?.email === "string"
        ? input.email.trim().toLowerCase().slice(0, 320)
        : "";
    const identifiers = [
      `ip:${req.ip || "unknown"}`,
      ...(email ? [`email:${email}`] : []),
    ];
    try {
      const windows = await Promise.all(
        identifiers.map(async (identifier) => ({
          ...(await store.record(
            createHash("sha256").update(identifier).digest("hex"),
            15 * 60_000,
          )),
          limit: identifier.startsWith("ip:") ? 100 : 20,
        })),
      );
      const blocked = windows.find((window) => window.attempts > window.limit);
      if (blocked) {
        res.setHeader(
          "Retry-After",
          String(
            Math.max(1, Math.ceil((blocked.resetAt.getTime() - now) / 1000)),
          ),
        );
        return void reject(429, "Too many login attempts. Try again later.");
      }
      next();
    } catch {
      console.error("[Authentication] Shared login limit is unavailable");
      reject(503, "Authentication is temporarily unavailable");
    }
  };
}
