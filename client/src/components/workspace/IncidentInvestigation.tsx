import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { EmptyState, SampleTime, Measurement } from "./Primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { observationHref, itemHref } from "@shared/inventory";
export function IncidentInvestigation({
  id,
  returnTo,
  compact = false,
}: {
  id: number;
  returnTo: string;
  compact?: boolean;
}) {
  const { user } = useAuth(),
    active = useDocumentActive(),
    utils = trpc.useUtils(),
    [confirm, setConfirm] = useState<"downtime" | "resolve" | null>(null),
    [note, setNote] = useState(""),
    [cursor, setCursor] = useState(0);
  const event = trpc.alerts.getById.useQuery(
      { id },
      {
        refetchInterval: active ? 30000 : false,
        refetchIntervalInBackground: false,
      },
    ),
    history = trpc.alerts.history.useQuery({ id, after: cursor }),
    assignees = trpc.alerts.assignees.useQuery(undefined, {
      enabled: !!user?.access?.canEngineer,
    });
  const refresh = async () => {
      await Promise.all([
        utils.alerts.invalidate(),
        utils.analytics.getOverview.invalidate(),
      ]);
    },
    success = async (message: string) => {
      toast.success(message);
      setConfirm(null);
      await refresh();
    },
    failure = (e: { message: string }) => toast.error(e.message);
  const ack = trpc.alerts.updateStatus.useMutation({
      onSuccess: () => success("Incident acknowledged"),
      onError: failure,
    }),
    assign = trpc.alerts.assign.useMutation({
      onSuccess: () => success("Assignment updated"),
      onError: failure,
    }),
    downtime = trpc.alerts.startDowntime.useMutation({
      onSuccess: () => success("Confirmed downtime recorded"),
      onError: failure,
    }),
    resolve = trpc.alerts.resolve.useMutation({
      onSuccess: () => success("Incident resolved"),
      onError: failure,
    }),
    addNote = trpc.alerts.addNote.useMutation({
      onSuccess: async () => {
        setNote("");
        setCursor(0);
        await success("Review note recorded");
      },
      onError: failure,
    });
  if (event.isLoading) return <EmptyState title="Loading investigation…" />;
  if (event.error || !event.data)
    return (
      <EmptyState
        error
        title="Incident unavailable"
        description={event.error?.message}
        action={
          <Button variant="outline" onClick={() => void event.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const e = event.data,
    evidence = e.latestEvidenceSnapshot ?? e.evidenceSnapshot,
    owned = e.assignedToId === user?.id || user?.role === "admin",
    canRespond = !!user?.access?.canOperate,
    canManage = !!user?.access?.canEngineer,
    busy =
      ack.isPending ||
      assign.isPending ||
      addNote.isPending ||
      downtime.isPending ||
      resolve.isPending,
    sourceReturn = `/alerts/${id}?return=${encodeURIComponent(returnTo)}`;
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
      aria-label="Incident investigation"
    >
      <div className="space-y-2 border-b p-4">
        <h2
          className={
            compact ? "text-lg font-semibold" : "text-xl font-semibold"
          }
        >
          {e.message}
        </h2>
        <p className="text-xs text-muted-foreground">
          Incident {e.id} · {e.errorCode}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize">
            {e.severity}
          </Badge>
          <Badge
            key={e.status}
            variant="secondary"
            className="workflow-change capitalize"
          >
            {e.status}
          </Badge>
          {e.occurrences > 1 && (
            <Badge variant="outline">{e.occurrences} observations</Badge>
          )}
        </div>
      </div>
      <div
        className={compact ? "space-y-[var(--workspace-gap)] p-4" : "grid gap-6 p-4 lg:grid-cols-2"}
      >
        <div className="space-y-[var(--workspace-gap)]">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Affected source</dt>
              <dd className="mt-1 font-medium">
                <Link
                  className="text-primary underline"
                  href={itemHref(
                    `device:${e.deviceId}`,
                    "overview",
                    sourceReturn,
                  )}
                >
                  {e.deviceName ?? "Observation source"}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Latest observed value
              </dt>
              <dd className="mt-1 font-semibold">
                <Measurement value={e.value} unit={evidence?.unit ?? null} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Configured threshold
              </dt>
              <dd className="mt-1 font-semibold">
                <Measurement
                  value={e.threshold}
                  unit={evidence?.unit ?? null}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Last observation
              </dt>
              <dd className="mt-1">
                <SampleTime
                  value={(e.lastObservedAt ?? e.createdAt).toISOString()}
                  historical
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assigned to</dt>
              <dd className="mt-1">{e.assignedToName ?? "Unassigned"}</dd>
            </div>
          </dl>
          {evidence ? (
            <details className="rounded-md border p-3" open={!compact}>
              <summary className="cursor-pointer text-sm font-medium">
                Preserved observation evidence
              </summary>
              <dl className="mt-3 space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="break-all">
                    {evidence.sourceDeviceId}
                    {evidence.gatewayId
                      ? ` via ${evidence.gatewayId}`
                      : " · direct"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Quality / mode</dt>
                  <dd>
                    {evidence.quality} · {evidence.mode}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Occurred / received (UTC)
                  </dt>
                  <dd>
                    {new Date(evidence.occurredAt).toISOString()}
                    <br />
                    {evidence.receivedAt}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Acquired engineering value
                  </dt>
                  <dd>
                    {evidence.measurement.sourceValue}{" "}
                    {evidence.measurement.sourceUnit ?? "unknown unit"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Conversion / reading
                  </dt>
                  <dd>
                    {evidence.measurement.conversionVersion ?? "Unverified"} ·{" "}
                    {evidence.readingId}
                  </dd>
                </div>
              </dl>
              {e.evidenceSnapshot &&
                e.evidenceSnapshot.readingId !== evidence.readingId && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    First triggering reading {e.evidenceSnapshot.readingId} is
                    preserved separately from the latest repeated observation.
                  </p>
                )}
            </details>
          ) : (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              This legacy event has no preserved reading snapshot or verified
              unit. Inspect the source history; no current physical condition is
              inferred.
            </p>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link
              href={observationHref(
                {
                  ref: `device:${e.deviceId}`,
                  kind: "device",
                  itemType: e.deviceType ?? "sensor",
                },
                sourceReturn,
              )}
            >
              Open source evidence
            </Link>
          </Button>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">
              Exact event identifiers
            </summary>
            <p className="mt-2 break-all">
              device:{e.deviceId} · asset {e.assetId ?? "unattributed"} ·{" "}
              {e.type} · {e.errorCode}
            </p>
          </details>
        </div>
        <div className="space-y-4">
          <h3 className="font-semibold">Investigation timeline</h3>
          <ol className="space-y-3 border-l border-info/40 pl-4 text-sm">
            <li className="relative before:absolute before:-left-[1.35rem] before:top-1.5 before:size-2.5 before:rounded-full before:bg-info">
              <p className="font-medium">Observed event recorded</p>
              <SampleTime value={e.createdAt.toISOString()} historical />
            </li>
            {history.data?.items.map((a) => (
              <li
                key={a.id}
                className="relative before:absolute before:-left-[1.35rem] before:top-1.5 before:size-2.5 before:rounded-full before:bg-info"
              >
                <p className="font-medium capitalize">
                  {a.kind.replaceAll("_", " ")}
                </p>
                {a.detail.text && (
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {a.detail.text}
                  </p>
                )}
                {a.kind === "assigned" && (
                  <p className="text-xs text-muted-foreground">
                    {a.detail.assignedToId
                      ? `Assigned account ${a.detail.assignedToId}`
                      : "Unassigned"}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.actorName ??
                    (a.actorId
                      ? `Account ${a.actorId}`
                      : "Actor not recorded")}{" "}
                  · <SampleTime value={new Date(a.createdAt).toISOString()} />
                </p>
              </li>
            ))}
          </ol>
          {history.error && (
            <p role="alert" className="text-sm text-destructive">
              Timeline unavailable.{" "}
              <button
                className="underline"
                onClick={() => void history.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {(history.data?.hasMore || cursor > 0) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!cursor}
                onClick={() => setCursor(0)}
              >
                Latest activity
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!history.data?.hasMore}
                onClick={() => setCursor(history.data!.nextCursor!)}
              >
                Older activity
              </Button>
            </div>
          )}
          {canManage && (
            <label className="block space-y-1 text-sm">
              Assigned technician
              <select
                aria-label="Assign technician"
                className="h-10 w-full rounded-md border border-input bg-card px-2"
                disabled={busy || e.status === "resolved"}
                value={e.assignedToId ?? ""}
                onChange={(ev) =>
                  assign.mutate({
                    id,
                    assignedToId: ev.target.value
                      ? Number(ev.target.value)
                      : null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {assignees.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.email ?? `Account ${a.id}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {canRespond && e.status === "active" && (
              <Button
                disabled={busy}
                onClick={() => ack.mutate({ id, status: "acknowledged" })}
              >
                Acknowledge
              </Button>
            )}
            {canManage && e.status !== "resolved" && (
              <>
                {!e.downtimeStartedAt && (
                  <Button
                    variant="outline"
                    disabled={busy || !owned}
                    onClick={() => setConfirm("downtime")}
                  >
                    Record downtime
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy || !owned}
                  onClick={() => setConfirm("resolve")}
                >
                  Resolve
                </Button>
              </>
            )}
          </div>
          {e.downtimeStartedAt && (
            <p className="text-xs">
              Confirmed downtime started {e.downtimeStartedAt.toLocaleString()}
            </p>
          )}
          {e.resolvedAt && (
            <p className="text-xs">Resolved {e.resolvedAt.toLocaleString()}</p>
          )}
          {canRespond ? (
            <form
              aria-busy={addNote.isPending}
              className="space-y-2 border-t pt-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                addNote.mutate({ id, text: note });
              }}
            >
              <label
                className="block text-sm font-medium"
                htmlFor={`incident-note-${id}`}
              >
                Add a review note
              </label>
              <textarea
                id={`incident-note-${id}`}
                disabled={busy}
                className="min-h-24 w-full rounded-md border border-input bg-card p-3 text-sm"
                maxLength={2000}
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                placeholder="Record observations and the next review step"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !note.trim()}
              >
                Save note
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              Read-only evidence review. Workflow changes require an
              individually authorized account.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Connectivity loss alone does not establish factory downtime.
            Assignment and review actions record decisions and do not send
            equipment commands.
          </p>
        </div>
      </div>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "downtime"
                ? "Confirm factory downtime"
                : "Resolve incident"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "downtime"
                ? "Record a downtime start only after confirming that this equipment is actually unavailable for its intended work."
                : "Confirm that the incident has been investigated. Resolution closes any explicitly recorded downtime."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                confirm === "downtime"
                  ? downtime.mutate({ id })
                  : resolve.mutate({ id })
              }
            >
              Confirm {confirm === "downtime" ? "downtime" : "resolution"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
