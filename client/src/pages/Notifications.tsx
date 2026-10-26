import { PageHeader } from "@/components/workspace/Primitives";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, BellRing, CheckCheck, LoaderCircle, MailCheck, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { hasMinimumRole } from "@/lib/access";
import { trpc } from "@/lib/trpc";

const deliveryLabels: Record<string, string> = {
  pending: "Email queued",
  processing: "Email request in progress",
  retrying: "Email retry scheduled",
  accepted: "Accepted by email provider",
  failed: "Email request failed",
  unconfigured: "Email provider not configured",
  no_recipient: "Email recipient not authorized",
};

const deliveryStyles: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  processing: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  retrying: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  accepted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  unconfigured: "border-destructive/40 bg-destructive/10 text-destructive",
  no_recipient: "border-destructive/40 bg-destructive/10 text-destructive",
};

const DELIVERY_ATTENTION = new Set(["failed", "unconfigured", "no_recipient"]);
type NotificationView = "all" | "unread" | "delivery_attention" | "accepted";

function notificationKindLabel(kind: string) {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function Notifications() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<NotificationView>("all");
  const query = trpc.notifications.list.useQuery(undefined, { refetchInterval: 15000 });
  const utils = trpc.useUtils();
  const read = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      toast.success("Notification marked as read");
    },
    onError: (error) => toast.error(error.message),
  });
  const retry = trpc.notifications.retryEmail.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      toast.success("Email retry requested");
    },
    onError: (error) => toast.error(error.message),
  });

  const notifications = query.data ?? [];
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const attentionCount = notifications.filter((item) => DELIVERY_ATTENTION.has(item.emailStatus)).length;
  const acceptedCount = notifications.filter((item) => item.emailStatus === "accepted").length;
  const filteredNotifications = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return notifications.filter((item) => {
      const matchesView = view === "all"
        || (view === "unread" && !item.readAt)
        || (view === "delivery_attention" && DELIVERY_ATTENTION.has(item.emailStatus))
        || (view === "accepted" && item.emailStatus === "accepted");
      const matchesSearch = !term || [item.title, item.body, item.kind, String(item.alertId)]
        .some((value) => value.toLocaleLowerCase().includes(term));
      return matchesView && matchesSearch;
    });
  }, [notifications, search, view]);

  const summary = [
    { view: "all" as const, label: "Loaded updates", count: notifications.length, icon: BellRing },
    { view: "unread" as const, label: "Unread", count: unreadCount, icon: CheckCheck },
    { view: "delivery_attention" as const, label: "Delivery attention", count: attentionCount, icon: AlertCircle },
    { view: "accepted" as const, label: "Provider accepted", count: acceptedCount, icon: MailCheck },
  ];

  const clearFilters = () => {
    setSearch("");
    setView("all");
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <PageHeader title="Notifications" description="Incident and technician assignment updates for your account."/>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
        {query.dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Auto-refreshes every 15 seconds · Updated <time dateTime={new Date(query.dataUpdatedAt).toISOString()}>{new Date(query.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></p>}
      </div>
    </div>

    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
      The inbox remains available when email is unavailable. Resend acceptance means the provider accepted the request; it does not confirm mailbox delivery.
    </div>

    {query.isLoading && <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />Loading notifications…</div>}
    {query.error && <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"><p>Unable to load notifications. {query.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button></div>}

    {!query.isLoading && !query.error && <>
      <div aria-label="Notification inbox summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((item) => <button
          key={item.view}
          type="button"
          aria-pressed={view === item.view}
          onClick={() => setView(item.view)}
          className={`min-w-0 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.view ? "border-primary bg-primary/5" : "bg-card hover:border-primary/40 hover:bg-muted/30"}`}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />{item.label}</span>
          <strong className="mt-2 block text-2xl tabular-nums">{item.count}</strong>
        </button>)}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-lg">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search notifications" placeholder="Search title, event number, or message" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
        </div>
        <Select value={view} onValueChange={(value) => setView(value as NotificationView)}>
          <SelectTrigger aria-label="Notification view" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All loaded updates</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="delivery_attention">Delivery attention</SelectItem>
            <SelectItem value="accepted">Provider accepted</SelectItem>
          </SelectContent>
        </Select>
        <p aria-live="polite" className="whitespace-nowrap text-sm text-muted-foreground">Showing {filteredNotifications.length} of {notifications.length}</p>
      </div>

      {notifications.length === 0 ? <Card><CardContent className="py-8 text-sm text-muted-foreground">No notifications for your account yet. New warning and critical incidents notify engineers and administrators. Assignment updates notify the affected technicians.</CardContent></Card>
        : filteredNotifications.length === 0 ? <Card><CardContent className="flex flex-col items-start gap-3 py-8"><div><h2 className="font-semibold">No matching notifications</h2><p className="mt-1 text-sm text-muted-foreground">Try another search or show all loaded updates.</p></div><Button type="button" variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button></CardContent></Card>
          : <div className="space-y-3">{filteredNotifications.map((item) => {
            const markingThisRead = read.isPending && read.variables?.id === item.id;
            const retryingThisEmail = retry.isPending && retry.variables?.id === item.id;
            return <Card key={item.id} role="article" aria-label={`${item.title} notification`} className={!item.readAt ? "border-primary/30" : undefined}>
              <CardHeader className="gap-3 px-4 sm:px-6">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-base font-semibold leading-6">{item.title}</h2>
                      {!item.readAt && <Badge>Unread</Badge>}
                      <Badge variant="outline">{notificationKindLabel(item.kind)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.securityFindingId ? "Security investigation" : `Event #${item.alertId}`}</p>
                  </div>
                  <Badge variant="outline" className={`w-fit max-w-full whitespace-normal text-left ${deliveryStyles[item.emailStatus] ?? ""}`}>{deliveryLabels[item.emailStatus] ?? item.emailStatus}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-4 sm:px-6">
                <p className="whitespace-pre-line break-words text-sm leading-6">{item.body}</p>
                <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-muted-foreground">Inbox update</dt><dd><time dateTime={new Date(item.createdAt).toISOString()} title={new Date(item.createdAt).toLocaleString()}>{new Date(item.createdAt).toLocaleString()}</time></dd></div>
                  <div><dt className="text-muted-foreground">Email attempts</dt><dd className="tabular-nums">{item.attempts}</dd></div>
                  {item.acceptedAt && <div><dt className="text-muted-foreground">Provider accepted</dt><dd><time dateTime={new Date(item.acceptedAt).toISOString()}>{new Date(item.acceptedAt).toLocaleString()}</time></dd></div>}
                  {item.readAt && <div><dt className="text-muted-foreground">Read</dt><dd><time dateTime={new Date(item.readAt).toISOString()}>{new Date(item.readAt).toLocaleString()}</time></dd></div>}
                  {["pending", "retrying"].includes(item.emailStatus) && <div><dt className="text-muted-foreground">Queue eligible from</dt><dd><time dateTime={new Date(item.nextAttemptAt).toISOString()}>{new Date(item.nextAttemptAt).toLocaleString()}</time></dd></div>}
                </dl>
                {item.lastError && <div role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"><span className="font-medium">Last email error: </span><span className="break-words">{item.lastError}</span></div>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => { if (!item.readAt) read.mutate({ id: item.id }); if(item.securityFindingId) window.location.hash = `/cybersecurity?finding=${item.securityFindingId}`; else navigate(`/alerts/${item.alertId}`); }}>Open {item.securityFindingId ? "security investigation" : `event #${item.alertId}`}</Button>
                  {!item.readAt && <Button type="button" variant="ghost" disabled={read.isPending} onClick={() => read.mutate({ id: item.id })}>{markingThisRead && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}{markingThisRead ? "Marking read…" : "Mark read"}</Button>}
                  {hasMinimumRole(user?.role, "engineer") && DELIVERY_ATTENTION.has(item.emailStatus) && <Button type="button" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: item.id })}>{retryingThisEmail && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}{retryingThisEmail ? "Requesting retry…" : "Retry email request"}</Button>}
                </div>
              </CardContent>
            </Card>;
          })}</div>}
    </>}
  </div>;
}
