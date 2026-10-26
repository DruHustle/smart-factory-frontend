import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "equipment-standalone.spec.ts",
  outputDir: "test-results/equipment-standalone",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: process.env.NATIVE_E2E_BASE_URL ?? "http://127.0.0.1:3112",
    ...devices["Desktop Chrome"],
    launchOptions: {
      args:
        process.env.EQUIPMENT_RENDERER === "metal"
          ? ["--use-gl=angle", "--use-angle=metal"]
          : [
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
    },
  },
});
