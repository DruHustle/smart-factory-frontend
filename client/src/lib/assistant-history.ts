import type { AssistantSession, AssistantTurn } from "./assistant-session";

export function selectAssistantContext(
  session: AssistantSession,
  assetId: string,
  name: string | null,
): AssistantSession {
  return {
    ...session,
    selectedAssetId: assetId,
    selectedAssetName: name,
    contextRevision:
      session.contextRevision + (session.selectedAssetId === assetId ? 0 : 1),
  };
}

export function mayAdoptInferredContext(
  session: AssistantSession,
  turn: AssistantTurn,
) {
  return (
    session.selectedAssetId === "automatic" &&
    session.contextRevision === turn.contextRevision
  );
}

/** Carry follow-ups only within the equipment selection that produced them. */
export function assistantHistory(
  turns: AssistantTurn[],
  contextRevision: number,
) {
  return turns
    .filter(
      (turn) =>
        turn.contextRevision === contextRevision &&
        turn.status === "complete" &&
        turn.result,
    )
    .slice(-6)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question.slice(0, 1200) },
      {
        role: "assistant" as const,
        content: turn.result!.answer.slice(0, 1200),
      },
    ]);
}
