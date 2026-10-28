import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleDrawingFrame } from "../../client/src/components/equipment/drawingFrame";

describe("on-demand draw scheduling", () => {
  let frame: FrameRequestCallback;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 7;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("draws once on a normal compositor frame and cancels its watchdog", () => {
    const draw = vi.fn();
    scheduleDrawingFrame(draw);
    frame(16);
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("executes actual drawing when the browser fails to deliver RAF", () => {
    const draw = vi.fn();
    scheduleDrawingFrame(draw);
    vi.advanceTimersByTime(99);
    expect(draw).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(draw).toHaveBeenCalledOnce();
    frame(150);
    expect(draw).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels both paths on disposal and performs no idle work", () => {
    const draw = vi.fn();
    scheduleDrawingFrame(draw)();
    frame(16);
    vi.advanceTimersByTime(1000);
    expect(draw).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(vi.getTimerCount()).toBe(0);
  });
});
