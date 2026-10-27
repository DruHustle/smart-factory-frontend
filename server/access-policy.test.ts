import * as fixtureBoundary from "./demoTarget";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { DEMO_ACCOUNTS } from "../shared/demo-accounts";
import {
  demonstrationOnly,
  operationalWritesAllowed,
} from "../shared/access-policy";
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
) =>
  ({
    user: { id: 99, email, role, openId },
    req: {},
    res: {},
    visibility: Promise.resolve({ demoOnly: false, includeDemo: false }),
  }) as TrpcContext;

describe("central shared-walkthrough containment", () => {
  for (const account of DEMO_ACCOUNTS) {
    it(`denies every operational mutation for shared ${account.role} before route effects`, async () => {
      const caller = appRouter.createCaller(
        userContext(account.email, account.role),
      ) as any;
      const readOnlyMutations = new Set([
        "auth.login",
        "auth.logout",
        "assistant.ask",
      ]);
      const mutations = Object.entries(appRouter._def.procedures).filter(
        ([path, procedure]) =>
          procedure._def.type === "mutation" && !readOnlyMutations.has(path),
      );
      expect(mutations.length).toBeGreaterThan(35);
      for (const [path] of mutations) {
        const parts = path.split(".");
        const invoke = parts.reduce((node, part) => node[part], caller);
        await expect(invoke({}), path).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });
  }
  it("preserves private individual capabilities and denies explicit public deployments", async () => {
    vi.spyOn(fixtureBoundary, "rejectFixtureMutation").mockResolvedValue(
      undefined,
    );
    const user = userContext("owner@example.test", "admin").user!;
    expect(operationalWritesAllowed(user)).toBe(true);
    vi.spyOn(db, "updateDevice").mockResolvedValue(undefined);
    await appRouter
      .createCaller(userContext(user.email!, "admin"))
      .devices.update({ id: 1, name: "Reviewed name" });
    expect(db.updateDevice).toHaveBeenCalledOnce();
    vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "true");
    expect(demonstrationOnly(user)).toBe(true);
    await expect(
      appRouter
        .createCaller(userContext(user.email!, "admin"))
        .devices.update({ id: 1, name: "Denied" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.updateDevice).toHaveBeenCalledOnce();
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
});
