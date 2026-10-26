import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "workspace.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.WORKSPACE_E2E_BASE_URL ?? "http://127.0.0.1:3118",
    trace: "retain-on-failure",
  },
  timeout: 60000,
});
