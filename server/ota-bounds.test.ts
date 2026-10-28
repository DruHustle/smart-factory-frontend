import { afterEach, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

afterEach(() => vi.restoreAllMocks());
const caller = () =>
  appRouter.createCaller({
    user: {
      id: 1,
      openId: "individual-engineer",
      email: "engineer@example.test",
      role: "engineer",
    },
    req: { headers: { cookie: "smart_factory_data_workspace=live" } },
    res: {},
  } as TrpcContext);

it("rejects unbounded or invalid OTA history requests before querying storage", async () => {
  const read = vi.spyOn(db, "getOtaDeployments").mockResolvedValue([]);
  for (const input of [
    { limit: 1001 },
    { limit: -1 },
    { limit: 0 },
    { limit: 1.5 },
    { deviceId: -1 },
    { deviceId: 1.5 },
  ])
    await expect(caller().ota.list(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  expect(read).not.toHaveBeenCalled();
});
it("retains bounded engineer access to recorded OTA history", async () => {
  const read = vi.spyOn(db, "getOtaDeployments").mockResolvedValue([]);
  expect(await caller().ota.list({ deviceId: 1, limit: 1000 })).toEqual([]);
  expect(read).toHaveBeenCalledWith({ deviceId: 1, limit: 1000 });
});
