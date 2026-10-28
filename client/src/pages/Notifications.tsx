import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listPage } from "@/lib/list-filters";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import {
  PageHeader,
  EmptyState,
  SampleTime,
  SectionNav,
} from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
const labels: Record<string, string> = {
  demo_only: "Simulation · email not requested",
  inbox_only: "Inbox only · email not requested",
  pending: "Email queued",
  processing: "Email request in progress",
  retrying: "Email retry scheduled",
  accepted: "Accepted by email provider",
  failed: "Email request failed",
  unconfigured: "Email provider not configured",
  no_recipient: "Email recipient not authorized",
};
export default function Notifications() {
  const { user } = useAuth(),
    active = useDocumentActive(),
    utils = trpc.useUtils(),
    [location, navigate] = useWorkspaceLocation(),
    params = new URLSearchParams(location.split("?")[1] ?? ""),
    search = (params.get("search") ?? "").slice(0, 100),
    view = (
      ["all", "unread", "delivery_attention", "accepted"].includes(
        params.get("view") ?? "",
      )
        ? params.get("view")
        : "all"
    ) as "all" | "unread" | "delivery_attention" | "accepted",
    page = listPage(params.get("page"));
  const settledSearch = useDebouncedValue(search);
  const query = trpc.notifications.page.useQuery(
    { search: settledSearch, view, page },
    {
      refetchInterval: active ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const done = async (message: string) => {
    toast.success(message);
    await Promise.all([
      utils.notifications.page.invalidate(),
      utils.notifications.summary.invalidate(),
      utils.notifications.list.invalidate(),
    ]);
  };
  const read = trpc.notifications.markRead.useMutation({
      onSuccess: () => done("Marked as read"),
      onError: (e) => toast.error(e.message),
    }),
    retry = trpc.notifications.retryEmail.useMutation({
      onSuccess: () =>
        done("Email retry queued; delivery is not yet established"),
      onError: (e) => toast.error(e.message),
    });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    navigate(`/notifications?${next}`);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        description="Your incident assignments and delivery status."
        action={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh inbox
          </Button>
        }
      />
      {user?.access?.demoOnly && (
        <p className="rounded-md border border-info/40 bg-info/5 p-3 text-sm">
          Read-only simulated inbox. These updates are isolated to this shared
          demonstration identity. No email was sent.
        </p>
      )}
      <SectionNav
        label="Notification views"
        value={view}
        sections={[
          { id: "all", label: "All updates" },
          {
            id: "unread",
            label: `Unread${query.data ? ` (${query.data.summary.unread})` : ""}`,
          },
          { id: "delivery_attention", label: "Delivery attention" },
          { id: "accepted", label: "Provider accepted" },
        ]}
        onChange={(v) => update("view", v)}
      >
        <div className="space-y-4">
          <Input
            aria-label="Search notifications"
            maxLength={100}
            value={search}
            placeholder="Find an update across your recorded inbox"
            onChange={(e) => update("search", e.target.value)}
          />
          {query.isLoading ? (
            <EmptyState title="Loading inbox…" />
          ) : query.error ? (
            <EmptyState
              error
              title="Inbox unavailable"
              description="Updates could not be read. A zero unread count is not inferred."
              action={
                <Button onClick={() => void query.refetch()} variant="outline">
                  Retry
                </Button>
              }
            />
          ) : !query.data?.items.length ? (
            <EmptyState
              title={
                user?.access?.demoOnly
                  ? "Personal inbox is private"
                  : "No matching updates"
              }
              description={
                user?.access?.demoOnly
                  ? "The shared walkthrough has no private account inbox or email actions."
                  : "Adjust the filters or return when an incident is assigned to your account."
              }
            />
          ) : (
            <>
              <p role="status" className="text-xs text-muted-foreground">
                {query.data.total} matching updates ·{" "}
                {query.data.summary.unread} unread across your visible inbox
              </p>
              <ul className="divide-y rounded-lg border bg-card">
                {query.data.items.map((n) => (
                  <li className="space-y-3 p-4" key={n.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold">{n.title}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {n.kind.replaceAll("_", " ")} ·{" "}
                          <SampleTime value={n.createdAt.toISOString()} />
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!n.readAt && <Badge variant="secondary">Unread</Badge>}
                        <Badge variant="outline">
                          {labels[n.emailStatus] ?? "Email state unknown"}
                        </Badge>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {n.body}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {n.infrastructureEventId ? (
                        <Button variant="outline" asChild><Link href={`/infrastructure/service-health/history?event=${n.infrastructureEventId}`}>Open infrastructure event</Link></Button>
                      ) : n.securityFindingId ? (
                        <Button variant="outline" asChild>
                          <Link
                            href={`/cybersecurity?finding=${encodeURIComponent(n.securityFindingId)}`}
                          >
                            Open security investigation
                          </Link>
                        </Button>
                      ) : n.alertId ? (
                        <Button variant="outline" asChild>
                          <Link href={`/alerts/${n.alertId}`}>
                            Open process incident
                          </Link>
                        </Button>
                      ) : null}
                      {!user?.access?.demoOnly && !n.readAt && (
                        <Button
                          variant="outline"
                          disabled={read.isPending}
                          onClick={() => read.mutate({ id: n.id })}
                        >
                          Mark read
                        </Button>
                      )}
                      {user?.access?.canEngineer &&
                        ["failed", "unconfigured", "no_recipient"].includes(
                          n.emailStatus,
                        ) && (
                          <Button
                            variant="outline"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate({ id: n.id })}
                          >
                            Retry email
                          </Button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
              <nav
                aria-label="Notification pages"
                className="flex items-center justify-between gap-2"
              >
                <Button
                  variant="outline"
                  disabled={!page}
                  onClick={() => update("page", String(page - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs">
                  Page {page + 1} · {query.data.returned} of {query.data.total}
                </span>
                <Button
                  variant="outline"
                  disabled={!query.data.hasMore}
                  onClick={() => update("page", String(page + 1))}
                >
                  Next
                </Button>
              </nav>
            </>
          )}
          <details className="rounded-lg border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Inbox and email delivery states
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">
              The durable inbox is available independently of email. Queued and
              retry states mean delivery is pending. Provider acceptance
              confirms that the provider accepted the request; actual recipient
              delivery is unknown unless separately established. Failed requests
              remain visible and may be retried by an authorized individual
              engineer.
            </p>
          </details>
        </div>
      </SectionNav>
    </div>
  );
}
