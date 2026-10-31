import { defineConfig, devices } from "@playwright/test";

// UI contracts use explicitly synthetic responses. Real gateway, transport and
// database behavior is qualified independently by the integration suites.
export default defineConfig({
  testDir: "e2e",
  testMatch: "industrial-connectivity.spec.ts",
  outputDir: "test-results/connectivity",
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3192",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3192 --strictPort",
    url: "http://127.0.0.1:3192",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
