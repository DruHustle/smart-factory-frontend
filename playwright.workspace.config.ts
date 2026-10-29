import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: ["workspace.spec.ts", "infrastructure-private.spec.ts", "list-filters.spec.ts", "assistant-selection.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Cold Vite preparation and automatic software-GPU previews share the runner.
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.WORKSPACE_E2E_BASE_URL ?? "http://127.0.0.1:3118",
    trace: "retain-on-failure",
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
  timeout: 60000,
});
