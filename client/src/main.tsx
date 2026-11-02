import { resolveApiBase } from "@/lib/api-base";
import { trpc } from "@/lib/trpc";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { safeLocalStorage, safeSessionStorage } from "@/lib/storage";
import {
  announceSessionExpired,
  isUnauthorizedError,
} from "@/lib/session-expiry";
import { userFacingApiError } from "@/lib/errors";
import { capturePasswordResetToken } from "@/lib/password-recovery-link";
import {
  fetchInDataWorkspace,
  installDataWorkspaceSync,
} from "@/lib/data-workspace-sync";
import { clearAssistantSession } from "@/lib/assistant-session";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { RuntimeBoundary } from "./components/RuntimeBoundary";
import "./index.css";

capturePasswordResetToken();
window.addEventListener("hashchange", capturePasswordResetToken);

// Earlier versions kept session JWTs in Web Storage. Remove those persisted
// values after upgrading to the HttpOnly cookie session.
safeLocalStorage.removeItem("token");
safeSessionStorage.removeItem("token");

function handleProtectedRequestError(error: unknown) {
  // Every tRPC query and mutation passes through React Query. Normalize its
  // shared Error object before page-level renderers or toast callbacks use it.
  // Server logs retain full technical details; users never see proxy/HTML or
  // JSON parser fragments.
  if (error instanceof Error) {
    error.message = userFacingApiError(
      error,
      "The application service is temporarily unavailable. Check your connection and try again.",
    );
  }
  if (!isUnauthorizedError(error)) return;
  // A protected query can otherwise keep rendering its last successful data
  // after the HttpOnly session cookie expires. Clear the entire authenticated
  // cache before returning the application to the login shell.
  queryClient.clear();
  announceSessionExpired();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleProtectedRequestError }),
  mutationCache: new MutationCache({ onError: handleProtectedRequestError }),
});

const stopWorkspaceSync = installDataWorkspaceSync(() => {
  // The cookie is shared across tabs; the user/access payload and query cache
  // are document-local. Freeze requests before resetting both with one reload.
  void queryClient.cancelQueries();
  queryClient.clear();
  clearAssistantSession();
  const overview = new URL(window.location.href);
  overview.search = "";
  overview.hash = "/";
  window.history.replaceState(null, "", overview);
  window.location.reload();
});
if (import.meta.hot) import.meta.hot.dispose(stopWorkspaceSync);

const getTRPCUrl = () =>
  `${resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD)}/trpc`;

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      // An assistant cancellation must close its own request even while an
      // unrelated dashboard request is still in flight.
      condition: (op) =>
        op.path === "assistant.ask" || op.path === "assistant.askSelected",
      true: httpLink({
        url: getTRPCUrl(),
        transformer: superjson,
        fetch: fetchInDataWorkspace,
      }),
      false: httpBatchLink({
        url: getTRPCUrl(),
        transformer: superjson,
        fetch: fetchInDataWorkspace,
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider switchable>
        <RuntimeBoundary>
          <App />
        </RuntimeBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </trpc.Provider>,
);
