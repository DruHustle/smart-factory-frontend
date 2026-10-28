import { afterEach, expect, it, vi } from "vitest";
import { resetDemoViewerFixtureLoginLimit } from "../e2e/fixture-auth";
afterEach(() => vi.unstubAllEnvs());
it("refuses fixture-counter cleanup outside the explicit local disposable runner", async () => {
  for (const [mode, flag, database] of [
    ["production", "true", "postgres://test:test@127.0.0.1:5432/factory_e2e"],
    [
      "development",
      "true",
      "postgres://test:test@example.test:5432/factory_e2e",
    ],
    ["development", "true", "postgres://test:test@127.0.0.1:5432/factory"],
    ["development", "false", "postgres://test:test@127.0.0.1:5432/factory_e2e"],
  ]) {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("PUBLIC_DEMO_E2E", flag);
    vi.stubEnv("DATABASE_URL", database);
    await expect(resetDemoViewerFixtureLoginLimit()).rejects.toThrow(
      "explicit disposable local browser runner",
    );
  }
});
