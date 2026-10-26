import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
const cls = "block w-full rounded border bg-background p-2 text-sm";
const json = (v: unknown) => JSON.stringify(v, null, 2);
export default function SecurityAdministration({
  sources,
  posture,
  canAdmin,
  canEngineer,
  onDone,
  onError,
}: {
  sources: any;
  posture: any;
  canAdmin: boolean;
  canEngineer: boolean;
  onDone: (v: string) => void;
  onError: (v: string) => void;
}) {
  const [sourceId, setSourceId] = useState(""),
    [scope, setScope] = useState("application:"),
    [raw, setRaw] = useState(""),
    [ndjson, setNdjson] = useState(false),
    [pem, setPem] = useState(""),
    [endpoint, setEndpoint] = useState(""),
    [mode, setMode] = useState<"live" | "simulated" | "replay">("simulated"),
    [run, setRun] = useState(""),
    [namespace, setNamespace] = useState(""),
    [assetRef, setAssetRef] = useState(""),
    [componentRef, setComponentRef] = useState(""),
    [installed, setInstalled] = useState(""),
    [days, setDays] = useState(30),
    [reason, setReason] = useState(""),
    [reportId, setReportId] = useState("");
  const success = () => onDone("Reviewed security change saved.");
  const fail = (e: { message: string }) => onError(e.message);
  const imported = trpc.security.importEvidence.useMutation({
    onSuccess: (r) =>
      onDone(
        `${r.accepted.length} event receipts stored; identical retries remain idempotent.`,
      ),
    onError: fail,
  });
  const certificate = trpc.security.certificate.useMutation({
    onSuccess: success,
    onError: fail,
  });
  const mapping = trpc.security.mapIdentity.useMutation({
    onSuccess: success,
    onError: fail,
  });
  const retention = trpc.security.retention.useMutation({
    onSuccess: success,
    onError: fail,
  });
  const retryReport = trpc.security.retryReport.useMutation({
    onSuccess: success,
    onError: fail,
  });
  const retry = trpc.security.retryOutbox.useMutation({
    onSuccess: success,
    onError: fail,
  });
  const outbox = trpc.security.outbox.useQuery(undefined, {
    enabled: canAdmin,
  });
  const capture = trpc.security.captureHealth.useQuery(undefined, {
    enabled: canAdmin,
  });
  const report = trpc.security.report.useQuery(
    { id: reportId },
    { enabled: !!reportId },
  );
  const target = () => ({
    kind: scope.split(":")[0] as "asset" | "device" | "application",
    id: scope.split(":")[1] ? Number(scope.split(":")[1]) : null,
  });
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      {canEngineer && (
        <Card>
          <CardHeader>
            <CardTitle>Reviewed evidence and public certificates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label>
              Configured import source
              <select
                aria-label="Evidence file source"
                className={cls}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">Choose source</option>
                {sources?.items
                  .filter((s: any) => !s.system_key && !s.is_demo && s.active)
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-sm">
              Source namespace, mode, event types and reviewed identities are
              enforced on every imported event. This user action never takes
              authority from file fields.
            </p>
            <label>
              JSON or NDJSON evidence file
              <Input
                aria-label="Security evidence file"
                type="file"
                accept=".json,.ndjson,.jsonl"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 1048576)
                    return onError("Evidence files are limited to 1 MiB.");
                  setRaw(await f.text());
                  setNdjson(/\.(ndjson|jsonl)$/i.test(f.name));
                }}
              />
            </label>
            <Textarea
              aria-label="Security evidence JSON or NDJSON"
              rows={5}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={ndjson}
                onChange={(e) => setNdjson(e.target.checked)}
              />
              NDJSON, one event per line
            </label>
            <Button
              disabled={!sourceId || !raw || imported.isPending}
              onClick={() => imported.mutate({ sourceId, raw, ndjson })}
            >
              Import reviewed evidence
            </Button>
            <details>
              <summary className="cursor-pointer">
                Observe a supplied public certificate
              </summary>
              <div className="space-y-2 pt-3">
                <Input
                  aria-label="Certificate connection reference"
                  placeholder="Already configured connection reference"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
                <Textarea
                  aria-label="Public certificate PEM"
                  placeholder="-----BEGIN CERTIFICATE-----"
                  rows={5}
                  value={pem}
                  onChange={(e) => setPem(e.target.value)}
                />
                <select
                  aria-label="Certificate evidence mode"
                  className={cls}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  {["live", "simulated", "replay"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <Input
                  aria-label="Certificate scenario or replay run"
                  placeholder="Required for simulated/replay"
                  value={run}
                  onChange={(e) => setRun(e.target.value)}
                />
                <p className="text-xs">
                  Only the supplied public certificate is parsed. Private keys
                  are rejected. No connection or URL is fetched; chain trust
                  remains unverified.
                </p>
                <Button
                  disabled={
                    !sourceId || !endpoint || !pem || certificate.isPending
                  }
                  onClick={() =>
                    certificate.mutate({
                      sourceId,
                      endpointRef: endpoint,
                      pem,
                      mode,
                      runId: run || undefined,
                    })
                  }
                >
                  Observe public certificate
                </Button>
              </div>
            </details>
          </CardContent>
        </Card>
      )}
      {canAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Reviewed external identity mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Choose the source above. Only an explicit registered
              asset/component mapping enables 3D focus. Display names and
              network addresses do not establish identity. Changes affect future
              evidence; existing snapshots retain their original association.
            </p>
            <Input
              aria-label="Mapping namespace"
              placeholder="External asset namespace"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
            />
            <Input
              aria-label="Mapping asset reference"
              placeholder="External asset reference"
              value={assetRef}
              onChange={(e) => setAssetRef(e.target.value)}
            />
            <Input
              aria-label="Mapping component reference"
              placeholder="External component reference (optional)"
              value={componentRef}
              onChange={(e) => setComponentRef(e.target.value)}
            />
            <select
              aria-label="Mapping registered target"
              className={cls}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="application:">This application</option>
              {posture?.items.map((i: any) => (
                <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>
                  {i.kind}: {i.name}
                </option>
              ))}
            </select>
            <Input
              aria-label="Mapping installed component ID"
              placeholder="Installed component UUID (optional, from Equipment view)"
              value={installed}
              onChange={(e) => setInstalled(e.target.value)}
            />
            <Button
              disabled={
                !sourceId || !namespace || !assetRef || mapping.isPending
              }
              onClick={() =>
                mapping.mutate({
                  sourceId,
                  namespace,
                  assetRef,
                  componentRef: componentRef || null,
                  target: target(),
                  installedComponentId: installed || undefined,
                })
              }
            >
              Save reviewed identity mapping
            </Button>
            {sources?.mappings.map((m: any) => (
              <p key={m.id} className="text-xs">
                {m.namespace}/{m.asset_ref}/{m.component_ref || "whole asset"} →{" "}
                {json(m.target)} · component{" "}
                {m.installed_component_id || "none"}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Imported inventory reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!sources?.imports.length && (
            <p>
              No validated inventory reports. Missing software evidence is
              unknown.
            </p>
          )}
          {sources?.imports.map((r: any) => (
            <div key={r.id} className="rounded border p-3 text-sm">
              <p>
                {r.provenance.mode} · {r.producer_version} ·{" "}
                {new Date(r.produced_at).toLocaleString()} ·{" "}
                {r.processing_state} ({r.processing_cursor} candidates
                processed)
              </p>
              <p className="text-xs">
                Original SHA-256 {r.original_sha256} ·{" "}
                {r.last_error ?? "no processing error"}
              </p>
              {canAdmin &&
                ["failed", "quarantined"].includes(r.processing_state) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reason.trim().length < 5 || retryReport.isPending}
                    onClick={() => retryReport.mutate({ id: r.id, reason })}
                  >
                    Retry report analysis
                  </Button>
                )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReportId(r.id)}
              >
                Inspect report {r.id.slice(0, 8)}
              </Button>
            </div>
          ))}
          {report.isLoading && <p role="status">Loading report…</p>}
          {report.error && <p role="alert">{report.error.message}</p>}
          {report.data && (
            <pre
              aria-label="Normalized inventory report"
              className="max-h-96 overflow-auto whitespace-pre-wrap rounded border p-3 text-xs"
            >
              {json(report.data)}
            </pre>
          )}
        </CardContent>
      </Card>
      {canAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Retention and delivery diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Budget: 256 MiB accounted evidence, 200,000 events, 100 reports,
              10,000 findings, 10,000 events per source. Quotas reject new work
              visibly; acknowledged retries remain valid. Investigation
              snapshots and audits are retained within the budget.
            </p>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">
              {json(sources?.limits)}
            </pre>
            <label>
              Future event retention in days
              <Input
                aria-label="Security retention days"
                type="number"
                min={7}
                max={90}
                value={days}
                onChange={(e) => setDays(+e.target.value)}
              />
            </label>
            <Input
              aria-label="Security administration reason"
              placeholder="Reason for retention or retry"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              disabled={reason.trim().length < 5 || retention.isPending}
              onClick={() => retention.mutate({ days, reason })}
            >
              Set future evidence retention
            </Button>
            <p className="text-xs">
              Existing expiry timestamps and investigation evidence remain
              unchanged. Use the audited expired-event purge below to delete
              expired raw observations.
            </p>
            <p className="text-sm">Native capture: {json(capture.data)}</p>
            {outbox.error && (
              <p role="alert">Delivery diagnostics unavailable.</p>
            )}
            {outbox.data?.map((o: any) => (
              <div key={o.id} className="rounded border p-2 text-xs">
                {o.producer} · {o.event_type} ·{" "}
                {o.delivered_at
                  ? "delivered"
                  : o.quarantined_at
                    ? "quarantined"
                    : "pending"}{" "}
                · attempts {o.attempts} · {o.error_code || "no delivery error"}
                {o.quarantined_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reason.trim().length < 5 || retry.isPending}
                    onClick={() => retry.mutate({ id: o.id, reason })}
                  >
                    Retry evidence {o.id.slice(0, 8)}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
