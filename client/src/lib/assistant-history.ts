import type { AssistantSession, AssistantTurn } from "./assistant-session";
import {
  investigationKey,
  type InvestigationContext,
} from "@shared/assistant-investigation";

export function selectAssistantContext(
  session: AssistantSession,
  assetId: string,
  name: string | null,
): AssistantSession {
  return {
    ...session,
    selectedAssetId: assetId,
    selectedAssetName: name,
    ...(session.selectedAssetId !== assetId
      ? { investigation: undefined }
      : {}),
    contextRevision:
      session.contextRevision + (session.selectedAssetId === assetId ? 0 : 1),
  };
}

/** Equipment, incident and time window all define the evidence for a follow-up. */
export function selectAssistantInvestigation(
  session: AssistantSession,
  investigation?: InvestigationContext,
): AssistantSession {
  const selectedAssetId = investigation
    ? (investigation.assetId ?? "automatic")
    : session.selectedAssetId;
  const changed =
    selectedAssetId !== session.selectedAssetId ||
    investigationKey(investigation) !== investigationKey(session.investigation);
  return {
    ...session,
    selectedAssetId,
    selectedAssetName:
      selectedAssetId === session.selectedAssetId
        ? session.selectedAssetName
        : null,
    investigation,
    contextRevision: session.contextRevision + (changed ? 1 : 0),
  };
}

export function mayAdoptInferredContext(
  session: AssistantSession,
  turn: AssistantTurn,
) {
  return (
    session.selectedAssetId === "automatic" &&
    !session.investigation &&
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
