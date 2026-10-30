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
import { buildDemoAssistantContext } from "./demo-assistant-context";
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

export function captureDemoAssistantContext(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId?: string,
) {
  return buildDemoAssistantContext(
    readDemoSandbox(),
    question,
    history,
    selectedAssetId,
  );
}
