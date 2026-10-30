import { useSyncExternalStore } from "react";
import {
  demoSandbox,
  upgradeDemoSandbox,
  seedDemoSandbox,
  applySandboxAction,
  type DemoSandbox,
  type SandboxRole,
  type SandboxAction,
} from "@shared/demo-sandbox";
import type { InventoryItem } from "@shared/inventory";
import { buildDemoAssistantContext } from "./demo-assistant-context";
const key = "smart-factory:editable-demo:v2";
const legacyKey = "smart-factory:editable-demo:v1";
let recoveryRaw: string | null = null;
let persistedRaw: string | null = null;
let current: DemoSandbox | null = null,
  loaded = false,
  storageError = false;
const listeners = new Set<() => void>();
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    // A quota failure leaves the newest snapshot in memory. Never replace it
    // with an older storage event; the user can download it from the sandbox.
    if (storageError && current) {
      emit();
      return;
    }
    loaded = false;
    current = null;
    load();
    emit();
  });
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = localStorage.getItem(key),
      legacy = saved ? null : localStorage.getItem(legacyKey);
    persistedRaw = saved;
    const raw = saved ?? legacy;
    if (raw) {
      try {
        if (raw.length > 4000000) throw Error("Workspace capacity exceeded");
        current = upgradeDemoSandbox(JSON.parse(raw));
        recoveryRaw = null;
      } catch {
        recoveryRaw = raw;
        storageError = true;
      }
      if (current && !saved && !recoveryRaw) {
        try {
          localStorage.setItem(key, JSON.stringify(current));
          persistedRaw = JSON.stringify(current);
        } catch {
          storageError = true;
        }
      }
    }
  } catch {
    storageError = true;
  }
}
const emit = () => listeners.forEach((f) => f());
function persist(next: DemoSandbox) {
  if (recoveryRaw)
    throw Error(
      "Recover or download the saved demo workspace before resetting it.",
    );
  let changedInAnotherTab = false;
  try {
    changedInAnotherTab = localStorage.getItem(key) !== persistedRaw;
  } catch {}
  if (changedInAnotherTab)
    throw Error(
      "Another tab changed this demo. Download your current workspace, then reload before editing.",
    );
  const raw = JSON.stringify(next);
  if (raw.length > 4000000)
    throw Error(
      "This demo workspace has reached its storage capacity. Download a backup before resetting it.",
    );
  try {
    localStorage.setItem(key, raw);
    persistedRaw = raw;
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
export const demoSandboxRecovery = () => recoveryRaw;
export function startDemoSandbox(items: InventoryItem[]) {
  load();
  if (!current) {
    if (recoveryRaw) {
      current = seedDemoSandbox(items);
      emit();
    } else persist(seedDemoSandbox(items));
  }
  return current!;
}
export function changeDemoSandbox(role: SandboxRole, action: SandboxAction) {
  load();
  if (!current) throw Error("Open the demo workspace first.");
  if (recoveryRaw)
    throw Error(
      "Recover or download the saved demo workspace before resetting it.",
    );
  persist(applySandboxAction(current, role, action));
}
export function resetDemoSandbox(items: InventoryItem[]) {
  try {
    localStorage.removeItem("smart-factory:demo-floor-arrangement:v1");
    const ids = new Set(current?.factories.map((factory) => factory.id) ?? []);
    for (const storedKey of Object.keys(localStorage))
      if (
        storedKey.startsWith("smart-factory:selected-factory:v1:") &&
        ids.has(localStorage.getItem(storedKey)!)
      )
        localStorage.removeItem(storedKey);
      else if (
        storedKey.startsWith("smart-factory:named-factory-draft:v1:") &&
        ids.has(storedKey.split(":").at(-1)!)
      )
        localStorage.removeItem(storedKey);
    window.dispatchEvent(new Event("smart-factory:factory-selection"));
  } catch {
    storageError = true;
  }
  recoveryRaw = null;
  try {
    persistedRaw = localStorage.getItem(key);
  } catch {}
  persist(seedDemoSandbox(items));
}
export function restoreDemoSandbox(raw: unknown) {
  const restored = upgradeDemoSandbox(raw);
  try {
    persistedRaw = localStorage.getItem(key);
  } catch {}
  recoveryRaw = null;
  persist(restored);
}

export function captureDemoAssistantContext(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  selectedAssetId?: string,
  factoryId?: string,
) {
  return buildDemoAssistantContext(
    readDemoSandbox(),
    question,
    history,
    selectedAssetId,
    factoryId,
  );
}

/** New factory actions re-read the current browser snapshot under a cross-tab lock. */
export async function changeDemoFactory(
  role: SandboxRole,
  action: Extract<SandboxAction, { type: `factory.${string}` }>,
) {
  const run = () => {
    if (!storageError) loaded = false;
    load();
    if (!current || recoveryRaw)
      throw Error("Open or recover the demo workspace first.");
    const before = current;
    persist(applySandboxAction(current, role, action));
    return { before, after: current! };
  };
  return navigator.locks ? navigator.locks.request(key, run) : run();
}
