import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
export default function ModelImport() {
  const [file, setFile] = useState<File | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const template = trpc.equipment.template.useQuery();
  const example = () => {
    const t = template.data;
    if (!t) return;
    setText(
      JSON.stringify(
        {
          schemaVersion: "smart-factory-model-1",
          name: "Locally approved model",
          provenance: "Original self-authored geometry",
          license: "MIT",
          units: "m",
          handedness: "right",
          upAxis: "+Y",
          components: t.components,
          bindings: t.bindings,
          maintenanceText: t.maintenanceText ?? null,
        },
        null,
        2,
      ),
    );
  };
  return (
    <details className="rounded border p-4">
      <summary className="cursor-pointer font-medium">
        Import local GLB and component manifest
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          try {
            const manifest = JSON.parse(text);
            const bytes = new TextEncoder().encode(JSON.stringify(manifest));
            if (bytes.length > 128 * 1024)
              throw new Error("Manifest exceeds 128 KiB budget");
            const prefix = new Uint8Array(4);
            new DataView(prefix.buffer).setUint32(0, bytes.length, true);
            const response = await fetch("/api/equipment/model-import", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "content-type":
                  "application/vnd.smart-factory.model+octet-stream",
              },
              body: new Blob([prefix, bytes, file]),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? "Import failed");
            setNotice("Validated model stored locally: " + result.revision);
            await utils.equipment.models.invalidate();
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Import failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted-foreground">
          Self-contained static GLB, up to 20 MiB. Explicit stable component IDs
          and scene mappings are required. External resource URLs, compression
          extensions, animation and skins are unsupported. Import creates a new
          immutable local revision.
        </p>
        <label className="block text-sm">
          GLB file
          <Input
            type="file"
            accept=".glb,model/gltf-binary"
            required
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f && f.size > 20 * 1024 * 1024) {
                setNotice("File exceeds 20 MiB");
                setFile(null);
              } else setFile(f);
            }}
          />
        </label>
        <Button type="button" variant="outline" onClick={example}>
          Use local manifest example
        </Button>
        <label className="block text-sm">
          Mapping manifest JSON
          <Textarea
            className="mt-1 h-72 max-h-96 field-sizing-fixed overflow-y-auto font-mono text-xs"
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Button disabled={busy || !file}>
          Validate and import local model
        </Button>
        {notice && (
          <p role="status" className="break-all text-sm">
            {notice}
          </p>
        )}
      </form>
    </details>
  );
}
