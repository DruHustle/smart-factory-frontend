import { defineConfig } from "@playwright/test";
import base from "./playwright.overview-contract.config";
export default defineConfig({
  ...base,
  testMatch: "factory-diagrams.spec.ts",
  outputDir: "test-results/cad-browser",
  timeout: 60000,
  use: { ...base.use, baseURL: "http://127.0.0.1:3194" },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 3194 --strictPort",
    url: "http://127.0.0.1:3194",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
