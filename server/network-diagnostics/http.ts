import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { networkSnapshot } from "../../shared/network-diagnostics";
import { saveNetworkSnapshot } from "./store";

export function networkCollectorAuthorized(
  header: string | undefined,
  expected = process.env.NETWORK_DIAGNOSTICS_INGESTION_TOKEN,
) {
  if (!expected || expected.length < 32 || !header?.startsWith("Bearer "))
    return false;
  const supplied = Buffer.from(header.slice(7)),
    token = Buffer.from(expected);
  return supplied.length === token.length && timingSafeEqual(supplied, token);
}
export function installNetworkDiagnostics(app: Express) {
  app.post("/api/internal/network-diagnostics", async (req, res) => {
    const token = process.env.NETWORK_DIAGNOSTICS_INGESTION_TOKEN;
    const allowed = new Set(
      (process.env.NETWORK_DIAGNOSTICS_ALLOWED_GATEWAYS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (!token || token.length < 32 || !allowed.size)
      return res
        .status(503)
        .json({ error: "Network diagnostics collector is not commissioned" });
    if (!networkCollectorAuthorized(req.header("authorization"), token))
      return res.status(401).json({ error: "Unauthorized collector" });
    const parsed = networkSnapshot.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid or unsupported network diagnostics snapshot" });
    if (!allowed.has(parsed.data.gatewayId))
      return res
        .status(403)
        .json({ error: "This collector is not commissioned for the gateway" });
    if (Date.now() - Date.parse(parsed.data.observedAt) > 300000)
      return res
        .status(422)
        .json({ error: "Collector snapshot is older than five minutes" });
    try {
      return res
        .status(202)
        .json(
          await saveNetworkSnapshot(
            { ...parsed.data, source: "collector" },
            null,
          ),
        );
    } catch (error) {
      const code = (error as { code?: string }).code;
      return res
        .status(code === "CONFLICT" ? 409 : code === "BAD_REQUEST" ? 422 : 503)
        .json({
          error:
            code === "CONFLICT"
              ? "A newer collector snapshot is already stored"
              : "Collector report could not be accepted",
        });
    }
  });
}
