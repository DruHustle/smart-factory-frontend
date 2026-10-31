import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type express from "express";
import type { Request, RequestHandler, Response } from "express";
import { sdk } from "../_core/sdk";
import * as service from "./service";
import { installSecurityRoutes } from "./http";
import { dataWorkspaceCookie } from "../../shared/data-workspace";

const sourceId = "1fd307c8-4741-45a8-87d0-72e630c2f73d";
const reportId = "3409b853-ff16-44be-8127-92388b876aec";
const report = '{"SchemaVersion":2,"Results":[]}';

beforeEach(() => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function requestReport(
  user: {
    email: string;
    role: string;
    openId: string;
    passwordChangeRequired?: boolean;
  } | null,
  workspace: "demo" | "live",
  query: Record<string, string> = {
    sourceId,
    targetKind: "application",
    mode: "live",
    producerVersion: "reviewed-scanner-v1",
  },
) {
  const authenticate = vi.spyOn(sdk, "authenticateRequest");
  if (user)
    authenticate.mockResolvedValue({
      ...user,
      id: 14,
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
  else authenticate.mockRejectedValue(new Error("Unauthenticated"));
  const importReport = vi
    .spyOn(service, "importReport")
    .mockResolvedValue({ id: reportId, duplicate: true });
  const routes = vi.fn();
  installSecurityRoutes({ post: routes } as unknown as express.Express);
  const registration = routes.mock.calls.find(
    ([path]) => path === "/api/security/reports",
  );
  expect(registration).toBeDefined();
  const handler = registration![1] as RequestHandler;
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  // Invoke the registered Express handler without a tRPC visibility context.
  await handler(
    {
      headers: { cookie: `${dataWorkspaceCookie}=${workspace}` },
      query,
      body: Buffer.from(report),
    } as unknown as Request,
    response as unknown as Response,
    vi.fn(),
  );
  return { response, importReport };
}

it.each([
  {
    name: "shared administrator selecting Live",
    email: "admin@dev.local",
    role: "admin",
    openId: "reserved",
    workspace: "live" as const,
  },
  {
    name: "renamed reserved identity selecting Live",
    email: "renamed@example.test",
    role: "admin",
    openId: "demo-reserved",
    workspace: "live" as const,
  },
  ...["engineer", "admin"].map((role) => ({
    name: `individual ${role} selecting Demo`,
    email: "individual@example.test",
    role,
    openId: "individual",
    workspace: "demo" as const,
  })),
  ...["engineer", "admin"].map((role) => ({
    name: `temporary-credential ${role} selecting Live`,
    email: "individual@example.test",
    role,
    openId: "individual",
    workspace: "live" as const,
    passwordChangeRequired: true,
  })),
  ...["viewer", "operator"].map((role) => ({
    name: `individual Live ${role}`,
    email: "individual@example.test",
    role,
    openId: "individual",
    workspace: "live" as const,
  })),
])(
  "rejects direct security imports for $name before parsing or persistence",
  async ({ workspace, ...user }) => {
    const { response, importReport } = await requestReport(user, workspace, {
      sourceId: "invalid-before-authorization",
    });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: "private_engineer_required",
    });
    expect(importReport).not.toHaveBeenCalled();
  },
);

it.each(["engineer", "admin"])(
  "allows an approved individual Live %s to import on the demo-enabled origin",
  async (role) => {
    const { response, importReport } = await requestReport(
      { email: "individual@example.test", role, openId: "individual" },
      "live",
    );
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({
      id: reportId,
      duplicate: true,
    });
    expect(importReport).toHaveBeenCalledOnce();
    expect(importReport).toHaveBeenCalledWith(
      report,
      sourceId,
      { kind: "application", id: null },
      14,
      { mode: "live", producerVersion: "reviewed-scanner-v1" },
    );
  },
);

it("requires authentication before direct security report parsing", async () => {
  const { response, importReport } = await requestReport(null, "live", {});
  expect(response.status).toHaveBeenCalledWith(401);
  expect(importReport).not.toHaveBeenCalled();
});

it("still validates the source before an allowed individual import", async () => {
  const { response, importReport } = await requestReport(
    {
      email: "individual@example.test",
      role: "engineer",
      openId: "individual",
    },
    "live",
    { sourceId: "invalid" },
  );
  expect(response.status).toHaveBeenCalledWith(422);
  expect(importReport).not.toHaveBeenCalled();
});
