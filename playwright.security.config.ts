import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "security-standalone.spec.ts",
  outputDir: "test-results/security",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: process.env.SECURITY_E2E_BASE_URL ?? "http://127.0.0.1:3117",
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
});
