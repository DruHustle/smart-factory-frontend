import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Factory } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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
            Request help from your factory administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {submitted ? (
            <p role="status" className="text-sm text-muted-foreground">
              If this address belongs to an active individual account, its
              administrator can review your request. After verifying your
              identity, they will provide a temporary password through your
              approved private channel. It expires after 30 minutes and must be
              changed at sign-in.
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await request.mutateAsync({ email });
                  setSubmitted(true);
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Unable to send request. Try again.",
                  );
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="recovery-email">Account email</Label>
                <Input
                  id="recovery-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <Button
                className="w-full"
                type="submit"
                disabled={request.isPending}
              >
                {request.isPending
                  ? "Sending request..."
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
