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
  await expect(
    caller.equipment.bindingTemplate({ revision: "local-import:private" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const models = await caller.equipment.models();
  expect(models.imported).toEqual([]);
});

it("returns model-specific mapping metadata only to private engineers", async () => {
  vi.stubEnv("ENABLE_DEMO_ACCOUNTS", "false");
  const caller = appRouter.createCaller({
    user: {
      id: 2,
      role: "engineer",
      email: "mapping@example.test",
      openId: "mapping-engineer",
    },
    req: {},
    res: {},
  } as TrpcContext);
  const t = await caller.equipment.template();
  const mapping = await caller.equipment.bindingTemplate({
    revision: t.revision,
  });
  expect(mapping.components.map((c) => c.templateComponentId)).toEqual(
    t.components.map((c) => c.templateComponentId),
  );
  expect(mapping.bindings).toEqual(t.bindings);
});
