import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/onesa-private",
  testMatch: "onesa.spec.ts",
  workers: 1,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    baseURL: process.env.WORKSPACE_E2E_BASE_URL ?? "http://127.0.0.1:3108",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
