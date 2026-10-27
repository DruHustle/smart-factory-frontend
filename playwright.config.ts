import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT || "3000");

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["system.spec.ts", "ui-audit.spec.ts", "passport-ada031.spec.ts"],
  // These workflows intentionally exercise one shared database and mutate the
  // same disposable fixture records. Serial execution keeps the suite deterministic locally
  // as well as in CI.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "node --import tsx server/_core/index.ts",
    url: `http://127.0.0.1:${e2ePort}/health/ready`,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
