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
    onSuccess: () =>
      toast.success("GPIO18 command sent", {
        description:
          "The broker accepted the command; the device has not confirmed the output state.",
      }),
    onError: (error) =>
      toast.error("GPIO18 command failed", { description: error.message }),
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
