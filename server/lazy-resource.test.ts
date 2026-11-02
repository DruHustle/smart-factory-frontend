import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWithTimeout } from "../client/src/lib/lazy-resource";

afterEach(() => vi.useRealTimers());

describe("optional setup module loading", () => {
  it("returns the loaded module and clears its deadline", async () => {
    vi.useFakeTimers();
    await expect(loadWithTimeout(async () => "ready", 100)).resolves.toBe(
      "ready",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports failures and bounds a stalled load", async () => {
    vi.useFakeTimers();
    await expect(
      loadWithTimeout(() => Promise.reject(new Error("unavailable")), 100),
    ).rejects.toThrow("unavailable");
    expect(vi.getTimerCount()).toBe(0);
    const stalled = loadWithTimeout(() => new Promise<never>(() => {}), 100);
    const rejected = expect(stalled).rejects.toThrow("Setup loading timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
