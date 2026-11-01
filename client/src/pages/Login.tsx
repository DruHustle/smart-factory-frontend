/**
 * Login Page Component
 *
 * Professional login interface matching IMSOP design.
 * Uses tRPC authentication with demo account buttons.
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
import { Factory, Lock, Mail, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { safeSessionStorage } from "@/lib/storage";
import { userFacingApiError } from "@/lib/errors";
import { DEMO_ACCOUNTS, type DemoAccount } from "../../../shared/demo-accounts";

const DEMO_ACCOUNT_CACHE_KEY = "smart-factory:demo-account-shortcuts:v1";
const BUILD_ENABLES_DEMO_ACCOUNTS =
  import.meta.env.VITE_ENABLE_DEMO_ACCOUNTS === "true";
type DemoAccountShortcut = DemoAccount;

function cachedDemoAccounts(): DemoAccountShortcut[] {
  try {
    const parsed: unknown = JSON.parse(
      safeSessionStorage.getItem(DEMO_ACCOUNT_CACHE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DemoAccountShortcut =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof item.label === "string" &&
        typeof item.email === "string" &&
        typeof item.password === "string" &&
        typeof item.description === "string" &&
        ["admin", "viewer", "operator", "engineer"].includes(String(item.role)),
      ),
    );
  } catch {
    return [];
  }
}

function initialDemoAccounts(): DemoAccountShortcut[] {
  const cached = cachedDemoAccounts();
  if (cached.length) return cached;
  return BUILD_ENABLES_DEMO_ACCOUNTS ? DEMO_ACCOUNTS : [];
}

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastConfirmedDemoAccounts, setLastConfirmedDemoAccounts] =
    useState<DemoAccountShortcut[]>(initialDemoAccounts);
  const demoAccountsQuery = trpc.auth.demoAccounts.useQuery(undefined, {
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!demoAccountsQuery.data) return;
    setLastConfirmedDemoAccounts(demoAccountsQuery.data);
    if (demoAccountsQuery.data.length)
      safeSessionStorage.setItem(
        DEMO_ACCOUNT_CACHE_KEY,
        JSON.stringify(demoAccountsQuery.data),
      );
    else safeSessionStorage.removeItem(DEMO_ACCOUNT_CACHE_KEY);
  }, [demoAccountsQuery.data]);
  const demoAccounts = demoAccountsQuery.data ?? lastConfirmedDemoAccounts;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await login(email.trim().toLowerCase(), password);
      if (result.success) {
        toast.success("Login successful!");
        navigate("/");
      } else {
        setError(result.error || "Sign-in could not be completed. Try again.");
      }
    } catch (cause) {
      setError(
        userFacingApiError(
          cause,
          "Sign-in is temporarily unavailable. Check your connection and try again.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemoCredentials = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError("");
    toast.info("Demo credentials filled");
  };

  return (
    <main
      data-theme-scope="fixed-dark"
      className="dark relative flex min-h-screen items-center justify-center bg-background text-foreground bg-[url('/images/industrial-blur-bg.webp')] bg-cover bg-center p-4 sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Login Card */}
      <Card className="relative z-10 w-full max-w-md animate-in fade-in zoom-in duration-500">
        <CardHeader className="space-y-1 text-center">
          {/* Logo */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
              <Factory className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold tracking-wide">Smart Factory</h1>

          {/* Subtitle */}
          <CardDescription className="text-muted-foreground">
            Industrial Monitoring & Control Platform
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
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
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background/50 border-white/20 focus:border-primary"
                  required
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div>
                <Label
                  htmlFor="password"
                  className="text-foreground font-medium"
                >
                  Password
                </Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 bg-background/50 border-white/20 focus:border-primary"
                  required
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
            </div>

            {/* Sign In Button */}
            {error && (
              <div id="login-error" role="alert" className="space-y-2 text-sm">
                <p className="text-destructive">{error}</p>
                <p className="text-muted-foreground">
                  If you requested an account, an administrator must approve it
                  before you can sign in. Password reset does not approve a
                  pending registration.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_var(--primary)] font-semibold"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="text-right text-sm">
            <Link
              href="/forgot-password"
              className="text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <div className="space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              New to Smart Factory?
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/register">Register</Link>
            </Button>
          </div>

          {/* Demo Accounts Section */}
          {demoAccountsQuery.isLoading && demoAccounts.length === 0 && (
            <p
              className="text-xs text-center text-muted-foreground"
              role="status"
            >
              Loading demo accounts…
            </p>
          )}

          {demoAccounts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-center text-muted-foreground">
                Demo Accounts (click to fill):
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {demoAccounts.map((account) => (
                  <Button
                    key={account.role}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      fillDemoCredentials(account.email, account.password)
                    }
                    className="text-xs border-white/20 hover:bg-white/10"
                    title={account.description}
                  >
                    {account.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-muted-foreground space-y-1">
            <p>Protected by Smart Factory Identity Service</p>
            <p>v1.0.0-stable</p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
