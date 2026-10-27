import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
function subscribe(listener: () => void) {
  if (!listeners.size) { document.addEventListener("visibilitychange",notify); window.addEventListener("online",notify); window.addEventListener("offline",notify); }
  listeners.add(listener);
  return () => { listeners.delete(listener); if(!listeners.size){document.removeEventListener("visibilitychange",notify);window.removeEventListener("online",notify);window.removeEventListener("offline",notify);} };
}
export const useDocumentActive = () => useSyncExternalStore(subscribe,()=>!document.hidden&&navigator.onLine,()=>false);
