import { useEffect, useRef, useState } from "react";
import { Lightbulb, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

/** Diagnostics stay separate from verified operational measurements. */
export function WroverControls({ deviceId }: { deviceId: number }) {
  const { user } = useAuth();
  const active = useDocumentActive();
  const enabled =
    user?.access?.workspaceView === "live" && !user?.access?.demoOnly;
  const device = trpc.devices.getById.useQuery(
    { id: deviceId },
    { enabled, refetchInterval: active ? 30000 : false },
  );
  const latest = trpc.readings.getLatest.useQuery(
    { deviceId },
    {
      enabled,
      refetchInterval: active ? 3000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const unverified = trpc.readings.getLatest.useQuery(
    { deviceId, scope: "unknown" },
    {
      enabled,
      refetchInterval: active ? 3000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const pulse = trpc.devices.pulseIndicator.useMutation({
    onSuccess: (result) =>
      toast.success("GPIO18 command sent", {
        description: result.qos === 0
          ? "Sent at QoS 0; delivery and the output state are unconfirmed."
          : "The broker accepted the command; the device has not confirmed the output state.",
      }),
    onError: (error) =>
      toast.error("GPIO18 command failed", { description: error.message }),
  });
  const canEngineer = enabled && !!user?.access?.canEngineer;
  const utils = trpc.useUtils();
  const qos = trpc.devices.wroverQos.useQuery({ id: deviceId }, { enabled: canEngineer, refetchInterval: active ? 5000 : false, refetchIntervalInBackground: false });
  const [uplinkQos, setUplinkQos] = useState<0 | 1 | 2>(1);
  const [downlinkQos, setDownlinkQos] = useState<0 | 1 | 2>(1);
  useEffect(() => {
    if (qos.data) { setUplinkQos(qos.data.uplink); setDownlinkQos(qos.data.downlink); }
  }, [qos.data?.revision]);
  const requestQos = trpc.devices.requestWroverQos.useMutation({
    onSuccess: async () => {
      await utils.devices.wroverQos.invalidate({ id: deviceId });
      toast.success("QoS request sent", { description: "Waiting for the WROVER to confirm the setting." });
    },
    onError: (error) => toast.error("QoS request failed", { description: error.message }),
  });
  const reading =
    unverified.data &&
    (!latest.data || unverified.data.timestamp > latest.data.timestamp)
      ? unverified.data
      : latest.data;
  const signals = reading?.assetSignals as
    | Record<string, number>
    | null
    | undefined;
  const count = signals?.buttonPressCount;
  const [recent, setRecent] = useState(false);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (typeof count !== "number") return;
    const last = previous.current;
    previous.current = count;
    if (last === null || count <= last) return;
    setRecent(true);
    const timer = window.setTimeout(() => setRecent(false), 1500);
    return () => window.clearTimeout(timer);
  }, [count]);
  if (!enabled || device.data?.isDemo) return null;
  const fresh = (timestamp: number | undefined) =>
    timestamp !== undefined &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= 120000;
  const readingFresh = fresh(reading?.timestamp);
  const acquisition = latest.data?.integration?.acquisition as
    | { sensorStatus?: string }
    | undefined;
  const healthy =
    device.data?.observedStatus === "live" &&
    fresh(latest.data?.timestamp) &&
    typeof device.data?.metadata?.gatewayId === "string" &&
    acquisition?.sensorStatus !== "read_error" &&
    latest.data?.integration?.sourceQuality !== "bad";
  const pressed = readingFresh && (signals?.buttonPressed === 1 || recent);
  return (
    <section
      aria-label="WROVER controls and button"
      className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <Lightbulb className="h-5 w-5 text-amber-500" aria-hidden="true" />
        <div>
          <p className="font-semibold">WROVER output</p>
          <p className="text-xs text-muted-foreground">
            GPIO18 · two-second pulse
          </p>
        </div>
        {user?.access?.canOperate && (
          <Button
            size="sm"
            disabled={pulse.isPending || !healthy}
            onClick={() => pulse.mutate({ id: deviceId })}
          >
            {pulse.isPending ? "Sending…" : "Pulse GPIO18"}
          </Button>
        )}
      </div>
      {canEngineer && (
        <div className="flex flex-wrap items-end gap-3" aria-label="WROVER MQTT quality of service">
          <div className="text-sm font-semibold">WROVER MQTT QoS</div>
          {([ ["Uplink", uplinkQos, setUplinkQos], ["Downlink", downlinkQos, setDownlinkQos] ] as const).map(([label, value, setValue]) => (
            <label key={label} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {label}
              <select aria-label={`WROVER ${label.toLowerCase()} QoS`} value={value} onChange={(event) => setValue(Number(event.target.value) as 0 | 1 | 2)} className="h-9 rounded border bg-background px-2 text-sm text-foreground">
                <option value={0}>QoS 0</option><option value={1}>QoS 1</option><option value={2}>QoS 2</option>
              </select>
            </label>
          ))}
          <Button size="sm" disabled={!healthy || qos.isLoading || qos.isError || requestQos.isPending} onClick={() => requestQos.mutate({ id: deviceId, expectedRevision: qos.data?.revision ?? 0, uplink: uplinkQos, downlink: downlinkQos })}>
            {requestQos.isPending ? "Sending…" : "Send QoS"}
          </Button>
          <p className="w-full text-xs text-muted-foreground" role="status">
            {qos.isError ? "QoS settings unavailable." : qos.data && !qos.data.gatewayPolicyCurrent ? "Gateway setting changed; review QoS." : qos.data?.status === "failed" ? "Last request failed; device state is unconfirmed." : qos.data?.status === "rejected" ? "The gateway or WROVER rejected the request." : qos.data?.status === "applied" ? (qos.data.cloudUplink === "ready" ? "WROVER confirmed · cloud subscription ready." : "WROVER confirmed · cloud subscription unconfirmed.") : qos.data ? "Requested setting; device confirmation is pending." : "Device QoS has not been confirmed."}
          </p>
        </div>
      )}
      {typeof count === "number" && (
        <div className="flex items-center gap-3" aria-live="polite">
          <MousePointerClick
            className={`h-5 w-5 ${pressed ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              {!readingFresh
                ? "No recent update"
                : pressed
                  ? "Pressed"
                  : "Released"}
            </p>
            <p className="text-xs text-muted-foreground">
              {reading === unverified.data
                ? "Button signal · unverified source"
                : "Physical button"}{" "}
              · {count} press{count === 1 ? "" : "es"}
            </p>
          </div>
        </div>
      )}
      {user?.access?.canOperate && !healthy && (
        <p className="text-xs text-muted-foreground">
          Control requires a commissioned, healthy device.
        </p>
      )}
    </section>
  );
}
