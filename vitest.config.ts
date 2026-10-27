import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    env: {
      // dotenv imports must not turn a local .env.local into implicit test authorization.
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "",
      ASSISTANT_PROVIDER: "disabled",
      BACKEND_DEPLOYMENT_MODE: "standalone",
    },
    maxWorkers: 1, // Existing mutable database fixture suites must run serially.
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
