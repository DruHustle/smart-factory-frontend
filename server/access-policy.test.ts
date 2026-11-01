import * as fixtureBoundary from "./demoTarget";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { DEMO_ACCOUNTS } from "../shared/demo-accounts";
import {
  accountCapabilities,
  demonstrationOnly,
  operationalWritesAllowed,
} from "../shared/access-policy";
import { dataWorkspaceCookie } from "../shared/data-workspace";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import { aasRepositoryProxy } from "./aasRepositoryProxy";
import type { Request, Response } from "express";

beforeEach(() => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
  vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
  vi.stubEnv("SECURITY_ENABLED", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const userContext = (
  email: string,
  role: string,
  openId = "individual-access-test",
  workspace: "demo" | "live" = "live",
) =>
  ({
    user: { id: 99, email, role, openId },
    req: { headers: { cookie: `${dataWorkspaceCookie}=${workspace}` } },
    res: {},
  }) as TrpcContext;

const readOnlyMutations = new Set([
  "auth.login",
  "auth.logout",
  "auth.requestRegistration",
  "auth.requestPasswordReset",
  "auth.resetPassword",
  "assistant.ask",
  "assistant.askSelected",
]);
const operationalMutations = Object.entries(appRouter._def.procedures).filter(
  ([path, procedure]) =>
    procedure._def.type === "mutation" && !readOnlyMutations.has(path),
);

describe("central shared-walkthrough containment", () => {
  it("keeps provider choices and selected questions local in shared and individual Demo views", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "gemini");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "never-transmit-fixture-key");
    const fetcher = vi.spyOn(globalThis, "fetch");
    for (const context of [
      userContext(
        DEMO_ACCOUNTS.find((account) => account.role === "viewer")!.email,
        "viewer",
      ),
      userContext("individual@example.test", "viewer", "individual", "demo"),
    ]) {
      const caller = appRouter.createCaller(context);
      expect(
        (await caller.assistant.providers()).providers.map((p) => p.id),
      ).toEqual(["auto", "local"]);
      await expect(
        caller.assistant.askSelected({
          question: "Review the factory pump",
          selection: { provider: "gemini" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const answer = await caller.assistant.askSelected({
        question: "What is your name?",
        selection: { provider: "local" },
      });
      expect(answer.execution).toEqual({ provider: "local", model: null });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  for (const account of DEMO_ACCOUNTS) {
    it(`denies every operational mutation for shared ${account.role} even with a Live preference`, async () => {
      vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
      const caller = appRouter.createCaller(
        userContext(account.email, account.role),
      ) as any;
      expect(operationalMutations.length).toBeGreaterThan(35);
      for (const [path] of operationalMutations) {
        const parts = path.split(".");
        const invoke = parts.reduce((node, part) => node[part], caller);
        await expect(invoke({}), path).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });
  }
  it.each(["ENABLE_DEMO_ACCOUNTS", "PUBLIC_DEMO_DEPLOYMENT"])(
    "preserves individual role authority in Live when %s is enabled",
    async (flag) => {
      vi.stubEnv(flag, "true");
      vi.spyOn(fixtureBoundary, "rejectFixtureMutation").mockResolvedValue(
        undefined,
      );
      const update = vi.spyOn(db, "updateDevice").mockResolvedValue(undefined);
      for (const role of ["viewer", "operator", "engineer", "admin"]) {
        const ctx = userContext("individual@example.test", role);
        expect(demonstrationOnly(ctx.user)).toBe(false);
        expect(operationalWritesAllowed(ctx.user)).toBe(true);
        const caller = appRouter.createCaller(ctx);
        expect((await caller.auth.me())?.access).toEqual({
          demoOnly: false,
          canSwitchData: true,
          workspaceView: "live",
          canOperate: role !== "viewer",
          canEngineer: ["engineer", "admin"].includes(role),
          canAdminister: role === "admin",
        });
        const before = update.mock.calls.length;
        const result = caller.devices.update({ id: 1, name: "Reviewed name" });
        if (["engineer", "admin"].includes(role)) {
          await expect(result).resolves.toBeUndefined();
          expect(update.mock.calls).toHaveLength(before + 1);
        } else {
          await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(update.mock.calls).toHaveLength(before);
        }
      }
    },
  );
  it("narrows an individual Demo view while retaining the ability to select Live", async () => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    const caller = appRouter.createCaller(
      userContext("owner@example.test", "admin", "individual", "demo"),
    ) as any;
    expect((await caller.auth.me()).access).toEqual({
      demoOnly: true,
      canSwitchData: true,
      workspaceView: "demo",
      canOperate: false,
      canEngineer: false,
      canAdminister: false,
    });
    for (const [path] of operationalMutations) {
      const invoke = path.split(".").reduce((node, part) => node[part], caller);
      await expect(invoke({}), path).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(caller.users.pendingRequests()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("never grants Live capabilities to a shared or anonymous identity", async () => {
    expect(demonstrationOnly(null)).toBe(true);
    expect(operationalWritesAllowed(null)).toBe(false);
    for (const identity of [
      userContext("admin@dev.local", "admin"),
      userContext("renamed@example.test", "admin", "demo-reserved"),
    ]) {
      expect(
        (await appRouter.createCaller(identity).auth.me())?.access,
      ).toEqual({
        demoOnly: true,
        canSwitchData: false,
        workspaceView: "demo",
        canOperate: false,
        canEngineer: false,
        canAdminister: false,
      });
    }
  });
  it("withholds operational capabilities from temporary or disabled individual accounts", () => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    for (const restriction of [
      { passwordChangeRequired: true },
      { disabledAt: new Date() },
    ]) {
      expect(
        accountCapabilities({
          email: "owner@example.test",
          openId: "individual",
          role: "admin",
          ...restriction,
        }),
      ).toEqual({
        demoOnly: false,
        canOperate: false,
        canEngineer: false,
        canAdminister: false,
      });
    }
  });
  it("retires the bypass for private operators without persisting a manual live sample", async () => {
    const persist = vi.spyOn(db, "createSensorReading");
    await expect(
      appRouter
        .createCaller(userContext("operator@example.test", "operator"))
        .readings.create({
          deviceId: 1,
          temperature: 0,
          timestamp: Date.now(),
        }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(persist).not.toHaveBeenCalled();
  });
  it("blocks shared engineering repository reads, raw exports and writes before upstream access", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue(
      userContext("tech@dev.local", "engineer").user!,
    );
    const upstream = vi.spyOn(globalThis, "fetch");
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      await aasRepositoryProxy(
        { method } as Request,
        { status } as unknown as Response,
      );
      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({
        error: expect.stringContaining("read-only"),
      });
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("blocks private repository exports for an individual who selected Demo", async () => {
    vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue(
      userContext("engineer@example.test", "engineer").user!,
    );
    const upstream = vi.spyOn(globalThis, "fetch");
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    await aasRepositoryProxy(
      {
        method: "GET",
        headers: { cookie: `${dataWorkspaceCookie}=demo` },
      } as Request,
      { status } as unknown as Response,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
