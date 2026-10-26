import { PageHeader } from "@/components/workspace/Primitives";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/access";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const roles = ["viewer", "operator", "engineer", "admin"] as const;

export default function UserAccess() {
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();
  const [account, setAccount] = useState({ name: "", email: "", password: "", role: "viewer" as (typeof roles)[number] });
  const create = trpc.users.create.useMutation({
    onSuccess: async () => { setAccount({ name: "", email: "", password: "", role: "viewer" }); toast.success("Account created"); await utils.users.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const { data: users, isLoading, error: usersError } = trpc.users.list.useQuery();
  const updateRole = trpc.users.setRole.useMutation({
    onSuccess: async () => {
      toast.success("User role updated");
      await utils.users.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (currentUser?.role !== "admin") {
    return <Card><CardContent className="py-12 text-center">Administrator access required.</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Users & access" description="Manage users and access roles."/>
      <Card>
        <CardHeader><CardTitle>Create an account</CardTitle></CardHeader>
        <CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); create.mutate(account); }}>
          <div><Label htmlFor="new-account-name">Account name</Label><Input id="new-account-name" required maxLength={255} value={account.name} onChange={event => setAccount({ ...account, name: event.target.value })} /></div>
          <div><Label htmlFor="new-account-email">Account email</Label><Input id="new-account-email" type="email" required maxLength={320} value={account.email} onChange={event => setAccount({ ...account, email: event.target.value })} /></div>
          <div><Label htmlFor="new-account-password">Initial password</Label><Input id="new-account-password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={account.password} onChange={event => setAccount({ ...account, password: event.target.value })} /></div>
          <Select value={account.role} onValueChange={role => setAccount({ ...account, role: role as (typeof roles)[number] })}><SelectTrigger aria-label="New account role"><SelectValue /></SelectTrigger><SelectContent>{roles.map(role => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}</SelectContent></Select>
          <Button type="submit" disabled={create.isPending}>Create account</Button>
        </form><p className="mt-3 text-xs text-muted-foreground">Deliver credentials through your approved private channel. This form does not email passwords.</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Application users</CardTitle></CardHeader>
        <CardContent>
          {usersError && <p role="alert" className="text-destructive">Unable to load accounts. Reload to try again.</p>}
          {isLoading ? <p role="status" className="py-6 text-center text-muted-foreground">Loading users…</p> : (
            <div className="divide-y">
              {users?.map((account) => (
                <div key={account.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{account.name || account.email || account.openId}</p>
                    <p className="text-sm text-muted-foreground">{account.email || "No email"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {account.id === currentUser.id && <Badge variant="secondary"><ShieldCheck className="mr-1 h-3 w-3" />You</Badge>}
                    <Select
                      value={account.role === "user" ? "viewer" : account.role}
                      disabled={updateRole.isPending || account.id === currentUser.id}
                      onValueChange={(role) => updateRole.mutate({ id: account.id, role: role as (typeof roles)[number] })}
                    >
                      <SelectTrigger aria-label={`Role for ${account.email || account.openId}`} className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card><CardContent className="space-y-2 py-5 text-sm text-muted-foreground">
        <p><strong>Viewer:</strong> device, alert, and operational telemetry views.</p>
        <p><strong>Operator:</strong> viewer access plus alert acknowledgement and the commissioned WROVER indicator LED control.</p>
        <p><strong>Engineer:</strong> operator access plus AAS engineering data, lifecycle changes, thresholds, and commissioned controls.</p>
        <p><strong>Admin:</strong> full access, account creation and user-role provisioning, and destructive administration.</p>
      </CardContent></Card>
    </div>
  );
}
