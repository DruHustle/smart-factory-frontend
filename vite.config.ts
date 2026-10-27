import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import { runtimeContractVersion, requiredCapabilities } from "./shared/runtime-contract";

let sourceRevision =
  process.env.RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";
if (!sourceRevision)
  try {
    sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
const releaseIdentity: Plugin = {
  name: "workspace-release-identity",
  generateBundle() {
    this.emitFile({
      type: "asset" as const,
      fileName: "release.json",
      source: JSON.stringify({
        application: "Smart Factory IoT",
        source: /^[a-f0-9]{40}$/.test(sourceRevision)
          ? sourceRevision
          : "unknown",
        builtAt: new Date().toISOString(),
        contractVersion:runtimeContractVersion,
        requiredCapabilities,
      }),
    });
  },
};
const plugins = [react(), tailwindcss(), releaseIdentity];

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          // Keep framework and shared UI code below the chunk-size warning; route pages load on demand.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "framework";
          if (id.includes("/node_modules/@radix-ui/")) return "radix-vendor";
          if (id.includes("/node_modules/lucide-react/")) return "icons-vendor";
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
