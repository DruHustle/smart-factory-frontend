import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "resources.spec.ts",
  outputDir: "test-results/resources",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.RESOURCE_E2E_BASE_URL ?? "http://127.0.0.1:3127",
  },
});
