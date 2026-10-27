import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "navigation.spec.ts",
  outputDir: `test-results/navigation/${process.env.WORKSPACE_E2E === "true" ? "private" : "public"}`,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL:
      process.env.WORKSPACE_E2E_BASE_URL ??
      process.env.PUBLIC_DEMO_E2E_BASE_URL ??
      "http://127.0.0.1:3126",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
