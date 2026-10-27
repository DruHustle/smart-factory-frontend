import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: [
    "public-demo.spec.ts",
    "showcase.spec.ts",
    "raspberry-pi.spec.ts",
    "onesa.spec.ts",
    "equipment-standalone.spec.ts",
  ],
  outputDir: "test-results/public-demo",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PUBLIC_DEMO_E2E_BASE_URL ?? "http://127.0.0.1:3126",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
});
