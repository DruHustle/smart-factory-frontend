import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { CheckCircle2, Factory } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearPasswordResetToken,
  passwordResetSnapshot,
  subscribePasswordResetLink,
} from "@/lib/password-recovery-link";

export default function ResetPassword() {
  const { token, revision } = useSyncExternalStore(
    subscribePasswordResetLink,
    passwordResetSnapshot,
    passwordResetSnapshot,
  );
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const reset = trpc.auth.resetPassword.useMutation();
  const { refreshUser } = useAuth();
  useEffect(() => () => clearPasswordResetToken(), []);
  useEffect(() => {
    setNewPassword("");
    setConfirmation("");
    setError("");
    setComplete(false);
  }, [revision]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary">
            {complete ? (
              <CheckCircle2 className="size-7 text-primary-foreground" />
            ) : (
              <Factory className="size-7 text-primary-foreground" />
            )}
          </div>
          <h1 className="text-2xl font-bold">
            {complete ? "Password reset" : "Reset your password"}
          </h1>
          <CardDescription>
            {complete
              ? "Sign in with your new password."
              : "Choose a new password for your Smart Factory account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {complete ? (
            <p role="status" className="text-sm text-muted-foreground">
              Your password has been updated and previous sessions have been
              signed out.
            </p>
          ) : !token ? (
            <p role="alert" className="text-sm text-muted-foreground">
              This reset link is missing or invalid. Request a new link to
              continue.
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                if (newPassword !== confirmation) {
                  setError("The passwords do not match.");
                  return;
                }
                if (new TextEncoder().encode(newPassword).length > 72) {
                  setError("The password is too long. Use fewer characters.");
                  return;
                }
                try {
                  await reset.mutateAsync({ token, newPassword });
                  if (passwordResetSnapshot().revision !== revision) return;
                  clearPasswordResetToken();
                  setNewPassword("");
                  setConfirmation("");
                  setComplete(true);
                  void refreshUser().catch(() => undefined);
                } catch (cause) {
                  if (passwordResetSnapshot().revision !== revision) return;
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "The reset could not be completed. Request a new link and try again.",
                  );
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-describedby="password-guidance"
                />
                <p
                  id="password-guidance"
                  className="text-xs text-muted-foreground"
                >
                  Use at least 12 characters and a password you have not used
                  for this account.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={reset.isPending}
              >
                {reset.isPending ? "Resetting password..." : "Reset password"}
              </Button>
            </form>
          )}
          {!complete && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/forgot-password">Request a new reset link</Link>
            </Button>
          )}
          <Button
            asChild
            variant={complete ? "default" : "ghost"}
            className="w-full"
          >
            <a href="/#/login">Back to sign in</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
