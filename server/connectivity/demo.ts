import {
  industrialConfigurationSchema,
  connectivityObservationSchema,
} from "../../shared/industrial-connectivity";

export const demoConnectivityGateway = {
  gatewayDeviceId: "demo-connectivity-gateway",
  name: "Example factory gateway",
  status: "simulated",
};
/** Authored examples only. No database records, sockets, or commissioned identities. */
export function demoConnectivity() {
  const observedAt = new Date().toISOString();
  const configuration = industrialConfigurationSchema.parse({
    schemaVersion: "industrial-connectivity/v1",
    gatewayDeviceId: demoConnectivityGateway.gatewayDeviceId,
    revision: 1,
    connections: [
      {
        connectionId: "example-pump",
        name: "Pump controller",
        protocol: "modbus_tcp",
        endpoint: "tcp://example-controller.invalid:502",
        enabled: true,
        intervalMs: 1000,
        mode: "simulated",
        scenarioRunId: "connectivity-walkthrough",
        tags: [
          {
            tagId: "inlet-pressure",
            name: "Inlet pressure",
            dataType: "float32",
            unit: "bar",
            source: {
              address: 100,
              registerType: "holding_register",
              unitId: 1,
              count: 2,
            },
          },
          {
            tagId: "outlet-pressure",
            name: "Outlet pressure",
            dataType: "float32",
            unit: "bar",
            source: {
              address: 102,
              registerType: "holding_register",
              unitId: 1,
              count: 2,
            },
          },
          {
            tagId: "running",
            name: "Running",
            dataType: "boolean",
            source: { address: 0, registerType: "coil", unitId: 1, count: 1 },
          },
        ],
      },
      {
        connectionId: "example-fx",
        name: "FX controller and local network",
        protocol: "opcua_fx",
        endpoint: "opc.tcp://example-fx.invalid:4840",
        enabled: true,
        intervalMs: 1000,
        mode: "simulated",
        scenarioRunId: "connectivity-walkthrough",
        tags: [],
        fx: { mode: "diagnostics" },
        tsn: { interface: "eth0", ptpDomain: 0 },
      },
    ],
  });
  const observations = [
    connectivityObservationSchema.parse({
      schemaVersion: "industrial-observation/v1",
      connectionId: "example-pump",
      configurationRevision: 1,
      eventId: "a8761798-d6d1-42c3-b328-c3d52a97af51",
      observedAt,
      state: "connected",
      tags: [
        {
          tagId: "inlet-pressure",
          dataType: "float32",
          value: 2.1,
          quality: "good",
          qualityBasis: "communication",
          unit: "bar",
        },
        {
          tagId: "outlet-pressure",
          dataType: "float32",
          value: 5.7,
          quality: "good",
          qualityBasis: "communication",
          unit: "bar",
        },
        {
          tagId: "running",
          dataType: "boolean",
          value: true,
          quality: "good",
          qualityBasis: "communication",
        },
      ],
    }),
    connectivityObservationSchema.parse({
      schemaVersion: "industrial-observation/v1",
      connectionId: "example-fx",
      configurationRevision: 1,
      eventId: "a8761798-d6d1-42c3-b328-c3d52a97af52",
      observedAt,
      state: "connected",
      tags: [],
      fx: {
        mode: "diagnostics",
        modelVerified: true,
        components: [
          {
            name: "Example automation component",
            nodeId: "s=Example",
            namespaceUri: "http://opcfoundation.org/UA/FX/AC/",
            kind: "automation_component",
          },
        ],
        warnings: [],
        determinism: "unverified",
      },
      tsn: {
        interface: "eth0",
        observedAt,
        clock: {
          state: "synchronized",
          domain: 0,
          grandmasterId: "example-clock",
          offsetNs: 240,
        },
        capabilities: { hardwareTimestamping: "supported" },
        qdiscs: [{ kind: "taprio" }],
        counters: { rxDropped: 0, txDropped: 0 },
        evidence: [
          { source: "pmc", status: "observed" },
          { source: "ethtool", status: "observed" },
          { source: "tc", status: "observed" },
        ],
        determinism: "unverified",
      },
    }),
  ];
  return {
    configuration,
    activeConfiguration: configuration,
    publication: null,
    revision: 1,
    reportedRevision: 1,
    publishedRevision: 1,
    publishedAt: observedAt,
    lastReceivedAt: observedAt,
    lastError: null,
    observations,
    canConfigure: false,
    synthetic: true,
    assets: [] as Array<{ assetId: string; name: string }>,
    probe: null,
  };
}
