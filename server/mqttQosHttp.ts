import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { ingestWroverQosAck, wroverQosAckSchema, ingestGatewayQosRejection, gatewayQosRejectionSchema } from "./mqttQosStore";

/** Service-only bridge: accepted does not mean a receipt matched a request. */
export function installMqttQosAckRoute(app: Express) {
  app.post("/api/internal/mqtt-qos-ack", async (req, res) => {
    const expectedToken = process.env.INGESTION_API_TOKEN;
    if (!expectedToken) return res.status(503).json({ error: "Ingestion bridge is not configured" });
    const header = req.header("authorization") ?? "";
    const providedToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = Buffer.from(expectedToken), provided = Buffer.from(providedToken);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return res.status(401).json({ error: "Unauthorized service" });
    const device = wroverQosAckSchema.safeParse(req.body);
    const gateway = gatewayQosRejectionSchema.safeParse(req.body);
    if (!device.success && !gateway.success) return res.status(400).json({ error: "Invalid QoS acknowledgement" });
    try {
      const accepted = device.success ? await ingestWroverQosAck(device.data) : await ingestGatewayQosRejection(gateway.data);
      return res.status(202).json({ accepted });
    } catch {
      return res.status(500).json({ error: "QoS acknowledgement could not be stored" });
    }
  });
}
