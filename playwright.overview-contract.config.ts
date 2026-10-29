import { defineConfig, devices } from "@playwright/test";

// These UI contracts intercept the full API and use labelled synthetic data.
// They can run independently of the database/broker integration fixtures.
export default defineConfig({
  testDir: "e2e",
  testMatch: "data-workspace.spec.ts",
  outputDir: "test-results/overview-contract",
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3185",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 3185 --strictPort",
    url: "http://127.0.0.1:3185",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
