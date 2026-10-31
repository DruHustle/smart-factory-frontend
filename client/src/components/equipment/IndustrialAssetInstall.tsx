import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { IndustrialModel } from "@shared/industrial-assets";
import { fetchBundledModel } from "./modelDelivery";

/** Reference browsing never writes. Only an authorized, explicit action imports. */
export default function IndustrialAssetInstall({
  model,
}: {
  model: IndustrialModel;
}) {
  const access = trpc.equipment.access.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  if (access.data?.canWrite !== true)
    return (
      <p className="text-xs text-muted-foreground">
        Read-only reference. An engineer or administrator can add this model to
        local equipment.
      </p>
    );
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          const controller = new AbortController();
          pending.current = controller;
          const timer = setTimeout(() => controller.abort(), 60000);
          setBusy(true);
          setNotice("");
          setRevision("");
          try {
            const data = await fetchBundledModel(model, controller.signal);
            const manifest = new TextEncoder().encode(
              JSON.stringify(model.manifest),
            );
            if (manifest.length > 128 * 1024)
              throw new Error("Manifest exceeds 128 KiB budget");
            const prefix = new Uint8Array(4);
            new DataView(prefix.buffer).setUint32(0, manifest.length, true);
            const response = await fetch("/api/equipment/model-import", {
              method: "POST",
              credentials: "same-origin",
              redirect: "error",
              signal: controller.signal,
              headers: {
                "content-type":
                  "application/vnd.smart-factory.model+octet-stream",
              },
              body: new Blob([prefix, manifest, new Uint8Array(data).buffer]),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Model import was not accepted");
            if (!/^local-import:[a-f0-9]{64}$/.test(result.revision))
              throw new Error("Invalid imported model receipt");
            if (!controller.signal.aborted) {
              setRevision(result.revision);
              setNotice(
                "Model added. Create equipment and explicitly map its recorded signals; no telemetry has been invented.",
              );
              await utils.equipment.models.invalidate();
            }
          } catch (error) {
            if (pending.current === controller)
              setNotice(
                controller.signal.aborted
                  ? "Model import timed out or was cancelled. Check local models before retrying."
                  : error instanceof Error
                    ? error.message
                    : "Model import failed",
              );
          } finally {
            clearTimeout(timer);
            if (pending.current === controller) {
              pending.current = null;
              setBusy(false);
            }
          }
        }}
      >
        {busy ? "Verifying and adding model…" : "Add to local models"}
      </Button>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {revision && (
        <Button asChild>
          <Link
            href={`/equipment?modelRevision=${encodeURIComponent(revision)}`}
          >
            Configure equipment and signals
          </Link>
        </Button>
      )}
    </div>
  );
}
