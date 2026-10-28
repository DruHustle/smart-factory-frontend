import type { Express } from "express";
import cors from "cors";
import { nativeEvent } from "../security/runtime";

/** Install before every API route, including imports, exports and evidence. */
export function installBrowserOriginPolicy(
  app: Express,
  allowedOrigins: Set<string>,
) {
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
    }),
  );
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
}
