import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceLocation } from "@/lib/hashLocation";

const listeners = new Set<() => void>(),
  memory = new Map<string, string | null>();
const emit = () => listeners.forEach((fn) => fn());
const identity =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key.startsWith("smart-factory:selected-factory:v1:")
    )
      emit();
  });
  window.addEventListener("smart-factory:factory-selection", emit);
}
function read(key: string) {
  try {
    const value = localStorage.getItem(key);
    return value && identity.test(value) ? value : null;
  } catch {
    return memory.get(key) ?? null;
  }
}
export function useFactorySelection() {
  const { user } = useAuth(),
    [location, navigate] = useWorkspaceLocation();
  const demo =
    !!user?.access?.demoOnly || user?.access?.workspaceView === "demo";
  const scope =
    (user?.access?.demoOnly ? "demo-visitor" : (user?.id ?? "anonymous")) +
    ":" +
    (user?.access?.workspaceView ?? "configured");
  const key = "smart-factory:selected-factory:v1:" + scope;
  const saved = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => read(key),
    () => null,
  );
  const linked = new URLSearchParams(location.split("?")[1] ?? "").get(
    "factory",
  );
  useEffect(() => {
    if (!linked || !identity.test(linked) || read(key) === linked) return;
    memory.set(key, linked);
    try {
      localStorage.setItem(key, linked);
    } catch {}
    emit();
  }, [linked, key]);
  const id = linked && identity.test(linked) ? linked : saved;
  const select = (next: string | null) => {
    memory.set(key, next);
    try {
      next ? localStorage.setItem(key, next) : localStorage.removeItem(key);
    } catch {
      /* Selection remains usable in this tab. */
    }
    emit();
    const page = location.split("?")[0].startsWith("/inventory")
      ? "/inventory"
      : "/";
    navigate(page + (next ? "?factory=" + encodeURIComponent(next) : ""));
  };
  return { id, select, scope, demo };
}
