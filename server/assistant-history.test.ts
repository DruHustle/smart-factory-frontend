import { describe, expect, it } from "vitest";
import {
  assistantHistory,
  mayAdoptInferredContext,
  selectAssistantContext,
} from "../client/src/lib/assistant-history";
import type {
  AssistantSession,
  AssistantTurn,
} from "../client/src/lib/assistant-session";

const session: AssistantSession = {
  owner: "factory:viewer:demo",
  generation: 1,
  draft: "",
  selectedAssetId: "automatic",
  selectedAssetName: null,
  contextRevision: 0,
  selection: { provider: "auto" },
  turns: [],
  selectedTurnId: null,
  scrollTop: 0,
  followLatest: true,
};

function turn(
  revision: number,
  question: string,
  status: AssistantTurn["status"] = "complete",
): AssistantTurn {
  return {
    id: question,
    contextRevision: revision,
    question,
    submittedAt: "2026-11-02T12:00:00Z",
    context: null,
    request: { question, history: [] },
    status,
    result: {
      answer: `Answer ${question}`,
      sources: [],
      contextAt: "2026-11-02T12:00:00Z",
    },
  };
}

describe("assistant equipment context", () => {
  it("retains follow-ups for the selection but excludes evidence from earlier selections, including a return to the same asset", () => {
    const a = selectAssistantContext(session, "asset-a", "Pump A");
    const b = selectAssistantContext(a, "asset-b", "Pump B");
    const aAgain = selectAssistantContext(b, "asset-a", "Pump A");
    const turns = [
      turn(a.contextRevision, "first A"),
      turn(b.contextRevision, "B"),
      turn(aAgain.contextRevision, "second A"),
    ];
    expect(assistantHistory(turns, aAgain.contextRevision)).toEqual([
      { role: "user", content: "second A" },
      { role: "assistant", content: "Answer second A" },
    ]);
    expect(
      selectAssistantContext(aAgain, "asset-a", "Renamed pump").contextRevision,
    ).toBe(aAgain.contextRevision);
  });

  it("includes at most six completed turns and bounds each message", () => {
    const turns = Array.from({ length: 8 }, (_, i) =>
      turn(1, `${i}${"x".repeat(1300)}`),
    );
    turns.push(
      turn(1, "failed", "failed"),
      turn(1, "pending", "pending"),
      turn(2, "another selection"),
    );
    const history = assistantHistory(turns, 1);
    expect(history).toHaveLength(12);
    expect(history[0].content.startsWith("2")).toBe(true);
    expect(history.every((message) => message.content.length <= 1200)).toBe(
      true,
    );
  });

  it("does not let a late automatic answer replace an explicit context change", () => {
    const pending = turn(0, "question", "pending");
    expect(mayAdoptInferredContext(session, pending)).toBe(true);
    const selected = selectAssistantContext(session, "asset-a", "Pump A");
    const automaticAgain = selectAssistantContext(selected, "automatic", null);
    expect(mayAdoptInferredContext(selected, pending)).toBe(false);
    expect(mayAdoptInferredContext(automaticAgain, pending)).toBe(false);
  });

  it("keeps a follow-up when the answer itself identifies equipment", () => {
    const inferred = { ...session, selectedAssetId: "asset-a" };
    expect(
      assistantHistory([turn(0, "Find the pump")], inferred.contextRevision),
    ).toEqual([
      { role: "user", content: "Find the pump" },
      { role: "assistant", content: "Answer Find the pump" },
    ]);
  });
});
