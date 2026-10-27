import { encodeMqttLevel } from "@shared/mqtt-topics";
import { CopyIdentifier } from "./Primitives";
export function MqttTopicHint({ identity }: { identity: string }) {
  let level: string | null = null;
  try {
    level = encodeMqttLevel(identity);
  } catch {}
  if (!level) return null;
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Broker topic identity
      </summary>
      <div className="mt-3 space-y-2">
        <p>
          Use this encoded device level in the MQTT topic. Keep the original
          device ID in the payload.
        </p>
        <CopyIdentifier value={level} />
        <p className="text-xs text-muted-foreground">
          Dots use %2E in site, line and device topic levels. Review the
          complete route and its broker ACL during commissioning; registration
          does not change either.
        </p>
      </div>
    </details>
  );
}
