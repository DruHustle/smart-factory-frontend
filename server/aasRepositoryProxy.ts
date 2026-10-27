import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import {
  demonstrationOnly,
  DEMONSTRATION_READ_ONLY,
} from "../shared/access-policy";

type TokenCache = { token: string; expiresAt: number; key: string };
let cachedToken: TokenCache | undefined;

const roleRank: Record<string, number> = {
  user: 0,
  viewer: 0,
  operator: 1,
  engineer: 2,
  admin: 3,
};
const forwardedRequestHeaders = [
  "accept",
  "accept-language",
  "content-type",
  "content-language",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
  "range",
  "content-range",
  "content-disposition",
  "prefer",
  "aas-api-version",
  "aas-api-version-requested",
  "idempotency-key",
];
const forwardedResponseHeaders = [
  "content-type",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
  "allow",
  "aas-api-version",
  "aas-api-version-supported",
  "link",
  "retry-after",
];

function decodeAasIdentifier(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return "";
  }
  const candidate = Buffer.from(decoded, "base64url").toString("utf8");
  return Buffer.from(candidate, "utf8").toString("base64url") ===
    decoded.replace(/=+$/, "")
    ? candidate
    : decoded;
}

async function getRepositoryToken() {
  const configuredTokenUrl = process.env.AAS_OIDC_TOKEN_URL?.trim();
  const discoveryUrl = process.env.AAS_OIDC_DISCOVERY_URL?.trim();
  const scope = process.env.AAS_OIDC_SCOPE?.trim();
  const clientId = process.env.AAS_OIDC_CLIENT_ID;
  const clientSecret = process.env.AAS_OIDC_CLIENT_SECRET;
  if ((!configuredTokenUrl && !discoveryUrl) || !clientId || !clientSecret)
    throw new Error("AAS repository authentication is not configured");
  const identitySettingsUrl = configuredTokenUrl || discoveryUrl!;
  const identityUrl = new URL(identitySettingsUrl);
  if (
    process.env.NODE_ENV === "production" &&
    identityUrl.protocol !== "https:"
  ) {
    throw new Error(
      "AAS identity and discovery endpoints must use HTTPS in production",
    );
  }
  const secretFingerprint = createHash("sha256")
    .update(clientSecret)
    .digest("hex");
  const key = `${identitySettingsUrl}\n${scope ?? ""}\n${clientId}\n${secretFingerprint}`;
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now() + 30_000)
    return cachedToken.token;

  let tokenUrl = configuredTokenUrl;
  if (!tokenUrl) {
    const discovery = await fetch(identityUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!discovery.ok)
      throw new Error(`AAS OIDC discovery returned HTTP ${discovery.status}`);
    const metadata: unknown = await discovery.json();
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("token_endpoint" in metadata) ||
      typeof metadata.token_endpoint !== "string"
    ) {
      throw new Error("AAS OIDC discovery document has no token_endpoint");
    }
    tokenUrl = metadata.token_endpoint;
  }
  const tokenEndpoint = new URL(tokenUrl);
  if (
    !/^https?:$/.test(tokenEndpoint.protocol) ||
    tokenEndpoint.username ||
    tokenEndpoint.password ||
    tokenEndpoint.hash
  ) {
    throw new Error("AAS OAuth token endpoint URL is invalid");
  }
  if (
    process.env.NODE_ENV === "production" &&
    tokenEndpoint.protocol !== "https:"
  ) {
    throw new Error("AAS OAuth token endpoint must use HTTPS in production");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) body.set("scope", scope);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`AAS identity provider returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("access_token" in result) ||
    typeof result.access_token !== "string"
  ) {
    throw new Error("AAS identity provider returned an invalid token response");
  }
  const expiresIn =
    "expires_in" in result && typeof result.expires_in === "number"
      ? result.expires_in
      : 300;
  cachedToken = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(30, expiresIn) * 1000,
    key,
  };
  return cachedToken.token;
}

function serviceUrlFor(resource: string, fallback: string): string {
  const selected =
    resource === "shell-descriptors"
      ? process.env.AAS_REGISTRY_URL
      : resource === "submodel-descriptors"
        ? process.env.AAS_SUBMODEL_REGISTRY_URL
        : resource === "submodels"
          ? process.env.AAS_SUBMODEL_REPOSITORY_URL
          : resource === "concept-descriptions"
            ? process.env.AAS_CONCEPT_DESCRIPTION_REPOSITORY_URL
            : resource === "packages"
              ? process.env.AASX_FILE_SERVER_URL
              : undefined;
  return selected || fallback;
}

function canUseUnauthenticatedLocalRepository(hostname: string): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.AAS_ALLOW_UNAUTHENTICATED_LOCAL === "true" &&
    new Set([
      "localhost",
      "127.0.0.1",
      "::1",
      "aas-environment",
      "aas-repository",
      "submodel-repository",
      "concept-description-repository",
      "aas-registry",
      "submodel-registry",
      "aasx-file-server",
    ]).has(hostname.toLowerCase())
  );
}

/**
 * Authenticated gateway to an IDTA AAS Environment / Repository service.
 * The repository service must be private-network only; this route applies the
 * application's current database role before forwarding with a service token.
 */
export async function aasRepositoryProxy(req: Request, res: Response) {
  let user;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    return res.status(401).json({ error: "Authentication required" });
  }
  // Repository credentials grant private upstream access, including raw exports.
  if (user.passwordChangeRequired)
    return res
      .status(403)
      .json({
        error:
          "Change your temporary password before opening the factory workspace",
      });
  if (demonstrationOnly(user))
    return res.status(403).json({ error: DEMONSTRATION_READ_ONLY });
  if ((roleRank[user.role] ?? -1) < roleRank.engineer) {
    return res.status(403).json({ error: "Requires engineer access" });
  }

  // Managed AAS updates must go through the versioned asset workflow, which
  // snapshots the previous model and rejects stale revisions before a PUT.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const resourcePath = req.path.startsWith("/api/aas")
      ? req.path.slice("/api/aas".length)
      : req.path;
    const parts = resourcePath.split("/").filter(Boolean);
    const resource = parts[0];
    let identifier = parts[1] ? decodeAasIdentifier(parts[1]) : "";
    if (!identifier && req.body && typeof req.body.id === "string")
      identifier = req.body.id;
    if (
      ["shells", "submodels", "concept-descriptions"].includes(resource) &&
      identifier &&
      (await db.findManagedAasShellId(identifier))
    ) {
      return res
        .status(409)
        .json({
          error:
            "This AAS belongs to a managed asset. Use the versioned asset workflow to preserve its history.",
        });
    }
  }

  const repositoryUrl =
    process.env.AAS_REPOSITORY_URL || process.env.AAS_REPO_URL;
  if (!repositoryUrl)
    return res
      .status(503)
      .json({ error: "AAS Repository service is not configured" });

  try {
    const routeResource =
      req.path.slice("/api/aas".length).split("/").filter(Boolean)[0] ?? "";
    const base = new URL(serviceUrlFor(routeResource, repositoryUrl));
    if (
      !/^https?:$/.test(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    ) {
      return res
        .status(500)
        .json({ error: "AAS Repository URL configuration is invalid" });
    }
    if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
      return res
        .status(500)
        .json({ error: "AAS Repository URL must use HTTPS in production" });
    }

    // Keep every request beneath the configured base URL. In particular, an
    // incoming path can never be parsed as a new absolute URL.
    const suffix = req.path.slice("/api/aas".length);
    const segments: string[] = [];
    for (const segment of suffix.split("/")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return res.status(400).json({ error: "Invalid AAS Repository path" });
      }
      if (decoded === "." || decoded === ".." || decoded.includes("\\")) {
        return res.status(400).json({ error: "Invalid AAS Repository path" });
      }
      segments.push(encodeURIComponent(decoded));
    }
    const target = new URL(base.href);
    const basePath = base.pathname.replace(/\/+$/, "");
    target.pathname = basePath + segments.join("/") || "/";
    target.search = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";

    const token = canUseUnauthenticatedLocalRepository(base.hostname)
      ? undefined
      : await getRepositoryToken();
    const headers = new Headers();
    if (token) headers.set("authorization", "Bearer " + token);
    for (const name of forwardedRequestHeaders) {
      const value = req.get(name);
      if (value) headers.set(name, value);
    }

    let body: BodyInit | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.body !== undefined && req.is("application/json")) {
        body = JSON.stringify(req.body);
      } else if (
        req.body !== undefined &&
        req.is("application/x-www-form-urlencoded")
      ) {
        body = new URLSearchParams(req.body as Record<string, string>);
      } else {
        body = req as unknown as BodyInit;
      }
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      ...(body && typeof body === "object" && "pipe" in body
        ? { duplex: "half" }
        : {}),
    } as RequestInit);
    const packageDownload =
      req.method === "GET" &&
      routeResource === "packages" &&
      req.path.slice("/api/aas".length).split("/").filter(Boolean).length ===
        2 &&
      upstream.status === 200;
    for (const name of forwardedResponseHeaders) {
      // BaSyx Go 1.1.0 currently labels downloaded ZIP packages
      // application/aasx+json although its own OpenAPI declares the binary
      // application/asset-administration-shell-package media type. The
      // endpoint semantics are unambiguous, so expose the specified type while
      // streaming the package bytes unchanged.
      const value =
        name === "content-type" && packageDownload
          ? "application/asset-administration-shell-package"
          : upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const location = upstream.headers.get("location");
    if (location) {
      const upstreamLocation = new URL(location, base);
      if (
        upstreamLocation.origin === base.origin &&
        (upstreamLocation.pathname === basePath ||
          upstreamLocation.pathname.startsWith(basePath + "/"))
      ) {
        const localPath =
          "/api/aas" + upstreamLocation.pathname.slice(basePath.length);
        res.setHeader(
          "location",
          localPath + upstreamLocation.search + upstreamLocation.hash,
        );
      }
    }
    res.status(upstream.status);
    if (
      req.method === "HEAD" ||
      upstream.status === 204 ||
      upstream.status === 304
    )
      return res.end();
    if (!upstream.body) return res.end();
    await pipeline(
      Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      ),
      res,
    );
    return undefined;
  } catch (error) {
    console.error(
      "[AAS Repository proxy] Request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    if (res.headersSent || res.destroyed) return;
    return res
      .status(502)
      .json({ error: "AAS Repository service is unavailable" });
  }
}
