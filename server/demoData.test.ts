import { afterEach, describe, expect, it } from "vitest";
import {
  demoDataEnabled,
  setRuntimeDemoDataEnabled,
  visibleWhenDemoDataEnabled,
  withVisibility,
} from "./demoData";

afterEach(() => setRuntimeDemoDataEnabled(undefined));

describe("demo data visibility", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(demoDataEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      demoDataEnabled({ ENABLE_DEMO_DATA: "false" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      demoDataEnabled({ ENABLE_DEMO_DATA: "true" } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("isolates request visibility without a replica-local override", async () => {
    setRuntimeDemoDataEnabled(true);
    expect(
      demoDataEnabled({ ENABLE_DEMO_DATA: "false" } as NodeJS.ProcessEnv),
    ).toBe(false);
    await Promise.all([
      withVisibility({ demoOnly: true, includeDemo: true }, async () => {
        await Promise.resolve();
        expect(visibleWhenDemoDataEnabled({ isDemo: false })).toBe(false);
        expect(visibleWhenDemoDataEnabled({ isDemo: true })).toBe(true);
      }),
      withVisibility({ demoOnly: false, includeDemo: false }, async () => {
        await Promise.resolve();
        expect(visibleWhenDemoDataEnabled({ isDemo: true })).toBe(false);
        expect(visibleWhenDemoDataEnabled({ isDemo: false })).toBe(true);
      }),
    ]);
  });

  it("always retains live records and hides simulated records when disabled", () => {
    const disabled = { ENABLE_DEMO_DATA: "false" } as NodeJS.ProcessEnv;
    expect(visibleWhenDemoDataEnabled({ isDemo: false }, disabled)).toBe(true);
    expect(visibleWhenDemoDataEnabled({ isDemo: true }, disabled)).toBe(false);
    expect(
      visibleWhenDemoDataEnabled({ isDemo: true }, {
        ENABLE_DEMO_DATA: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
