import { z } from "zod";

/** MQTT delivery is negotiated independently on each publish/subscribe hop. */
export const mqttQosLevel = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export const mqttQosPaths = [
  "deviceToGateway",
  "gatewayToCloud",
  "cloudToGateway",
  "gatewayToDevice",
] as const;
export type MqttQosPath = (typeof mqttQosPaths)[number];
export type MqttQosLevel = z.infer<typeof mqttQosLevel>;

export const mqttQosDesiredSchema = z.object({
  revision: z.number().int().min(1).max(0xffffffff),
  uplink: mqttQosLevel,
  downlink: mqttQosLevel,
}).strict();
export type MqttQosDesired = z.infer<typeof mqttQosDesiredSchema>;

/** Reports must come from the respective participant and refer to this revision. */
export const mqttQosReportSchema = z.object({
  revision: z.number().int().min(1).max(0xffffffff),
  level: mqttQosLevel,
  observedAt: z.iso.datetime(),
}).strict();
export type MqttQosReport = z.infer<typeof mqttQosReportSchema>;

type LinkEvidence = { publisher?: MqttQosReport | null; subscriber?: MqttQosReport | null };
export type MqttQosLinkStatus = {
  requested: MqttQosLevel;
  publisher: MqttQosLevel | null;
  subscriber: MqttQosLevel | null;
  effective: MqttQosLevel | null;
  status: "pending" | "applied" | "mismatch";
};

/** Never turn an unconfirmed, stale or downgraded subscription into an applied claim. */
export function mqttQosLinkStatus(
  desired: MqttQosDesired,
  path: MqttQosPath,
  evidence: LinkEvidence,
  nowMs: number,
  maxAgeMs: number,
): MqttQosLinkStatus {
  const requested = path === "deviceToGateway" || path === "gatewayToCloud"
    ? desired.uplink : desired.downlink;
  const current = (report?: MqttQosReport | null): MqttQosLevel | null => {
    if (!report || report.revision !== desired.revision || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return null;
    const observed = Date.parse(report.observedAt);
    return Number.isFinite(observed) && observed <= nowMs && nowMs - observed <= maxAgeMs ? report.level : null;
  };
  const publisher = current(evidence.publisher);
  const subscriber = current(evidence.subscriber);
  const effective = publisher === null || subscriber === null ? null : Math.min(publisher, subscriber) as MqttQosLevel;
  const status = effective === null ? "pending" : publisher === requested && subscriber! >= requested ? "applied" : "mismatch";
  return { requested, publisher, subscriber, effective, status };
}
