import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AssistantAnswer } from "@shared/assistant";
import type { AssistantSelection } from "@shared/assistant-providers";
import type { DemoAssistantContext } from "@shared/demo-assistant";
export type TurnContext = { assetId: string; name: string } | null;
export type AssistantTurn = {
  id: string;
  question: string;
  submittedAt: string;
  context: TurnContext;
  request: {
    question: string;
    selectedAssetId?: string;
    selection?: AssistantSelection;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    demoContext?: DemoAssistantContext;
    factoryId?: string;
  };
  status: "pending" | "complete" | "failed";
  result?: AssistantAnswer;
  error?: string;
};
export type AssistantSession = {
  owner: string;
  generation: number;
  draft: string;
  selectedAssetId: string;
  selectedAssetName: string | null;
  selection: AssistantSelection;
  turns: AssistantTurn[];
  selectedTurnId: string | null;
  scrollTop: number;
  followLatest: boolean;
};
let generation = 0;
let current: AssistantSession | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** Memory only: retained across internal routes, never persisted as private evidence in Web Storage. */
export function clearAssistantSession() {
  generation++;
  current = null;
  emit();
}
export function readAssistantSession(owner: string) {
  return current?.owner === owner ? current : null;
}
export function updateAssistantSession(
  owner: string,
  change: (s: AssistantSession) => AssistantSession,
  expectedGeneration?: number,
) {
  if (
    !current ||
    current.owner !== owner ||
    (expectedGeneration !== undefined &&
      current.generation !== expectedGeneration)
  )
    return false;
  current = change(current);
  current = { ...current, turns: current.turns.slice(-12) };
  emit();
  return true;
}
export function resetAssistantSession(owner: string) {
  if (current?.owner !== owner) return;
  current = {
    ...current,
    generation: ++generation,
    draft: "",
    turns: [],
    selectedTurnId: null,
    scrollTop: 0,
    followLatest: true,
  };
  emit();
}
export function useAssistantSession(owner: string) {
  const initial = useMemo<AssistantSession>(
    () => ({
      owner,
      generation: ++generation,
      draft: "",
      selectedAssetId: "automatic",
      selectedAssetName: null,
      selection: { provider: "auto" },
      turns: [],
      selectedTurnId: null,
      scrollTop: 0,
      followLatest: true,
    }),
    [owner],
  );
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => (current?.owner === owner ? current : initial),
    () => initial,
  );
  useEffect(() => {
    if (current?.owner !== owner) {
      current = initial;
      emit();
    }
  }, [owner, initial]);
  return [
    state,
    (
      change: (s: AssistantSession) => AssistantSession,
      expectedGeneration?: number,
    ) => updateAssistantSession(owner, change, expectedGeneration),
  ] as const;
}
