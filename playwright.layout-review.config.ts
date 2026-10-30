import { defineConfig, devices } from "@playwright/test";

// These UI contracts intercept the full API and use labelled synthetic data.
// They can run independently of the database/broker integration fixtures.
export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "layout-editor-review.spec.ts",
    "named-factory-concurrency.spec.ts",
  ],
  outputDir: "test-results/layout-review",
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3186",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 3186 --strictPort",
    url: "http://127.0.0.1:3186",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
