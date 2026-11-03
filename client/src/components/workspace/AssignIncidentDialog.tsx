import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Assign the incident behind an inbox update, keeping one source of ownership. */
export function AssignIncidentDialog({
  id,
  onClose,
}: {
  id: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const incident = trpc.alerts.getById.useQuery({ id });
  const assignees = trpc.alerts.assignees.useQuery();
  const [owner, setOwner] = useState("");
  useEffect(() => {
    if (incident.data) setOwner(incident.data.assignedToId?.toString() ?? "");
  }, [incident.data?.id, incident.data?.assignedToId]);
  const assign = trpc.alerts.assign.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.alerts.invalidate(),
        utils.notifications.invalidate(),
      ]);
      toast.success("Technician assignment updated");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const current = incident.data?.assignedToId;
  const currentUnavailable =
    current != null &&
    assignees.data &&
    !assignees.data.some((a) => a.id === current);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !assign.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign technician or engineer</DialogTitle>
          <DialogDescription>
            Assign the incident linked to this notification. The recipient
            receives an inbox update.
          </DialogDescription>
        </DialogHeader>
        {incident.isLoading || assignees.isLoading ? (
          <p>Loading assignment…</p>
        ) : incident.error || assignees.error || !incident.data ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Assignment details are unavailable.</p>
            <Button
              variant="outline"
              onClick={() => {
                void incident.refetch();
                void assignees.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : incident.data.status === "resolved" ? (
          <p>This incident is resolved and cannot be reassigned.</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              assign.mutate({ id, assignedToId: owner ? Number(owner) : null });
            }}
          >
            <p className="text-sm font-medium break-words">
              {incident.data.message}
            </p>
            <label className="block space-y-1 text-sm">
              Technician or engineer
              <select
                aria-label="Technician or engineer"
                className="workspace-control w-full"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                disabled={assign.isPending}
              >
                <option value="">Unassigned</option>
                {currentUnavailable && (
                  <option value={current!}>
                    {incident.data.assignedToName ?? `Account ${current}`}{" "}
                    (unavailable)
                  </option>
                )}
                {assignees.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.email ?? `Account ${a.id}`}
                  </option>
                ))}
              </select>
            </label>
            {!assignees.data?.length && (
              <p className="text-sm text-muted-foreground">
                No active technician accounts are available. Ask an
                administrator to enable an engineer account.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={assign.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  assign.isPending || owner === (current?.toString() ?? "")
                }
              >
                {assign.isPending ? "Saving…" : "Save assignment"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
