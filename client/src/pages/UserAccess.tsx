import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/access";
import {
  PageHeader,
  EmptyState,
  SampleTime,
} from "@/components/workspace/Primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
const roles = ["viewer", "operator", "engineer", "admin"] as const;
type Account = inferRouterOutputs<AppRouter>["users"]["list"][number];
const emptyAccount = {
  name: "",
  email: "",
  password: "",
  role: "viewer" as (typeof roles)[number],
};
export default function UserAccess({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { user: currentUser } = useAuth(),
    utils = trpc.useUtils();
  const [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [account, setAccount] = useState(emptyAccount);
  const [action, setAction] = useState<{
      account: Account;
      kind: "reset" | "revoke" | "disable" | "enable";
    } | null>(null),
    [temporary, setTemporary] = useState(""),
    [verified, setVerified] = useState(false);
  const done = async (message: string) => {
    toast.success(message);
    setAction(null);
    setTemporary("");
    setVerified(false);
    await utils.users.list.invalidate();
  };
  const failure = (error: { message: string }) => toast.error(error.message);
  const list = trpc.users.list.useQuery(undefined, {
    enabled: !!currentUser?.access?.canAdminister,
  });
  const create = trpc.users.create.useMutation({
    onSuccess: async () => {
      setCreating(false);
      setAccount(emptyAccount);
      await done(
        "Account created. Its temporary password expires in 30 minutes.",
      );
    },
    onError: failure,
  });
  const role = trpc.users.setRole.useMutation({
    onSuccess: () => done("Role updated; existing sessions revoked."),
    onError: failure,
  });
  const enabled = trpc.users.setEnabled.useMutation({
    onSuccess: () => done("Account access updated; existing sessions revoked."),
    onError: failure,
  });
  const revoke = trpc.users.revokeSessions.useMutation({
    onSuccess: () => done("Existing sessions revoked."),
    onError: failure,
  });
  const reset = trpc.users.resetPassword.useMutation({
    onSuccess: () =>
      done(
        "Temporary password set for one sign-in, valid for 30 minutes. Deliver it through your verified private channel.",
      ),
    onError: failure,
  });
  const busy =
    create.isPending ||
    role.isPending ||
    enabled.isPending ||
    revoke.isPending ||
    reset.isPending;
  if (!currentUser?.access?.canAdminister)
    return (
      <EmptyState
        title="Administrator access required"
        description="Account administration is available to individual administrators on a private installation."
      />
    );
  const accounts =
    list.data?.filter((a) =>
      [a.name, a.email].join(" ").toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-[var(--workspace-gap)]">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Users & access</h2>
            <p className="text-sm text-muted-foreground">
              Individual accounts, roles and session access.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Create account
          </Button>
        </div>
      ) : (
        <PageHeader
          title="Users & access"
          description="Individual accounts, roles and session access."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Create account
            </Button>
          }
        />
      )}
      <div className="relative max-w-md">
        <Search
          aria-hidden
          className="absolute left-3 top-3 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Search accounts"
          className="pl-9"
          placeholder="Find a name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            Application users{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {list.data?.length ?? ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p role="status">Loading accounts…</p>
          ) : list.error ? (
            <EmptyState
              error
              title="Accounts unavailable"
              description={list.error.message}
              action={
                <Button variant="outline" onClick={() => void list.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : !accounts.length ? (
            <EmptyState
              title="No matching accounts"
              description="Try a different name or email."
            />
          ) : (
            <ul className="divide-y">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center"
                >
                  <div className="w-full min-w-0 flex-1">
                    <p className="break-words font-medium">
                      {a.name || a.email}
                      {a.id === currentUser.id && (
                        <Badge variant="secondary" className="ml-2">
                          You
                        </Badge>
                      )}
                    </p>
                    <p
                      className="break-all text-sm text-muted-foreground"
                      title={a.email ?? ""}
                    >
                      {a.email || "No email"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.disabledAt ? "Disabled" : "Enabled"} · Last sign-in:{" "}
                      <SampleTime value={a.lastSignedIn?.toISOString()} />
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={a.role === "user" ? "viewer" : a.role}
                      disabled={
                        busy || a.id === currentUser.id || !!a.disabledAt
                      }
                      onValueChange={(value) =>
                        role.mutate({
                          id: a.id,
                          role: value as (typeof roles)[number],
                          expectedVersion: a.accessVersion,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Role for ${a.email || a.openId}`}
                        className="w-32"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabel(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`Manage ${a.email || a.name}`}
                          disabled={busy || a.id === currentUser.id}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            setAction({
                              account: a,
                              kind: a.disabledAt ? "enable" : "disable",
                            })
                          }
                        >
                          {a.disabledAt ? "Enable account" : "Disable account"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            setAction({ account: a, kind: "revoke" })
                          }
                        >
                          Revoke sessions
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!!a.disabledAt}
                          onSelect={() =>
                            setAction({ account: a, kind: "reset" })
                          }
                        >
                          Reset password
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer font-medium">
          Role permissions and recovery
        </summary>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>
            Viewers read observations. Operators can acknowledge incidents.
            Engineers maintain assets, connections, thresholds and commissioned
            controls. Administrators also manage accounts and destructive
            changes.
          </p>
          <p>
            Before resetting a password, verify the person's identity through
            your established support channel. The temporary password permits one
            sign-in within 30 minutes and requires a new password. Existing
            sessions are revoked. Never send credentials through this
            application or include them in an investigation.
          </p>
          <p>
            The last enabled individual administrator cannot be disabled or
            demoted. Another administrator must manage your own access.
          </p>
        </div>
      </details>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setAccount(emptyAccount);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create an individual account</DialogTitle>
            <DialogDescription>
              Deliver the temporary password privately. It expires in 30 minutes
              and must be changed at first sign-in.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(account);
            }}
          >
            <div>
              <Label htmlFor="new-account-name">Account name</Label>
              <Input
                id="new-account-name"
                required
                maxLength={255}
                value={account.name}
                onChange={(e) =>
                  setAccount({ ...account, name: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="new-account-email">Account email</Label>
              <Input
                id="new-account-email"
                type="email"
                required
                maxLength={320}
                value={account.email}
                onChange={(e) =>
                  setAccount({ ...account, email: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="new-account-password">Temporary password</Label>
              <Input
                id="new-account-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={72}
                value={account.password}
                onChange={(e) =>
                  setAccount({ ...account, password: e.target.value })
                }
              />
            </div>
            <Label>Role</Label>
            <Select
              value={account.role}
              onValueChange={(value) =>
                setAccount({
                  ...account,
                  role: value as (typeof roles)[number],
                })
              }
            >
              <SelectTrigger aria-label="New account role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={busy}>
              Create account
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setTemporary("");
            setVerified(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "reset"
                ? "Reset password"
                : action?.kind === "revoke"
                  ? "Revoke sessions"
                  : action?.kind === "disable"
                    ? "Disable account"
                    : "Enable account"}
            </DialogTitle>
            <DialogDescription>
              {action?.account.email}. Existing sessions will lose access. This
              action does not issue machine commands.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!action) return;
              const input = {
                id: action.account.id,
                expectedVersion: action.account.accessVersion,
              };
              if (action.kind === "reset")
                reset.mutate({ ...input, temporaryPassword: temporary });
              else if (action.kind === "revoke") revoke.mutate(input);
              else
                enabled.mutate({ ...input, enabled: action.kind === "enable" });
            }}
          >
            {action?.kind === "reset" && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    required
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  I verified this person's identity through our approved support
                  channel.
                </label>
                <div>
                  <Label htmlFor="reset-temporary">Temporary password</Label>
                  <Input
                    id="reset-temporary"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={72}
                    value={temporary}
                    onChange={(e) => setTemporary(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  One sign-in within 30 minutes. Deliver through your private
                  channel.
                </p>
              </>
            )}
            <Button
              type="submit"
              disabled={busy || (action?.kind === "reset" && !verified)}
            >
              Confirm {action?.kind === "reset" ? "reset" : action?.kind}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
