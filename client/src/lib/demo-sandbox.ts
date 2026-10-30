import { useSyncExternalStore } from "react";
import {
  demoSandbox,
  seedDemoSandbox,
  applySandboxAction,
  type DemoSandbox,
  type SandboxRole,
  type SandboxAction,
} from "@shared/demo-sandbox";
import type { InventoryItem } from "@shared/inventory";
import { demoAssistantContext } from "@shared/demo-assistant";
import { planAssistantConversation } from "@shared/assistant-conversation";
const key = "smart-factory:editable-demo:v1";
let current: DemoSandbox | null = null,
  loaded = false,
  storageError = false;
const listeners = new Set<() => void>();
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    loaded = false;
    current = null;
    load();
    emit();
  });
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(key);
    if (raw && raw.length < 4000000) {
      const p = demoSandbox.safeParse(JSON.parse(raw));
      if (p.success) current = p.data;
    }
  } catch {
    storageError = true;
  }
}
const emit = () => listeners.forEach((f) => f());
function persist(next: DemoSandbox) {
  try {
    localStorage.setItem(key, JSON.stringify(next));
    storageError = false;
  } catch {
    storageError = true;
  }
  current = next;
  loaded = true;
  emit();
}
export function readDemoSandbox() {
  load();
  return current;
}
export function useDemoSandbox() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    readDemoSandbox,
    () => null,
  );
}
export const demoSandboxStorageError = () => storageError;
export function startDemoSandbox(items: InventoryItem[]) {
  load();
  if (!current) persist(seedDemoSandbox(items));
  return current!;
}
export function changeDemoSandbox(role: SandboxRole, action: SandboxAction) {
  load();
  if (!current) throw Error("Open the demo workspace first.");
  persist(applySandboxAction(current, role, action));
}
export function resetDemoSandbox(items: InventoryItem[]) {
  try {
    localStorage.removeItem("smart-factory:demo-floor-arrangement:v1");
  } catch {
    storageError = true;
  }
  persist(seedDemoSandbox(items));
}
export function restoreDemoSandbox(raw: unknown) {
  persist(demoSandbox.parse(raw));
}

/** Freeze only the relevant bounded simulation snapshot with the submitted turn. */
export function captureDemoAssistantContext(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId?: string,
) {
  const s = readDemoSandbox();
  const plan = planAssistantConversation(question, history, selectedAssetId);
  if (!s || !plan.includeEvidence) return undefined;
  const terms = plan.resolvedQuestion
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const ranked = s.items
    .map((item) => ({
      item,
      score:
        (selectedAssetId &&
        [
          item.ref,
          item.identifier,
          item.equipmentId,
          item.ref.replace(/^asset:/, ""),
        ].includes(selectedAssetId)
          ? 1000
          : 0) +
        terms.filter((t) =>
          `${item.name} ${item.identifier} ${item.itemType}`
            .toLowerCase()
            .includes(t),
        ).length,
    }))
    .sort((a, b) => b.score - a.score);
  const matched = ranked.filter((r) => r.score > 0);
  const chosen = (matched.length ? matched : ranked)
    .slice(0, 24)
    .map(({ item }) => item);
  return demoAssistantContext.parse({
    name: s.settings.name,
    capturedAt: new Date().toISOString(),
    itemCount: s.items.length,
    assetCount: s.items.filter((i) => i.kind !== "device").length,
    deviceCount: s.items.filter((i) => i.kind === "device").length,
    openIncidents: s.incidents.filter((i) => i.status !== "resolved").length,
    scenario: s.scenario,
    items: chosen.map((i) => ({
      ...Object.fromEntries(
        ["ref", "identifier", "name", "itemType", "connected"].map((k) => [
          k,
          i[k as keyof typeof i],
        ]),
      ),
      samples: Array.from(
        new Map(
          [...s.samples]
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .filter((p) => p.itemRef === i.ref)
            .map((p) => [p.metric, p]),
        ).values(),
      )
        .slice(0, 6)
        .map(({ metric, value, unit, at }) => ({ metric, value, unit, at })),
    })),
    incidents: s.incidents
      .slice(-32)
      .map(({ itemRef, message, severity, status, at }) => ({
        itemRef,
        message,
        severity,
        status,
        at,
      })),
    findings: s.findings
      .slice(-32)
      .map(({ itemRef, title, state, decision }) => ({
        itemRef,
        title,
        state,
        decision,
      })),
  });
}
