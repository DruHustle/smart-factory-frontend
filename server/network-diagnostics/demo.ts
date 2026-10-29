import {
  networkSnapshot,
  type NetworkView,
} from "../../shared/network-diagnostics";

/** Authored simulation, independent of production configuration and data. */
export function demoNetwork(scenario = "normal"): NetworkView {
  const end = Date.parse("2026-10-28T12:00:00Z"),
    at = new Date(end).toISOString();
  const clockLoss = scenario === "clock-loss",
    late = scenario === "late-delivery";
  const definitions = [
    [
      "assembly",
      "Assembly PLC",
      "showcase.fx.plc:assembly",
      "Line coordination",
    ],
    ["robot", "Robot controller", "showcase.fx.robot:01", "Pick and place"],
    [
      "process",
      "Process PLC",
      "showcase.fx.plc:process",
      "Pump and vessel control",
    ],
    [
      "packaging",
      "Packaging PLC",
      "showcase.fx.plc:packaging",
      "Packaging sequence",
    ],
  ];
  const components = definitions.map(([id, name, deviceIdentifier, fn]) => ({
    id,
    name,
    deviceIdentifier,
    namespaceUri: "http://opcfoundation.org/UA/FX/AC/",
    modelVersion: "1.00.04",
    health:
      late && id === "robot" ? ("warning" as const) : ("healthy" as const),
    monitoring:
      id === "process" ? ("one-end" as const) : ("both-ends" as const),
    functionalEntities: [
      {
        id: `${id}:function`,
        name: fn,
        inputs: ["LineReady", "Enable"],
        outputs: ["State", "CycleCounter"],
      },
    ],
  }));
  const connections = [
    ["assembly", "robot"],
    ["process", "assembly"],
    ["assembly", "packaging"],
  ].map(([publisher, subscriber], n) => ({
    id: `stream-${n + 1}`,
    name: `${components.find((c) => c.id === publisher)!.name} → ${components.find((c) => c.id === subscriber)!.name}`,
    publisher,
    subscriber,
    publisherEntity: `${publisher}:function`,
    subscriberEntity: `${subscriber}:function`,
    transport: "uadp-udp" as const,
    state:
      clockLoss || (late && n === 0)
        ? ("error" as const)
        : ("operational" as const),
    publishingIntervalUs: 1000,
    deadlineUs: 800,
    diagnostics: clockLoss
      ? ["Simulated clock synchronisation lost; one-way latency is unavailable"]
      : late && n === 0
        ? [
            "Simulated background traffic exceeded the configured example deadline",
          ]
        : [],
  }));
  const snapshot = networkSnapshot.parse({
    version: 1,
    gatewayId: "showcase.gateway:network",
    observedAt: at,
    source: "collector",
    components,
    connections,
    ports: [1, 2, 3].map((n) => ({
      id: `port-${n}`,
      name: `TSN switch · port ${n}`,
      link: "up",
      clockDomain: 0,
      grandmasterId: "SIM-GM-001",
      syncState: clockLoss ? "unlocked" : "locked",
      offsetNs: clockLoss ? null : n * 45,
      timestamping: "hardware",
      features: ["802.1AS", "802.1Qbv", "802.1Qci"],
      scheduleConfigured: true,
      scheduleHardwareVerified: false,
    })),
    streams: connections.map((connection, index) => ({
      id: connection.id,
      connectionId: connection.id,
      name: connection.name,
      publisherPortId: `port-${index === 1 ? 3 : 1}`,
      subscriberPortId: `port-${index === 0 ? 2 : index === 1 ? 1 : 3}`,
      packets: 60000,
      lost: late && index === 0 ? 8 : 0,
      deadlineMisses: clockLoss ? null : late && index === 0 ? 12 : 0,
      latencyEvidence: clockLoss ? "unavailable" : "synchronized-hardware",
      samples: Array.from({ length: 30 }, (_, n) => ({
        at: new Date(end - (29 - n) * 10000).toISOString(),
        offsetNs: clockLoss ? null : 80 + Math.sin(n / 3) * 25,
        jitterUs:
          3 + Math.abs(Math.sin(n / 4)) * (late && index === 0 ? 180 : 4),
        latencyUs: clockLoss
          ? null
          : 135 +
            Math.sin(n / 3) * 20 +
            (late && index === 0 && n > 18 && n < 24 ? 850 : 0),
      })),
    })),
  });
  return {
    synthetic: true,
    scenario,
    snapshots: [snapshot],
    importedAt: null,
    stale: false,
    provenance: "authored-simulation",
  };
}
