import { describe, expect, it, vi } from "vitest";
import { pollGpuFrame } from "../../client/src/components/equipment/gpuFrame";

function context(status = 0x911b, lost = false) {
  return {
    TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c,
    ALREADY_SIGNALED: 0x911a,
    WAIT_FAILED: 0x911d,
    SYNC_FLUSH_COMMANDS_BIT: 1,
    clientWaitSync: vi.fn(() => status),
    flush: vi.fn(),
    finish: vi.fn(),
    isContextLost: () => lost,
  };
}
const fence = {} as WebGLSync;
describe("completed GPU frame backpressure", () => {
  it("keeps an unfinished frame pending without draining or accepting it early", () => {
    const gl = context();
    expect(
      pollGpuFrame(
        gl as unknown as WebGL2RenderingContext,
        fence,
        100,
        true,
        599,
      ),
    ).toEqual({ status: gl.TIMEOUT_EXPIRED, synchronized: false });
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.finish).not.toHaveBeenCalled();
    expect(gl.clientWaitSync).toHaveBeenCalledWith(
      fence,
      gl.SYNC_FLUSH_COMMANDS_BIT,
      0,
    );
  });
  it("requires actual GPU completion before accepting an overdue query", () => {
    const gl = context();
    const r = pollGpuFrame(
      gl as unknown as WebGL2RenderingContext,
      fence,
      100,
      true,
      600,
    );
    expect(gl.finish).toHaveBeenCalledOnce();
    expect(r).toEqual({ status: gl.CONDITION_SATISFIED, synchronized: true });
  });
  it("never turns context loss or a failed query into a completed frame", () => {
    const lost = context(0x911b, true);
    expect(
      pollGpuFrame(
        lost as unknown as WebGL2RenderingContext,
        fence,
        0,
        true,
        500,
      ).status,
    ).toBe(lost.WAIT_FAILED);
    const failed = context(0x911d);
    expect(
      pollGpuFrame(
        failed as unknown as WebGL2RenderingContext,
        fence,
        0,
        true,
        500,
      ).status,
    ).toBe(failed.WAIT_FAILED);
    expect(failed.finish).not.toHaveBeenCalled();
  });
  it("does not drain hardware or unidentified drivers", () => {
    const gl = context();
    expect(
      pollGpuFrame(
        gl as unknown as WebGL2RenderingContext,
        fence,
        0,
        false,
        5000,
      ).status,
    ).toBe(gl.TIMEOUT_EXPIRED);
    expect(gl.finish).not.toHaveBeenCalled();
  });
  it("keeps ordinary completed frames nonblocking", () => {
    for (const status of [0x911a, 0x911c]) {
      const gl = context(status);
      expect(
        pollGpuFrame(
          gl as unknown as WebGL2RenderingContext,
          fence,
          0,
          true,
          1000,
        ),
      ).toEqual({ status, synchronized: false });
      expect(gl.finish).not.toHaveBeenCalled();
      expect(gl.flush).not.toHaveBeenCalled();
    }
  });
});
