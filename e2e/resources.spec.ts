import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const state of [
  "active",
  "stale",
  "disconnected",
  "browser-offline",
  "visibility-event",
]) {
  test(`${state} observation workload stays within its request budget`, async ({
    page,
    context,
  }) => {
    await page.goto("/#/login");
    await page.getByLabel("Email").fill("security-engineer@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-security-only-2026!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const result = await page.request.get("/api/trpc/assets.list"),
      assets = (await result.json()).result.data.json;
    const fixture =
        state === "stale" || state === "disconnected" ? state : "active",
      asset = assets.find(
        (a: any) => a.assetId === `urn:resource:arm:${fixture}`,
      );
    expect(asset).toBeTruthy();
    const commandRequests: string[] = [];
    page.on("request", (r) => {
      if (
        /controlAda031|pulseIndicator|publishGatewayConfiguration/.test(r.url())
      )
        commandRequests.push(r.url());
    });
    await page.goto(`/#/inventory/asset:${asset.id}/telemetry`);
    await expect(
      page.getByRole("heading", {
        name: "ADA031 telemetry & performance",
        exact: true,
      }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (state === "browser-offline") {
      await context.setOffline(true);
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    }
    if (state === "visibility-event")
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    const calls: Record<string, number> = {};
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/trpc/"))
        for (const name of u.pathname.split("/").at(-1)!.split(","))
          calls[name] = (calls[name] ?? 0) + 1;
    });
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    const before = await session.send("Performance.getMetrics"),
      began = Date.now();
    await page.waitForTimeout(35000);
    const after = await session.send("Performance.getMetrics");
    const count = calls["analytics.getLatestAssetTelemetry"] ?? 0;
    if (state === "active") {
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(8);
    } else if (state === "stale" || state === "disconnected") {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    } else expect(count).toBe(0);
    expect(commandRequests).toEqual([]);
    const metric = (data: any, name: string) =>
      data.metrics.find((m: any) => m.name === name)?.value ?? null;
    const folder =
      process.env.RESOURCE_EVIDENCE_DIR ??
      "/private/tmp/factory-product-experience/resource-budget";
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      `${folder}/${state}.json`,
      JSON.stringify(
        {
          source: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          state,
          visibilityMethod:
            state === "visibility-event"
              ? "simulated document visibility event; this browser keeps background tabs visible"
              : "actual browser network/state fixture",
          durationMs: Date.now() - began,
          calls,
          rendererTaskSeconds:
            metric(after, "TaskDuration") - metric(before, "TaskDuration"),
          heapUsedBefore: metric(before, "JSHeapUsedSize"),
          heapUsedAfter: metric(after, "JSHeapUsedSize"),
          commands: commandRequests.length,
          physicalEquipment: false,
        },
        null,
        2,
      ),
    );
  });
}
