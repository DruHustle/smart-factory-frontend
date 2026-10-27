import { TRPCError } from "@trpc/server";

export const bundleEnabled = () =>
  ["render-bundle", "compose", "local"].includes(
    process.env.BACKEND_DEPLOYMENT_MODE ?? "",
  );

/** Only the authenticated API can delegate requests to these fixed private ports. */
export async function internalService<T>(
  port: 3104 | 3105 | 3106,
  path: string,
  userId: number,
  body?: unknown,
  session?: { sessionId?: string; authVersion?: number },
): Promise<T> {
  const token = process.env.DASHBOARD_SERVICE_TOKEN;
  if (!token || Buffer.byteLength(token) < 32)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Internal service authorization is not configured",
    });
  try {
    const mode = process.env.BACKEND_DEPLOYMENT_MODE;
    if (process.env.NODE_ENV === "production" && mode !== "render-bundle")
      throw new Error("Production services must share the Render container");
    const hostname = {
      3104: "identity-service",
      3105: "analytics-service",
      3106: "notification-service",
    }[port];
    const localPort = { 3104: 5002, 3105: 5004, 3106: 5003 }[port];
    const origin =
      mode === "compose"
        ? `http://${hostname}:8080`
        : `http://127.0.0.1:${mode === "local" ? localPort : port}`;
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Service-Token": token,
        "X-User-Id": String(userId),
        "X-Session-Id": session?.sessionId ?? "",
        "X-Auth-Version": String(session?.authVersion ?? -1),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Internal service request failed");
    return (await response.json()) as T;
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "A required backend service is temporarily unavailable. Try again shortly.",
    });
  }
}

export type AssetCoverage = {
  assetId: string;
  samples: number;
  firstAt: number;
  lastAt: number;
  longestGapMs: number | null;
  metrics: {
    metric: string;
    samples: number;
    average: number | null;
    minimum: number | null;
    maximum: number | null;
  }[];
};
