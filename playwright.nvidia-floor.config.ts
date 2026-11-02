import { defineConfig } from "@playwright/test";
import base from "./playwright.overview-contract.config";

// Isolated synthetic fixtures, with the real viewer and public model bytes.
export default defineConfig(base, {
  testMatch: "nvidia-floor.spec.ts",
  outputDir: "test-results/nvidia-floor",
});
