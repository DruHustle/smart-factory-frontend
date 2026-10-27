import { useLocation } from "wouter";
import { ArrowLeft, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export default function ForgotPassword() {
  const [, navigate] = useLocation();

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <Card className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-500">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
              <Factory className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-wide">
            Password assistance
          </h1>
          <CardDescription className="text-muted-foreground">
            Recover access through a verified administrator.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Contact your Smart Factory administrator through your approved
            support channel. After verifying your identity, they can set a
            temporary password and revoke existing sessions. Sign in within 30
            minutes, then choose your own password before entering the
            workspace.
          </p>

          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/login")}
            className="w-full"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Login
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
