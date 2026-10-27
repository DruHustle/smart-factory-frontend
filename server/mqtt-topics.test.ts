import { it, expect } from "vitest";
import {
  encodeMqttLevel,
  decodeMqttLevel,
  mqttTopic,
} from "../shared/mqtt-topics";
it("preserves canonical identities while encoding broker-sensitive dots", () => {
  for (const id of [
    "a",
    "sensor.temp:01",
    "legacy_01",
    "sensor-01",
    "a" + ".".repeat(63),
  ]) {
    const topic = mqttTopic("factory-a", "line-1", id, "telemetry");
    expect(decodeMqttLevel(topic.split("/")[3])).toBe(id);
    expect(topic.split("/")[3]).not.toContain(".");
    expect(topic.length).toBeLessThanOrEqual(255);
  }
  expect(mqttTopic("site:01", "line.01", "sensor.temp:01", "commands")).toBe(
    "factory/site:01/line%2E01/sensor%2Etemp:01/commands",
  );
  expect(decodeMqttLevel("legacy.raw:01")).toBe("legacy.raw:01");
  for (const bad of [
    "sensor%2Fbad",
    "sensor%252Ebad",
    "sensor%23bad",
    "sensor%00bad",
  ])
    expect(() => decodeMqttLevel(bad)).toThrow();
  expect(() =>
    mqttTopic(
      "a" + ".".repeat(63),
      "b" + ".".repeat(63),
      "c" + ".".repeat(63),
      "telemetry",
    ),
  ).toThrow("255");
  expect(() => encodeMqttLevel("bad/topic")).toThrow();
});
