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
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function Register() {
  const policy = trpc.auth.registrationPolicy.useQuery();
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await register(email, password, name);
      if (result.success) {
        toast.success("Registration successful!");
        navigate("/");
      } else {
        toast.error(result.error || "Registration failed");
      }
    } catch (error) {
      toast.error("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (policy.isLoading)
    return (
      <div role="status" className="p-8">
        Checking account registration…
      </div>
    );
  if (!policy.data?.enabled)
    return (
      <main className="mx-auto my-16 max-w-md">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold">Account access</h1>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {policy.error
                ? "Unable to check account registration. Try again shortly."
                : "Ask your factory administrator to create your account."}
            </p>
            <Button onClick={() => navigate("/login")}>Back to login</Button>
          </CardContent>
        </Card>
      </main>
    );

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
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
          <h1 className="text-2xl font-bold tracking-wide">Create Account</h1>

          {/* Subtitle */}
          <CardDescription className="text-muted-foreground">
            Join the Smart Factory IoT Platform
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
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
                  placeholder="name@factory.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background/50 border-white/20 focus:border-primary"
                  required
                />
              </div>
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
              <p className="text-xs text-muted-foreground">
                Use at least 12 characters. Passwords are limited to 72 UTF-8
                bytes.
              </p>
            </div>

            {/* Register Button - Matches Login Page Primary Glow */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary hover:bg-primary/80 text-primary-foreground shadow-[0_0_15px_var(--primary)] font-semibold"
            >
              {isLoading ? "Creating account..." : "Register Now"}
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

          {/* Footer - Matches Login Page */}
          <div className="mt-6 text-center text-xs text-muted-foreground space-y-1">
            <p>Protected by Smart Factory Identity Service</p>
            <p>v1.0.0-stable</p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
