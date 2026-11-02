import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryModelPresentation } from "../client/src/components/workspace/factory-model-presentation";

describe("factory model presentation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requests a frame at four items and preserves their order until taken", () => {
    const request = vi.fn();
    const batch = new FactoryModelPresentation<number>(request);
    batch.add(1);
    batch.add(2);
    batch.add(3);
    expect(request).not.toHaveBeenCalled();
    batch.add(4);
    expect(request).toHaveBeenCalledOnce();
    expect(batch.take()).toEqual([1, 2, 3, 4]);
    vi.advanceTimersByTime(1000);
    expect(request).toHaveBeenCalledOnce();
  });

  it("requests a partial batch within 120 ms without waiting for another model or a failed download", () => {
    const request = vi.fn();
    const batch = new FactoryModelPresentation<number>(request);
    batch.add(1);
    vi.advanceTimersByTime(119);
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(request).toHaveBeenCalledOnce();
    expect(batch.take()).toEqual([1]);
    batch.add(2);
    batch.requestFinalFrame();
    expect(request).toHaveBeenCalledTimes(2);
    expect(batch.take()).toEqual([2]);
    batch.requestFinalFrame();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("lets an unrelated render take pending work and cancels on disposal", () => {
    const request = vi.fn();
    const batch = new FactoryModelPresentation<number>(request);
    batch.add(1);
    expect(batch.take()).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(request).not.toHaveBeenCalled();
    batch.add(2);
    batch.dispose();
    batch.add(3);
    batch.requestFinalFrame();
    vi.advanceTimersByTime(1000);
    expect(batch.take()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
