import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  requestedDataWorkspace,
  dataWorkspaceCookie,
} from "../shared/data-workspace";
import { resolveVisibility } from "./demoData";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";
beforeEach(() => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
  vi.stubEnv("PUBLIC_DEMO_DEPLOYMENT", "false");
  vi.stubEnv("SECURITY_ENABLED", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("narrows individual reads without changing deployment demo visibility", async () => {
  const user = { email: "individual@example.test", openId: "individual" };
  expect(
    requestedDataWorkspace(`${dataWorkspaceCookie}=demo; other=value`),
  ).toBe("demo");
  expect(
    requestedDataWorkspace(`${dataWorkspaceCookie}=invalid`),
  ).toBeUndefined();
  expect(await resolveVisibility(user, "demo")).toEqual({
    demoOnly: true,
    includeDemo: true,
  });
  expect(await resolveVisibility(user, "live")).toEqual({
    demoOnly: false,
    includeDemo: false,
  });
});
it.each(["ENABLE_DEMO_ACCOUNTS", "PUBLIC_DEMO_DEPLOYMENT"])(
  "keeps shared and anonymous visibility isolated while allowing individual Live reads with %s",
  async (flag) => {
    vi.stubEnv(flag, "true");
    for (const user of [
      null,
      { email: "demo@dev.local", openId: "demo-3" },
      { email: "admin@dev.local", openId: "individual-looking" },
      { email: "renamed@example.test", openId: "demo-reserved" },
    ]) {
      expect(await resolveVisibility(user, "live")).toEqual({
        demoOnly: true,
        includeDemo: true,
      });
    }
    const individual = { email: "owner@example.test", openId: "individual" };
    expect(await resolveVisibility(individual, "live")).toEqual({
      demoOnly: false,
      includeDemo: false,
    });
    expect(await resolveVisibility(individual, "demo")).toEqual({
      demoOnly: true,
      includeDemo: true,
    });
  },
);
it("blocks demo-view mutations before persistence even for an individual administrator", async () => {
  const save = vi.spyOn(db, "updateDevice").mockResolvedValue(undefined);
  const ctx = {
    user: {
      id: 1,
      email: "owner@example.test",
      role: "admin",
      openId: "individual",
    },
    req: { headers: { cookie: `${dataWorkspaceCookie}=demo` } },
    res: {},
  } as TrpcContext;
  await expect(
    appRouter.createCaller(ctx).devices.update({ id: 1, name: "Denied" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(save).not.toHaveBeenCalled();
  await expect(appRouter.createCaller(ctx).users.list()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
