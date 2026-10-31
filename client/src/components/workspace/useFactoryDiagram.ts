import { useEffect, useMemo, useState } from "react";
import type { FloorLink } from "@shared/factory-floor";
import type { InventoryItem } from "@shared/inventory";
import {
  demoFactoryDiagram,
  emptyFactoryDiagram,
  registeredProcessDiagram,
  validateFactoryDiagram,
  type DiagramMode,
  type FactoryDiagram,
} from "./factory-diagrams";

export const MAX_DIAGRAM_BYTES = 1_000_000;
type StoredDiagram = {
  key: string;
  document: FactoryDiagram | null;
  error: string;
  blocked: boolean;
};

function load(key: string, mode: DiagramMode): StoredDiagram {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return {
      key,
      document: null,
      blocked: false,
      error:
        "Browser storage is unavailable. Drawing changes will remain in this view only.",
    };
  }
  if (raw === null) return { key, document: null, error: "", blocked: false };
  try {
    if (raw.length > MAX_DIAGRAM_BYTES) throw Error("Drawing is too large.");
    return {
      key,
      document: validateFactoryDiagram(JSON.parse(raw), mode),
      error: "",
      blocked: false,
    };
  } catch {
    return {
      key,
      document: null,
      blocked: true,
      error:
        "The saved diagram could not be read. It has been retained. Reset the unreadable diagram before making changes.",
    };
  }
}

/** Drawings describe a user's local study, never operational plant connectivity. */
export function useFactoryDiagram({
  scope,
  mode,
  items,
  links,
  demo,
}: {
  scope: string;
  mode: DiagramMode;
  items: InventoryItem[];
  links: FloorLink[];
  demo: boolean;
}) {
  const key = `smart-factory:diagram:v1:${scope}:${mode}`;
  const [saved, setSaved] = useState(() => load(key, mode));
  const current = useMemo(
    () => (saved.key === key ? saved : load(key, mode)),
    [saved, key, mode],
  );
  const defaults = useMemo(() => {
    try {
      const registered =
        mode === "process"
          ? registeredProcessDiagram(items, links)
          : emptyFactoryDiagram(mode);
      if (registered.connections.length)
        return {
          document: registered,
          source: "registered" as const,
          error: "",
        };
      const example = demo
        ? demoFactoryDiagram(mode, items)
        : emptyFactoryDiagram(mode);
      return {
        document: example,
        source:
          demo && example.connections.length
            ? ("demo" as const)
            : ("empty" as const),
        error: "",
      };
    } catch {
      return {
        document: emptyFactoryDiagram(mode),
        source: "empty" as const,
        error:
          "The registered process drawing exceeds the 500-connection limit. Import a smaller drawing to inspect it here.",
      };
    }
  }, [mode, items, links, demo]);
  const document = current.document ?? defaults.document;
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSaved(load(key, mode));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, mode]);
  function persist(value: FactoryDiagram) {
    const next = validateFactoryDiagram(value, mode);
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_DIAGRAM_BYTES)
      throw Error("Use a drawing smaller than 1 MB.");
    let error = "";
    try {
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized)
        throw Error("Drawing was not saved.");
    } catch {
      error =
        "The drawing changed in this view, but could not be saved in this browser. Export it to keep your changes.";
    }
    setSaved({ key, document: next, blocked: false, error });
  }
  return {
    key,
    document,
    source: current.document ? ("local" as const) : defaults.source,
    error: current.error || (!current.document ? defaults.error : ""),
    blocked: current.blocked,
    save(value: FactoryDiagram) {
      if (current.blocked)
        throw Error("Reset the unreadable diagram before making changes.");
      persist(value);
    },
    importDocument(value: unknown) {
      if (current.blocked)
        throw Error("Reset the unreadable diagram before importing a drawing.");
      const next = validateFactoryDiagram(value, mode);
      const refs = new Set(items.map((item) => item.ref));
      if (
        next.connections.some(
          (link) => !refs.has(link.from) || !refs.has(link.to),
        )
      )
        throw Error(
          "Every connection must reference equipment in this factory and data workspace. Check the equipment references in the file.",
        );
      persist(next);
    },
    resetUnreadable() {
      try {
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null)
          throw Error("Drawing was not reset.");
        setSaved({ key, document: null, blocked: false, error: "" });
      } catch {
        setSaved({
          key,
          document: null,
          blocked: true,
          error:
            "The saved diagram could not be reset. Check browser storage and try again.",
        });
      }
    },
  };
}
