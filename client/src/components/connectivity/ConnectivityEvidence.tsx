import { Clock3, Network, Radio } from "lucide-react";
import { Link } from "wouter";
import type { ConnectivityObservation } from "@shared/industrial-connectivity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SampleTime } from "@/components/workspace/Primitives";

const display = (value: string | number | undefined, unit = "") =>
  value === undefined ? "Unknown" : `${value}${unit ? ` ${unit}` : ""}`;

export function ConnectivityEvidence({
  fx,
  tsn,
  gatewayDeviceId,
}: {
  fx?: ConnectivityObservation["fx"];
  tsn?: ConnectivityObservation["tsn"];
  gatewayDeviceId: string;
}) {
  if (!fx && !tsn) return null;
  return (
    <div
      className="grid min-w-0 gap-4 xl:grid-cols-2"
      aria-label="FX and TSN evidence"
    >
      {fx && (
        <section
          className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
          aria-labelledby="connectivity-fx-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="connectivity-fx-title"
              className="flex items-center gap-2 font-semibold"
            >
              <Radio className="size-4" />
              OPC UA FX evidence
            </h3>
            <Badge variant="outline">
              {fx.mode === "diagnostics"
                ? "Model diagnostics"
                : "UDP UADP observer"}
            </Badge>
          </div>
          <p className="text-sm">
            {fx.modelVerified
              ? "FX information model identified"
              : "FX information model not verified"}
          </p>
          {fx.mode === "udp_uadp" && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["Publisher", fx.publisherId],
                  ["Writer group", fx.writerGroupId],
                  ["Data set writer", fx.dataSetWriterId],
                  ["Received messages", fx.receivedMessages],
                  ["Dropped messages", fx.droppedMessages],
                  ["Last sequence", fx.lastSequenceNumber],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all font-medium tabular-nums">
                    {display(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {fx.components.length > 0 ? (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {fx.components.map((component) => (
                <li
                  key={`${component.namespaceUri}|${component.nodeId}`}
                  className="min-w-0 rounded-lg bg-muted/40 p-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="break-words font-medium">
                      {component.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {component.kind.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {component.nodeId}
                  </p>
                  {component.state && (
                    <p className="mt-1 text-xs">
                      Reported state: {component.state}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              No FX model components were reported in this observation.
            </p>
          )}
          {fx.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
              <p className="font-medium">Collector findings</p>
              <ul className="mt-1 list-inside list-disc break-all">
                {fx.warnings.map((warning, i) => (
                  <li key={`${warning}-${i}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Read-only discovery and observation. Connection establishment, FX
            conformance and deterministic timing remain separate qualification
            steps.
          </p>
        </section>
      )}
      {tsn && (
        <section
          className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
          aria-labelledby="connectivity-tsn-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="connectivity-tsn-title"
              className="flex items-center gap-2 font-semibold"
            >
              <Clock3 className="size-4" />
              TSN and clock evidence
            </h3>
            <Badge variant="outline">{tsn.interface}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Reported clock:{" "}
              <strong className="font-semibold">{tsn.clock.state}</strong>
            </span>
            <SampleTime value={tsn.observedAt} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {(
              [
                ["PTP domain", display(tsn.clock.domain)],
                ["Grandmaster", display(tsn.clock.grandmasterId)],
                ["Clock offset", display(tsn.clock.offsetNs, "ns")],
                ["Mean path delay", display(tsn.clock.meanPathDelayNs, "ns")],
                [
                  "Hardware timestamping",
                  tsn.capabilities.hardwareTimestamping,
                ],
                [
                  "PTP hardware clock",
                  display(tsn.capabilities.ptpHardwareClock),
                ],
                ["Receive drops", display(tsn.counters.rxDropped)],
                ["Transmit drops", display(tsn.counters.txDropped)],
                ["Receive errors", display(tsn.counters.rxErrors)],
                ["Transmit errors", display(tsn.counters.txErrors)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-medium tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium">Reported traffic disciplines</p>
            <div className="flex flex-wrap gap-1.5">
              {tsn.qdiscs.length ? (
                tsn.qdiscs.map((qdisc, index) => (
                  <Badge key={`${qdisc.kind}-${index}`} variant="outline">
                    {qdisc.kind}
                    {qdisc.handle ? ` · ${qdisc.handle}` : ""}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  None reported
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {tsn.evidence.map((evidence, index) => (
              <span key={`${evidence.source}-${index}`}>
                {evidence.source}: {evidence.status}
              </span>
            ))}
          </div>
          <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed">
            Deterministic timing is unverified. A synchronized clock or a
            configured traffic schedule alone does not establish an end-to-end
            deadline.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/network?tab=timing&gateway=${encodeURIComponent(gatewayDeviceId)}`}
            >
              <Network className="mr-1.5 size-4" />
              Open FX & TSN diagnostics
            </Link>
          </Button>
        </section>
      )}
    </div>
  );
}
