import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
export default function ModelReplacement({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const models = trpc.equipment.models.useQuery(),
    utils = trpc.useUtils();
  const [revision, setRevision] = useState(""),
    [notice, setNotice] = useState("");
  const preview = trpc.equipment.previewModel.useMutation({
    onError: (e) => setNotice(e.message),
  });
  const apply = trpc.equipment.replaceModel.useMutation({
    onSuccess: () => {
      setNotice(
        "Reviewed model revision applied. Equipment and installed component IDs preserved.",
      );
      preview.reset();
      void utils.equipment.get.invalidate({ id });
    },
    onError: (e) => setNotice(e.message),
  });
  return (
    <details className="rounded border p-4">
      <summary className="cursor-pointer font-medium">
        Review a model replacement
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Replacement must retain every stable template component ID. Explicit
          new scene paths/indices are validated; names are never used to
          identify equipment.
        </p>
        <select
          aria-label="Replacement model revision"
          className="w-full rounded border bg-background p-2"
          value={revision}
          onChange={(e) => {
            setRevision(e.target.value);
            preview.reset();
          }}
        >
          <option value="">Choose local model</option>
          {models.data?.bundledModels.map((m) => (
            <option key={m.revision} value={m.revision}>
              {m.name}
            </option>
          ))}
          {models.data?.imported.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.id.slice(-12)}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!revision || preview.isPending}
          onClick={() =>
            preview.mutate({ id, revision, expectedVersion: version })
          }
        >
          Preview model replacement
        </Button>
        {preview.data && (
          <>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
              {JSON.stringify(preview.data, null, 2)}
            </pre>
            <Button
              disabled={apply.isPending}
              onClick={() =>
                preview.data &&
                apply.mutate({
                  id,
                  revision,
                  expectedVersion: version,
                  reviewToken: preview.data.reviewToken,
                })
              }
            >
              Apply reviewed model replacement
            </Button>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </details>
  );
}
