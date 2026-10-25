import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/onesa-private",
  testMatch: "onesa.spec.ts",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3108", ...devices["Desktop Chrome"] },
});
