import { resolveApiBase } from "./api-base";
/**
 * tRPC Authentication Service
 *
 * Keeps frontend auth in sync with server auth router.
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { User } from "../../../drizzle/schema";
import type { AppRouter } from "../../../server/routers";
import { userFacingApiError } from "./errors";
import type { AccountCapabilities } from "@shared/access-policy";
export type PublicUser = Omit<User, "password" | "authVersion"> & {
  access?: AccountCapabilities;
};

export interface AuthResponse {
  success: boolean;
  user?: PublicUser;
  error?: string;
}

// Keep the browser session cookie on the same host as the dashboard by default.
const API_BASE_URL = resolveApiBase(
  import.meta.env.VITE_API_URL,
  import.meta.env.PROD,
);

function getTRPCUrl() {
  return `${API_BASE_URL}/trpc`;
}

const trpcAuthClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: getTRPCUrl(),
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

function getErrorMessage(error: unknown, fallback: string): string {
  return userFacingApiError(error, fallback);
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  try {
    const data = await trpcAuthClient.auth.login.mutate({ email, password });

    return {
      success: true,
      user: data.user ?? undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Login failed"),
    };
  }
}

export async function getCurrentUser(): Promise<AuthResponse> {
  try {
    const user = await trpcAuthClient.auth.me.query();

    if (!user) {
      return {
        success: false,
        error: "No active session",
      };
    }

    return {
      success: true,
      user,
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Failed to fetch user"),
    };
  }
}

export async function logout(): Promise<AuthResponse> {
  try {
    await trpcAuthClient.auth.logout.mutate();
  } catch (_error) {
    return {
      success: false,
      error: "Session revocation could not be confirmed",
    };
  }

  return { success: true };
}

export function isGitHubPagesDeployment(): boolean {
  if (typeof window === "undefined") return false;

  const url = window.location.href;
  return url.includes("github.io") && !import.meta.env.VITE_API_URL;
}
