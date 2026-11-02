import { defineConfig } from "@playwright/test";
import base from "./playwright.overview-contract.config";

export default defineConfig(base, {
  testMatch: "floor-stage.spec.ts",
  outputDir: "test-results/floor-stage",
});
