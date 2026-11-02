import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

type Assignee = { id: number; name: string | null; email: string | null };
type Action = {
  id: number;
  title: string;
  ownerId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  status: "open" | "in_progress" | "completed";
  outcome: string | null;
  version: number;
};
const labels = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
} as const;
const ownerLabel = (owner: Assignee) =>
  owner.name ?? owner.email ?? `Account ${owner.id}`;

function ActionEditor({
  incidentId,
  action,
  assignees,
  onSaved,
}: {
  incidentId: number;
  action: Action;
  assignees: Assignee[];
  onSaved: () => Promise<void>;
}) {
  const [ownerId, setOwnerId] = useState(action.ownerId?.toString() ?? "");
  const [dueDate, setDueDate] = useState(action.dueDate ?? "");
  const [status, setStatus] = useState<Action["status"]>(action.status);
  const [outcome, setOutcome] = useState(action.outcome ?? "");
  const update = trpc.alerts.updateAction.useMutation({
    onSuccess: async () => {
      toast.success("Action updated");
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form
      className="mt-3 grid gap-3 border-t pt-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          id: incidentId,
          actionId: action.id,
          expectedVersion: action.version,
          ownerId: Number(ownerId),
          dueDate: dueDate || null,
          status,
          outcome: outcome.trim() || null,
        });
      }}
    >
      <label className="grid gap-1">
        Owner
        <select
          aria-label={`Owner for ${action.title}`}
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          className="h-10 rounded-md border bg-card px-2"
          disabled={update.isPending}
        >
          <option value="">Select an engineer</option>
          {assignees.map((person) => (
            <option key={person.id} value={person.id}>
              {ownerLabel(person)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Due date
        <input
          aria-label={`Due date for ${action.title}`}
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="h-10 rounded-md border bg-card px-2"
          disabled={update.isPending}
        />
      </label>
      <label className="grid gap-1">
        Status
        <select
          aria-label={`Status for ${action.title}`}
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as Action["status"])
          }
          className="h-10 rounded-md border bg-card px-2"
          disabled={update.isPending}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Observed outcome {status === "completed" ? "(required)" : "(optional)"}
        <textarea
          aria-label={`Outcome for ${action.title}`}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          maxLength={2000}
          className="min-h-20 rounded-md border bg-card p-2"
          disabled={update.isPending}
        />
      </label>
      <Button
        size="sm"
        type="submit"
        disabled={
          update.isPending ||
          !ownerId ||
          (status === "completed" && !outcome.trim())
        }
      >
        Save action
      </Button>
    </form>
  );
}

export function IncidentActions({
  id,
  canManage,
  assignees,
  assigneesUnavailable,
  retryAssignees,
}: {
  id: number;
  canManage: boolean;
  assignees: Assignee[];
  assigneesUnavailable: boolean;
  retryAssignees: () => void;
}) {
  const utils = trpc.useUtils();
  const [cursor, setCursor] = useState(0);
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const actions = trpc.alerts.actions.useQuery({ id, after: cursor });
  const refresh = async () => {
    setCursor(0);
    await Promise.all([
      utils.alerts.actions.invalidate({ id }),
      utils.alerts.history.invalidate({ id }),
    ]);
  };
  const create = trpc.alerts.createAction.useMutation({
    onSuccess: async () => {
      setTitle("");
      setOwnerId("");
      setDueDate("");
      toast.success("Action created");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <section aria-label="Incident actions" className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Follow-up actions</h3>
      {canManage && assigneesUnavailable && (
        <p role="alert" className="text-xs">
          Engineers could not be loaded.{" "}
          <button className="underline" onClick={retryAssignees}>
            Retry
          </button>
        </p>
      )}
      {actions.isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading actions…
        </p>
      ) : actions.error ? (
        <p role="alert" className="text-xs">
          Actions unavailable.{" "}
          <button className="underline" onClick={() => void actions.refetch()}>
            Retry
          </button>
        </p>
      ) : !actions.data?.items.length ? (
        <p className="text-xs text-muted-foreground">No actions recorded.</p>
      ) : (
        <ul className="space-y-2">
          {actions.data.items.map((action) => (
            <li key={action.id} className="rounded-md border p-3">
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  <span>{action.title}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {labels[action.status]} ·{" "}
                    {action.ownerName ?? "Owner unavailable"}
                    {action.dueDate
                      ? ` · Due ${action.dueDate}`
                      : " · No due date"}
                  </span>
                </summary>
                {action.outcome && !canManage && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {action.outcome}
                  </p>
                )}
                {canManage && (
                  <ActionEditor
                    key={`${action.id}:${action.version}`}
                    incidentId={id}
                    action={action}
                    assignees={assignees}
                    onSaved={refresh}
                  />
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      {actions.data && (cursor > 0 || actions.data.hasMore) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!cursor}
            onClick={() => setCursor(0)}
          >
            Latest actions
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!actions.data.hasMore}
            onClick={() => setCursor(actions.data!.nextCursor!)}
          >
            Older actions
          </Button>
        </div>
      )}
      {canManage && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Add follow-up action
          </summary>
          <form
            className="mt-3 grid gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({
                id,
                title,
                ownerId: Number(ownerId),
                dueDate: dueDate || null,
              });
            }}
          >
            <label className="grid gap-1">
              Action
              <input
                aria-label="Action title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={240}
                className="h-10 rounded-md border bg-card px-2"
                disabled={create.isPending}
              />
            </label>
            <label className="grid gap-1">
              Owner
              <select
                aria-label="Action owner"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                className="h-10 rounded-md border bg-card px-2"
                disabled={create.isPending}
              >
                <option value="">Select an engineer</option>
                {assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {ownerLabel(person)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Due date{" "}
              <span className="text-xs text-muted-foreground">Optional</span>
              <input
                aria-label="Action due date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-10 rounded-md border bg-card px-2"
                disabled={create.isPending}
              />
            </label>
            <Button
              size="sm"
              type="submit"
              disabled={create.isPending || !title.trim() || !ownerId}
            >
              Create action
            </Button>
          </form>
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        Actions follow up this incident; completing one does not establish that
        its physical condition has cleared.
      </p>
    </section>
  );
}
