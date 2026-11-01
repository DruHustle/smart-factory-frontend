import { afterEach, expect, it, vi } from "vitest";
import {
  clearAssistantSession,
  registerAssistantCancellation,
} from "../client/src/lib/assistant-session";

afterEach(clearAssistantSession);

it("immediately aborts transport when session state is cleared, without waiting for a component effect", () => {
  const controller = new AbortController();
  registerAssistantCancellation(() => controller.abort());
  clearAssistantSession();
  expect(controller.signal.aborted).toBe(true);
});

it("does not let a completed old request unregister a replacement request's cancellation", () => {
  const old = vi.fn();
  const unregisterOld = registerAssistantCancellation(old);
  const replacement = vi.fn();
  registerAssistantCancellation(replacement);
  expect(old).toHaveBeenCalledOnce();
  unregisterOld();
  clearAssistantSession();
  expect(replacement).toHaveBeenCalledOnce();
  clearAssistantSession();
  expect(replacement).toHaveBeenCalledOnce();
});
