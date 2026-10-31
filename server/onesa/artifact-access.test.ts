import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type express from "express";
import type { Request, Response, RequestHandler } from "express";
import { sdk } from "../_core/sdk";
import * as model from "./model";
import { installArtifactRoutes } from "./artifacts";
import { dataWorkspaceCookie } from "../../shared/data-workspace";

beforeEach(() => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function requestArtifact(
  user: {
    email: string;
    role: string;
    openId: string;
    passwordChangeRequired?: boolean;
  } | null,
  workspace: "demo" | "live",
) {
  const authenticate = vi.spyOn(sdk, "authenticateRequest");
  if (user)
    authenticate.mockResolvedValue(
      user as Awaited<ReturnType<typeof sdk.authenticateRequest>>,
    );
  else authenticate.mockRejectedValue(new Error("Unauthenticated"));
  const available = vi
    .spyOn(model, "artifactStatus")
    .mockResolvedValue("Available");
  const routes = vi.fn();
  installArtifactRoutes({ get: routes } as unknown as express.Express);
  expect(routes.mock.calls[0][0]).toBe("/api/onesa/artifacts/:name");
  const handler = routes.mock.calls[0][1] as RequestHandler;
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    download: vi.fn().mockReturnThis(),
  };
  await handler(
    {
      params: { name: "equipment.json" },
      headers: { cookie: `${dataWorkspaceCookie}=${workspace}` },
    } as unknown as Request,
    response as unknown as Response,
    vi.fn(),
  );
  return { response, available };
}

it.each([
  {
    name: "shared identity with Live preference",
    email: "admin@dev.local",
    role: "admin",
    openId: "reserved",
    workspace: "live" as const,
  },
  {
    name: "reserved identity with renamed address",
    email: "renamed@example.test",
    role: "admin",
    openId: "demo-reserved",
    workspace: "live" as const,
  },
  {
    name: "individual Demo engineer",
    email: "owner@example.test",
    role: "engineer",
    openId: "individual",
    workspace: "demo" as const,
  },
  {
    name: "individual Live viewer",
    email: "owner@example.test",
    role: "viewer",
    openId: "individual",
    workspace: "live" as const,
  },
  {
    name: "individual Live operator",
    email: "owner@example.test",
    role: "operator",
    openId: "individual",
    workspace: "live" as const,
  },
  {
    name: "temporary administrator",
    email: "owner@example.test",
    role: "admin",
    openId: "individual",
    workspace: "live" as const,
    passwordChangeRequired: true,
  },
])(
  "blocks private artifact downloads for $name before file access",
  async ({ workspace, ...user }) => {
    const { response, available } = await requestArtifact(user, workspace);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(available).not.toHaveBeenCalled();
    expect(response.download).not.toHaveBeenCalled();
  },
);

it.each(["engineer", "admin"])(
  "allows an approved individual Live %s to download on the same demo-enabled origin",
  async (role) => {
    const { response, available } = await requestArtifact(
      { email: "owner@example.test", role, openId: "individual" },
      "live",
    );
    expect(response.status).not.toHaveBeenCalled();
    expect(available).toHaveBeenCalledOnce();
    expect(response.download).toHaveBeenCalledWith(
      expect.stringContaining("fixtures/equipment/equipment.json"),
      "equipment.json",
    );
  },
);

it("requires authentication before private artifact lookup", async () => {
  const { response, available } = await requestArtifact(null, "live");
  expect(response.status).toHaveBeenCalledWith(401);
  expect(available).not.toHaveBeenCalled();
  expect(response.download).not.toHaveBeenCalled();
});
