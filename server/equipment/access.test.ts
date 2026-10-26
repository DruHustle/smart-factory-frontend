import { it, expect, vi, afterEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
afterEach(() => vi.unstubAllEnvs());
it("denies mutation to individually named accounts on shared demo deployments", async () => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "true");
  const ctx = {
    user: {
      id: 2,
      role: "admin",
      email: "individual@example.test",
      openId: "individual",
    },
    req: {},
    res: {},
  } as TrpcContext;
  const caller = appRouter.createCaller(ctx);
  expect(await caller.equipment.access()).toEqual({
    canWrite: false,
    demoOnly: true,
  });
  await expect(
    caller.equipment.create({
      name: "Denied",
      serialNumber: "test",
      kind: "real",
      templateRevision: "x",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const models = await caller.equipment.models();
  expect(models.imported).toEqual([]);
});
