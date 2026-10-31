import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Factory } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { userFacingApiError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const policy = trpc.auth.passwordResetPolicy.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const emailDelivery = policy.data?.delivery === "email";
  const request = trpc.auth.requestPasswordReset.useMutation();
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary">
            <Factory className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Forgot password?</h1>
          <CardDescription>
            {policy.isPending
              ? "Checking password recovery…"
              : policy.isError
                ? "Password recovery is temporarily unavailable."
                : emailDelivery
                  ? "Enter your account email to request a password reset link."
                  : "Request help from your factory administrator."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {submitted ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p role="status">
                {emailDelivery
                  ? "If this address belongs to an active individual account, a password reset link will be requested. A successful request does not confirm email delivery. The link expires after 30 minutes and can be used once."
                  : "If this address belongs to an active individual account, its administrator can review your request. After verifying your identity, they will provide a temporary password through your approved private channel. It expires after 30 minutes and must be changed at sign-in."}
              </p>
              {emailDelivery && (
                <p>
                  Check your inbox and spam folder. If no message arrives, ask
                  your factory administrator to review Password help in
                  Administration → Users & access.
                </p>
              )}
              <p>
                Recently requested an account? An administrator must approve it
                first. Password reset does not activate a pending registration.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSubmitted(false);
                  setError("");
                }}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                try {
                  await request.mutateAsync({
                    email: email.trim().toLowerCase(),
                  });
                  setSubmitted(true);
                } catch (cause) {
                  setError(
                    userFacingApiError(
                      cause,
                      "Your recovery request could not be sent. Check your connection and try again.",
                    ),
                  );
                }
              }}
            >
              {policy.isError && (
                <div
                  role="alert"
                  className="space-y-2 text-sm text-destructive"
                >
                  <p>Password recovery is temporarily unavailable.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void policy.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="recovery-email">Account email</Label>
                <Input
                  id="recovery-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                className="w-full"
                type="submit"
                disabled={
                  request.isPending || policy.isPending || policy.isError
                }
              >
                {request.isPending
                  ? "Sending request..."
                  : emailDelivery
                    ? "Send reset link"
                    : "Request password help"}
              </Button>
            </form>
          )}
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 size-4" />
              Back to login
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
