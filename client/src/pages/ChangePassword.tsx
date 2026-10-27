import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ChangePassword() {
  const { user, refreshUser, logout } = useAuth();
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [validation, setValidation] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      setCurrent("");
      setPassword("");
      setConfirm("");
      await refreshUser();
      window.location.hash = "/";
    },
  });
  const Container = user?.passwordChangeRequired ? "main" : "section";
  return (
    <Container className="flex min-h-[70vh] items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-semibold">Change your password</h1>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {user?.passwordChangeRequired
              ? "Your temporary sign-in can only change this password. Choose your own password to enter the workspace."
              : "Changing your password signs out your other sessions."}
          </p>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== confirm) {
                setValidation("Passwords do not match.");
                return;
              }
              setValidation("");
              change.mutate({
                currentPassword: user?.passwordChangeRequired
                  ? undefined
                  : current,
                newPassword: password,
              });
            }}
          >
            {!user?.passwordChangeRequired && (
              <div className="space-y-1">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={72}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                12–72 characters. Use a unique password.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                maxLength={72}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {(validation || change.error) && (
              <p role="alert" className="text-sm text-destructive">
                {validation || change.error?.message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={change.isPending}
            >
              Save password
            </Button>
          </form>
          <div className="flex justify-between">
            {!user?.passwordChangeRequired && (
              <Button asChild variant="ghost">
                <Link href="/">Cancel</Link>
              </Button>
            )}
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
