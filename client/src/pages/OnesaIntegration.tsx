import { PageHeader } from "@/components/workspace/Primitives";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { resolveApiBase } from "@/lib/api-base";

export default function OnesaIntegration() {
  const access = trpc.onesa.availability.useQuery();
  if (access.isLoading)
    return <p role="status">Checking integration access…</p>;
  if (!access.data?.privateAccess)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Onesa integration</h1>
        <p>
          Private integration settings require an individual engineering
          account. The public factory demonstration remains available.
        </p>
      </div>
    );
  return <PrivateIntegration />;
}
function PrivateIntegration() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const status = trpc.onesa.status.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const history = trpc.onesa.history.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const [registration, setRegistration] = useState("");
  const [expected, setExpected] = useState(0);
  const [preview, setPreview] = useState<unknown>(null);
  const [mapping, setMapping] = useState<
    Record<string, { equipmentId: string; targetComponentId: string }>
  >({});
  const [notice, setNotice] = useState("");
  const refresh = () => utils.onesa.status.invalidate();
  const register = trpc.onesa.register.useMutation({
    onSuccess: () => {
      setPreview(null);
      setNotice("Source registration saved. Consumer registration is pending.");
      void refresh();
    },
    onError: (e) => setNotice(e.message),
  });
  const previewReg = trpc.onesa.previewRegistration.useMutation({
    onSuccess: (r) => {
      setExpected(r.expectedVersion);
      setPreview(r);
    },
    onError: (e) => setNotice(e.message),
  });
  const previewMap = trpc.onesa.previewMapping.useMutation({
    onSuccess: (r) => setPreview(r),
    onError: (e) => setNotice(e.message),
  });
  const applyMap = trpc.onesa.map.useMutation({
    onSuccess: () => {
      setPreview(null);
      setNotice(
        "Proposed mapping saved. Queued deliveries retain their captured destinations.",
      );
      void refresh();
    },
    onError: (e) => setNotice(e.message),
  });
  const retry = trpc.onesa.retry.useMutation({
    onSuccess: (r) => {
      setNotice(`${r.retried} records authorized for retry; delivery resumed.`);
      void refresh();
    },
    onError: (e) => setNotice(e.message),
  });
  const [pendingMapping, setPendingMapping] = useState<
    Parameters<typeof applyMap.mutate>[0] | null
  >(null);
  const s = status.data;
  const previewRegistration = () => {
    try {
      setPendingMapping(null);
      previewReg.mutate(JSON.parse(registration));
    } catch {
      setNotice("Provide valid source registration JSON.");
    }
  };
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader title="Integrations" description="Optional Onesa exchange for Digital Twin Workspace."/>
      <div className="rounded-lg border p-4 text-sm">
        <strong>Proposed contract · consumer acceptance pending.</strong>
        <p className="mt-1">
          A verified receipt confirms the configured contract receiver. Onesa
          twin registration, 3D selection and assistant evidence access have not
          been verified.
        </p>
      </div>
      {status.isError && (
        <p role="alert">
          Integration status unavailable. Local monitoring continues.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border p-3 text-sm">
          {notice}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            Delivery status{" "}
            <Badge variant="outline">{s?.state ?? "Loading"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Destination", s?.destination ?? "Not configured"],
              ["Authorized workspace", s?.workspaceId ?? "Not configured"],
              ["Schema", s?.schema ?? "Unknown"],
              ["Source connectivity", s?.sourceConnectivity ?? "unknown"],
              ["Outbound transport", s?.transport ?? "No response yet"],
              [
                "Consumer acknowledgment",
                s?.consumerAcknowledgment ?? "No receipt",
              ],
              ["Telemetry freshness", s?.telemetryFreshness ?? "unknown"],
              ["Stream mode", s?.streamMode ?? "unknown"],
              [
                "Last acknowledgment",
                s?.lastAcknowledgment
                  ? new Date(s.lastAcknowledgment).toLocaleString()
                  : "Never",
              ],
              ["Queue backlog", String(s?.backlog ?? 0)],
              ["Quarantined records", String(s?.quarantined ?? 0)],
              ["Discarded captures", String(s?.discarded ?? 0)],
              ["Capture failures", String(s?.captureFailures ?? 0)],
              ["Error", s?.error ?? "None"],
              ["Models and documents", s?.artifactStatus ?? "Not checked"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Destination, workspace and credentials are managed on the server.
            Credential rejection suspends delivery until an administrator
            rotates the secret and resumes.
          </p>
          {!!s?.sourcesRequiringAttention?.length && (
            <div className="space-y-1 text-xs">
              <p className="font-medium">
                Sources requiring mapping/provenance review
              </p>
              {s.sourcesRequiringAttention.map((r, i) => (
                <p key={i} className="break-all">
                  {r.deviceId} · {r.assetId} · {r.reason}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void status.refetch()}>
              Refresh status
            </Button>
            {user?.role === "admin" && (
              <Button
                variant="outline"
                disabled={retry.isPending || s?.state === "Disabled"}
                onClick={() => retry.mutate()}
              >
                Retry quarantined / reconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Equipment and component mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!s?.equipment?.length && (
            <p className="text-sm text-muted-foreground">
              No source equipment registered. Register immutable identities
              before mapping components.
            </p>
          )}
          {s?.equipment?.map((e) => (
            <section
              key={e.equipmentId}
              className="space-y-3 rounded border p-3"
            >
              <h2 className="font-semibold">
                {e.registration.name} <Badge variant="outline">{e.state}</Badge>
              </h2>
              <p className="break-all text-xs text-muted-foreground">
                {e.registration.externalAssetId} · {e.registration.serialNumber}{" "}
                · revision {e.version}
              </p>
              {e.registration.components.map((c) => {
                const key = c.componentId;
                const old = e.mapping?.targets.find(
                  (t) => t.componentId === key,
                );
                const v = mapping[key] ?? {
                  equipmentId: old?.equipmentId ?? "",
                  targetComponentId: old?.targetComponentId ?? "",
                };
                return (
                  <div key={key} className="grid gap-2 sm:grid-cols-3">
                    <p className="self-center text-sm">
                      {c.name}
                      <span className="block break-all text-xs text-muted-foreground">
                        {key}
                      </span>
                    </p>
                    <Input
                      aria-label={`${e.registration.name} ${c.name} Onesa equipment ID`}
                      placeholder="Onesa equipment ID"
                      value={v.equipmentId}
                      onChange={(ev) => {
                        setMapping({
                          ...mapping,
                          [key]: { ...v, equipmentId: ev.target.value },
                        });
                        setPreview(null);
                      }}
                    />
                    <Input
                      aria-label={`${e.registration.name} ${c.name} Onesa component ID`}
                      placeholder="Onesa component ID"
                      value={v.targetComponentId}
                      onChange={(ev) => {
                        setMapping({
                          ...mapping,
                          [key]: { ...v, targetComponentId: ev.target.value },
                        });
                        setPreview(null);
                      }}
                    />
                  </div>
                );
              })}
              <Button
                variant="outline"
                disabled={previewMap.isPending}
                onClick={() => {
                  const m = {
                    equipmentId: e.equipmentId,
                    expectedVersion: e.version,
                    retired: false,
                    targets: e.registration.components.map((c) => {
                      const old = e.mapping?.targets.find(
                        (t) => t.componentId === c.componentId,
                      );
                      const v = mapping[c.componentId] ?? {
                        equipmentId: old?.equipmentId ?? "",
                        targetComponentId: old?.targetComponentId ?? "",
                      };
                      return { componentId: c.componentId, ...v };
                    }),
                  };
                  setPendingMapping(m);
                  previewMap.mutate(m);
                }}
              >
                Preview mapping changes
              </Button>
              <p className="text-xs text-muted-foreground">
                Open in Onesa Digital Twin: unavailable until the consumer
                publishes a verified asset route.
              </p>
            </section>
          ))}
        </CardContent>
      </Card>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Recent classified delivery history
        </summary>
        <div className="mt-3 space-y-2">
          {history.data?.map((e) => (
            <div
              key={e.eventId}
              className="rounded border p-2 text-xs break-words"
            >
              <strong>
                {e.mode} · {e.kind} · {e.state}
              </strong>
              <p>
                {e.observedAt} · quality {e.sourceQuality}
              </p>
              <p>
                {e.metric ?? "Source event"}: {e.value ?? "No reading"} · run{" "}
                {e.scenarioRunId ?? e.replayRunId ?? "live"}
              </p>
              <p className="break-all">
                Equipment {e.equipmentId} · component {e.componentId}
              </p>
            </div>
          ))}
          {!history.data?.length && (
            <p className="text-sm text-muted-foreground">
              No normalized delivery history.
            </p>
          )}
        </div>
      </details>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Register or reconcile source metadata
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Use the versioned source registration schema. Keep UUIDs and
            external AAS identifiers unchanged across display-name, tag and
            model revisions.
          </p>
          <label htmlFor="onesa-registration" className="text-sm">
            Source registration JSON
          </label>
          <Textarea
            id="onesa-registration"
            className="min-h-48 font-mono text-xs"
            value={registration}
            onChange={(e) => {
              setRegistration(e.target.value);
              setPreview(null);
            }}
          />
          <Button
            variant="outline"
            onClick={previewRegistration}
            disabled={previewReg.isPending || s?.state === "Disabled"}
          >
            Preview source registration
          </Button>
        </div>
      </details>
      {preview != null && (
        <Card>
          <CardHeader>
            <CardTitle>Review proposed changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
              {JSON.stringify(preview, null, 2)}
            </pre>
            <Button
              disabled={register.isPending || applyMap.isPending}
              onClick={() => {
                if (pendingMapping) applyMap.mutate(pendingMapping);
                else {
                  try {
                    register.mutate({
                      registration: JSON.parse(registration),
                      expectedVersion: expected,
                    });
                  } catch {
                    setNotice("Invalid registration JSON");
                  }
                }
              }}
            >
              Apply reviewed changes
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Illustrative pump and motor artifacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Two installed instances share one illustrative geometry revision.
            AAS 3.0 JSON/AASX use application extensions; Onesa importer support
            is pending. These are simulated fixtures.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {[
              "equipment.json",
              "mappings.json",
              "model-manifest.json",
              "pump-motor.glb",
              "maintenance.txt",
              "demonstrator.aas.json",
              "demonstrator.aasx",
              "onesa-synthetic-evidence.json",
            ].map((name) => (
              <a
                key={name}
                className="break-all text-primary underline"
                href={`${resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD).replace(/\/$/, "")}/onesa/artifacts/${name}`}
              >
                {name}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
