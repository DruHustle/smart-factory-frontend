/**
 * Register Page Component
 * * Professional registration interface matching IMSOP design.
 * Matches the Login page UI exactly.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Factory, Lock, Mail, User, Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { userFacingApiError } from "@/lib/errors";
import { FirstAdministratorHelp } from "@/components/FirstAdministratorHelp";

const REQUESTED_ROLES = [
  "Administrator",
  "Engineer",
  "Operator",
  "Viewer",
] as const;
type RequestedRole = (typeof REQUESTED_ROLES)[number];

function RegistrationShell({ children }: { children: ReactNode }) {
  return (
    <main
      data-theme-scope="fixed-dark"
      className="dark relative flex min-h-screen items-center justify-center bg-background text-foreground bg-[url('/images/industrial-blur-bg.webp')] bg-cover bg-center p-4 sm:p-6"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm" />
      {children}
    </main>
  );
}

export default function Register() {
  const policy = trpc.auth.registrationPolicy.useQuery();
  const request = trpc.auth.requestRegistration.useMutation();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestedRole | null>(
    null,
  );
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!requestedRole) {
      setError("Choose the role you would like to request.");
      return;
    }
    const requestDetails = `Requested role: ${requestedRole}${jobTitle.trim() ? ` · Job title: ${jobTitle.trim()}` : ""}`;
    if (requestDetails.length > 255) {
      setError(
        "Shorten your job title so your requested role and title fit in the request.",
      );
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError(
        "The password is too long. Use at most 72 UTF-8 bytes; accented characters and emoji can use more than one byte.",
      );
      return;
    }
    if (name.trim().length < 2 || organization.trim().length < 2) {
      setError(
        "Enter a full name and factory or organization of at least two characters each.",
      );
      return;
    }
    setIsLoading(true);

    try {
      await request.mutateAsync({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        organization: organization.trim(),
        // The existing request detail is shown to the approving administrator.
        // This is a preference only; the server never assigns privileges from it.
        jobTitle: requestDetails,
      });
      setPassword("");
      setSubmitted(true);
    } catch (cause) {
      setError(
        userFacingApiError(
          cause,
          "Your request could not be sent. Check your connection and try again.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!requestedRole)
    return (
      <RegistrationShell>
        <Card className="relative z-10 w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                <Factory className="h-7 w-7 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-wide">Choose a role</h1>
            <CardDescription>
              Select the role you need. An administrator reviews your request
              and assigns access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="Requested role"
            >
              {REQUESTED_ROLES.map((role) => (
                <Button
                  key={role}
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setRequestedRole(role)}
                >
                  {role}
                </Button>
              ))}
            </div>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </RegistrationShell>
    );

  if (policy.isLoading)
    return (
      <RegistrationShell>
        <Card className="relative z-10 w-full max-w-md">
          <CardContent className="p-8">
            <p role="status">Checking account registration…</p>
          </CardContent>
        </Card>
      </RegistrationShell>
    );
  if (!policy.data?.enabled)
    return (
      <RegistrationShell>
        <Card className="relative z-10 w-full max-w-md">
          <CardHeader>
            <h1 className="text-2xl font-semibold">Account access</h1>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {policy.error
                ? "Unable to check account registration. Try again shortly."
                : "Ask your factory administrator to create your account."}
            </p>
            {policy.error && (
              <Button
                onClick={() => void policy.refetch()}
                disabled={policy.isFetching}
              >
                {policy.isFetching ? "Checking…" : "Try again"}
              </Button>
            )}
            <FirstAdministratorHelp />
            <Button onClick={() => navigate("/login")}>Back to login</Button>
          </CardContent>
        </Card>
      </RegistrationShell>
    );

  if (submitted)
    return (
      <RegistrationShell>
        <Card className="relative z-10 w-full max-w-md">
          <CardHeader>
            <h1 className="text-2xl font-semibold">Request received</h1>
            <CardDescription>
              For security, we give the same confirmation for every address. An
              administrator will review eligible requests. You can sign in after
              approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This confirmation does not mean your account is active. Ask your
              factory administrator to review your request in Administration →
              Users & access. After approval, sign in with the password from
              your original account request. Submitting the form again does not
              change that password.
            </p>
            <p className="text-sm text-muted-foreground">
              Your administrator can approve access without knowing your
              password. Ask them to confirm when the review is complete; this
              page does not confirm an approval email was sent.
            </p>
            <p className="text-sm text-muted-foreground">
              Already had an account? Registration does not change its password.
              Use{" "}
              <Link
                href="/forgot-password"
                className="text-primary hover:underline"
              >
                Forgot password
              </Link>{" "}
              to recover access.
            </p>
            <FirstAdministratorHelp />
            <Button onClick={() => navigate("/login")}>Back to login</Button>
          </CardContent>
        </Card>
      </RegistrationShell>
    );

  return (
    <RegistrationShell>
      {/* Dark Overlay - Matches Login Page */}

      {/* Register Card */}
      <Card className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-500">
        <CardHeader className="space-y-1 text-center">
          {/* Logo - Matches Login Page Gradient and Shadow */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
              <Factory className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold tracking-wide">
            Request an account
          </h1>

          {/* Subtitle */}
          <CardDescription className="text-muted-foreground">
            Need personal access? Register for administrator approval.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <span>
              Requested role: <strong>{requestedRole}</strong>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRequestedRole(null)}
            >
              Change role
            </Button>
          </div>
          {/* Registration Form */}
          <form onSubmit={handleRegister} className="space-y-4">
            {/* Full Name Field */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-foreground font-medium">
                Full Name
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10 bg-background/50 border-white/20 focus:border-primary"
                  required
                  minLength={2}
                  maxLength={255}
                />
              </div>
            </div>

            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={320}
                  placeholder="name@factory.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background/50 border-white/20 focus:border-primary"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Factory or organization</Label>
              <Input
                id="organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                minLength={2}
                maxLength={255}
                required
                autoComplete="organization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-title">Job title (optional)</Label>
              <Input
                id="job-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                maxLength={
                  255 - "Requested role: Administrator · Job title: ".length
                }
                autoComplete="organization-title"
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Create a secure password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-background/50 border-white/20 focus:border-primary"
                  minLength={12}
                  maxLength={72}
                  required
                  aria-describedby="registration-password-guidance"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p
                id="registration-password-guidance"
                className="text-xs text-muted-foreground"
              >
                Use at least 12 characters. Passwords are limited to 72 UTF-8
                bytes.
              </p>
            </div>

            {/* Register Button - Matches Login Page Primary Glow */}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_var(--primary)] font-semibold"
            >
              {isLoading ? "Sending request..." : "Request approval"}
            </Button>
          </form>

          {/* Toggle to Login */}
          <div className="text-center text-sm">
            <span className="text-muted-foreground">
              Already have an account?{" "}
            </span>
            <button
              onClick={() => navigate("/login")}
              className="text-primary hover:underline font-semibold"
            >
              Sign In
            </button>
          </div>

          <FirstAdministratorHelp />

          {/* Footer - Matches Login Page */}
          <div className="mt-6 text-center text-xs text-muted-foreground space-y-1">
            <p>Protected by Smart Factory Identity Service</p>
            <p>v1.0.0-stable</p>
          </div>
        </CardContent>
      </Card>
    </RegistrationShell>
  );
}
