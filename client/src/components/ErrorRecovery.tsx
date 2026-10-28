import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateWorkspace } from "@/lib/hashLocation";

export default function ErrorRecovery({
  error,
  development = false,
}: {
  error: Error | null;
  development?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div
        role="alert"
        className="w-full max-w-md space-y-5 rounded-xl border bg-card p-6 shadow-sm"
      >
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">This page couldn’t load</h1>
          <p className="text-sm text-muted-foreground">
            Reload the page to try again, or return to your overview. Unsaved
            changes on this page may need to be entered again.
          </p>
        </div>
        {development && error && (
          <pre className="whitespace-pre-wrap break-words text-xs">
            {error.message}
          </pre>
        )}
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden /> Reload page
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              navigateWorkspace("/", { replace: true });
              window.location.reload();
            }}
          >
            <Home className="size-4" aria-hidden /> Open overview
          </Button>
        </div>
      </div>
    </main>
  );
}
