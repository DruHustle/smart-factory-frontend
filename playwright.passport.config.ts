import { defineConfig, devices } from "@playwright/test";

// UI contracts use synthetic data and the real browser renderer. Publication
// authorization/revocation is separately covered by passport-ada031.spec.ts.
export default defineConfig({
  testDir: "e2e",
  testMatch: ["passport-design.spec.ts"],
  outputDir: "test-results/passport-design",
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3189",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.PASSPORT_BROWSER_EXECUTABLE
        ? { executablePath: process.env.PASSPORT_BROWSER_EXECUTABLE }
        : {}),
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3189 --strictPort",
    url: "http://127.0.0.1:3189",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
