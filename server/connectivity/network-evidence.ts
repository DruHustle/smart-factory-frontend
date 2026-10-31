import { createHash } from "node:crypto";
import type {
  ConnectivityObservation,
  IndustrialConfiguration,
} from "../../shared/industrial-connectivity";
import {
  networkSnapshot,
  type NetworkSnapshot,
} from "../../shared/network-diagnostics";

/** Preserve only measured/discovered facts; capability support is not active timing proof. */
export function connectivityNetworkEvidence(
  configuration: IndustrialConfiguration,
  reports: ConnectivityObservation[],
): NetworkSnapshot | null {
  const connections = new Map(
    configuration.connections
      .filter((c) => c.enabled && (c.mode ?? "live") === "live")
      .map((c) => [c.connectionId, c]),
  );
  const components = new Map<string, NetworkSnapshot["components"][number]>();
  const ports = new Map<
    string,
    { at: string; port: NetworkSnapshot["ports"][number] }
  >();
  const observed: string[] = [];
  for (const report of reports) {
    const connection = connections.get(report.connectionId);
    if (!connection || report.configurationRevision !== configuration.revision)
      continue;
    if (report.fx?.mode === "diagnostics" && report.fx.modelVerified) {
      for (const component of report.fx.components.filter(
        (c) =>
          c.kind === "automation_component" && c.namespaceUri.length <= 240,
      )) {
        const id = `fx:${createHash("sha256").update(`${connection.endpoint}/${component.namespaceUri}/${component.nodeId}`).digest("hex").slice(0, 32)}`;
        components.set(id, {
          id,
          name: component.name,
          endpoint: connection.endpoint,
          namespaceUri: component.namespaceUri,
          modelVersion: "unknown",
          functionalEntities: [],
          health: "unknown",
          monitoring: "unknown",
        });
      }
      observed.push(report.observedAt);
    }
    const tsn = report.tsn;
    if (
      tsn &&
      (!ports.has(tsn.interface) ||
        ports.get(tsn.interface)!.at < tsn.observedAt)
    ) {
      ports.set(tsn.interface, {
        at: tsn.observedAt,
        port: {
          id: `interface:${tsn.interface}`,
          name: tsn.interface,
          link: "unknown",
          clockDomain: tsn.clock.domain ?? null,
          grandmasterId: tsn.clock.grandmasterId ?? null,
          syncState:
            tsn.clock.state === "synchronized"
              ? "locked"
              : tsn.clock.state === "unsynchronized"
                ? "unlocked"
                : "unknown",
          offsetNs:
            tsn.clock.offsetNs != null && Math.abs(tsn.clock.offsetNs) <= 1e12
              ? tsn.clock.offsetNs
              : null,
          timestamping: "unknown",
          features: [],
          scheduleConfigured: tsn.qdiscs.some((q) => q.kind === "taprio"),
          scheduleHardwareVerified: false,
        },
      });
    }
  }
  if (!components.size && !ports.size) return null;
  // An old collector result cannot become fresh just because a later tag batch was received.
  observed.push(...[...ports.values()].map((p) => p.at));
  return networkSnapshot.parse({
    version: 1,
    gatewayId: configuration.gatewayDeviceId,
    observedAt: observed.sort()[0],
    source: "collector",
    components: [...components.values()].slice(0, 128),
    connections: [],
    ports: [...ports.values()].map((p) => p.port).slice(0, 32),
    streams: [],
  });
}
