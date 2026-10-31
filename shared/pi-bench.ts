import type { DemoSandbox } from "./demo-sandbox";
import type { NamedFactoryDraft } from "./named-factory";

export const PI_BENCH_PRESET = "pi-dht11";
export const PI_BENCH_NAME = "Current Pi + DHT11 setup";
type Workspace = Pick<
  DemoSandbox,
  "items" | "factories" | "factoryDeletedRefs"
>;

/** Creation evidence identifies renamed presets without changing the v2 factory schema. */
export function findPiBenchFactory(
  s: Pick<DemoSandbox, "items" | "factories" | "factoryActivity">,
) {
  return s.factories.find((factory) => {
    if (
      s.factoryActivity.some(
        (entry) =>
          entry.factoryId === factory.id &&
          entry.action === "factory.created" &&
          entry.after?.preset === PI_BENCH_PRESET,
      )
    )
      return true;
    // Fresh seeds have no edit history. Their simulated hardware markers also
    // recognize legacy benches and collision-safe identifiers after renaming.
    const refs = new Set(factory.draft.document.placements.map((p) => p.ref));
    const gateway = s.items.find(
      (item) =>
        refs.has(item.ref) &&
        item.kind === "device" &&
        item.serial === "DEMO-TOPOLOGY" &&
        /^pi-edge-01(?:-\d+)?$/.test(item.identifier),
    );
    return (
      !!gateway &&
      s.items.some(
        (item) =>
          refs.has(item.ref) &&
          item.kind === "device" &&
          item.serial === "DEMO-TOPOLOGY" &&
          /^esp32-wrover-01(?:-\d+)?$/.test(item.identifier) &&
          item.gatewayId === gateway.identifier,
      )
    );
  });
}

/** Build an additional simulated floor without replacing any saved inventory. */
export function buildPiBenchPreset(s: Workspace): {
  items: DemoSandbox["items"];
  draft: NamedFactoryDraft;
} {
  if (s.items.length > 498)
    throw Error(
      "The Pi bench needs two available places in the 500-item demo.",
    );
  const used = new Set([
    ...s.items.map((item) => item.ref),
    ...s.factoryDeletedRefs,
  ]);
  const newRef = () => {
    let candidate: string;
    do {
      candidate = `device:${(
        3000000000n +
        BigInt(`0x${crypto.randomUUID().replaceAll("-", "").slice(-13)}`)
      ).toString()}`;
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };
  const distinct = (
    base: string,
    values: string[],
    suffix: (n: number) => string,
  ) => {
    const names = new Set(values.map((value) => value.toLowerCase()));
    let candidate = base;
    for (let n = 2; names.has(candidate.toLowerCase()); n++)
      candidate = base + suffix(n);
    return candidate;
  };
  const identifiers = s.items.map((item) => item.identifier);
  const gatewayId = distinct("pi-edge-01", identifiers, (n) => `-${n}`);
  const sensorId = distinct("esp32-wrover-01", identifiers, (n) => `-${n}`);
  const items: DemoSandbox["items"] = [
    {
      ref: newRef(),
      identifier: gatewayId,
      name: "Raspberry Pi 5 gateway",
      kind: "device",
      itemType: "gateway",
      zone: "Hardware bench",
      model: "Raspberry Pi 5 Model B",
      manufacturer: "Raspberry Pi",
      serial: "DEMO-TOPOLOGY",
      connected: false,
      gatewayId: null,
      custom: false,
      equipmentId: null,
    },
    {
      ref: newRef(),
      identifier: sensorId,
      name: "ESP32 WROVER + DHT11 sensor",
      kind: "device",
      itemType: "edge_device",
      zone: "Hardware bench",
      gatewayId,
      model: "ESP-WROVER-KIT with DHT11",
      manufacturer: "Espressif",
      serial: "DEMO-TOPOLOGY",
      connected: false,
      custom: false,
      equipmentId: null,
    },
  ];
  return {
    items,
    draft: {
      document: {
        name: distinct(
          PI_BENCH_NAME,
          s.factories.map((factory) => factory.draft.document.name),
          (n) => ` (${n})`,
        ),
        width: 4,
        depth: 4,
        zones: [],
        placements: [
          { ref: items[0].ref, x: -0.9, z: 0, rotation: 0, zoneId: null },
          { ref: items[1].ref, x: 0.9, z: 0, rotation: 0, zoneId: null },
        ],
      },
      dimensions: {
        [items[0].ref]: { width: 0.09, depth: 0.06, height: 0.05 },
        [items[1].ref]: { width: 0.18, depth: 0.1, height: 0.06 },
      },
      tags: {
        [items[0].ref]: "Pi gateway",
        [items[1].ref]: "WROVER / DHT11",
      },
    },
  };
}
