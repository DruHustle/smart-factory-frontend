/** mqtt-topic-v1: transport encoding only; payload and inventory IDs stay canonical. */
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export function encodeMqttLevel(identity: string): string {
  if (!identifier.test(identity))
    throw Error("Invalid canonical MQTT identity");
  return identity.replaceAll(".", "%2E");
}
export function decodeMqttLevel(level: string): string {
  const identity = level.replace(/%2e/gi, ".");
  if (!identifier.test(identity)) throw Error("Invalid MQTT topic identity");
  return identity;
}
export function mqttTopic(
  site: string,
  line: string,
  device: string,
  kind: "telemetry" | "heartbeat" | "commands" | "control-ack",
): string {
  const value = [
    "factory",
    ...[site, line, device].map(encodeMqttLevel),
    kind,
  ].join("/");
  if (value.length > 255)
    throw Error("Encoded MQTT topic exceeds the broker's 255-byte route bound");
  return value;
}
