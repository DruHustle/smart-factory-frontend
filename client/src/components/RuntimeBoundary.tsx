import { useEffect, useState, type ReactNode } from "react";
import { resolveApiBase } from "@/lib/api-base";
import { runtimeCompatibility } from "@shared/runtime-contract";
/** Prevent a newer UI issuing incompatible requests to an older API. */
export function RuntimeBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<string | null | undefined>(),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(undefined);
    fetch(
      `${resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD)}/runtime/contract`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      },
    )
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((r) => setState(runtimeCompatibility(r, import.meta.env.PROD)))
      .catch(() => {
        if (!controller.signal.aborted)
          setState(
            "The application service is unavailable or awaiting a compatible release.",
          );
      });
    return () => controller.abort();
  }, [attempt]);
  if (state === null) return children;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Smart Factory IoT</h1>
      {state === undefined ? (
        <p role="status">Connecting to the workspace…</p>
      ) : (
        <>
          <p role="alert">{state}</p>
          <p className="text-sm text-muted-foreground">
            Please retry after the service is ready. Your saved workspace data
            is retained.
          </p>
          <button
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </>
      )}
    </main>
  );
}
