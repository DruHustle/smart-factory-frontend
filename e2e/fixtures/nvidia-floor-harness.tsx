// Synthetic browser-only harness for the real floor component; not an app route.
import React, { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../client/src/index.css";
import FactoryFloorScene from "../../client/src/components/workspace/FactoryFloorScene";
import { FactoryConnectionLayer } from "../../client/src/components/workspace/factory-connections";
import { layoutFactory } from "../../shared/factory-floor";
import type { InventoryItem } from "../../shared/inventory";

const roots = new Map<string, Root>();
const themes = new Map<string, (dark: boolean) => void>();
function Floor({
  id,
  name,
  itemType,
  count,
  movable,
  second,
}: {
  id: string;
  name: string;
  itemType: string;
  count: number;
  movable: boolean;
  second?: { name: string; type: string };
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    themes.set(id, setDark);
    return () => {
      themes.delete(id);
    };
  }, [id]);
  const item: InventoryItem = {
    ref: "asset:1",
    kind: "asset",
    id: "1",
    name,
    identifier: "synthetic-1",
    itemType,
    location: null,
    zone: "Assembly",
    configured: false,
    route: "Not configured",
    status: "unknown",
    lastObserved: null,
    sampleAt: null,
    mode: "simulated",
    quality: "unknown",
    freshnessMs: null,
    lifecycle: null,
    aas: false,
    equipmentId: null,
    firmware: null,
  };
  const items = Array.from({ length: count }, (_, index) => ({
    ...item,
    ref: `asset:${index + 1}`,
    id: String(index + 1),
    identifier: `synthetic-${index + 1}`,
    ...(index === 1 && second
      ? { name: second.name, itemType: second.type }
      : {}),
  }));
  const layout = layoutFactory(items);
  // Put synthetic items around the camera target for direct picking.
  layout.placements.forEach((placement, index) => {
    placement.x = (index - (count - 1) / 2) * 3;
    placement.z = 0;
  });
  return (
    <>
      <div data-testid="selected">{selected ?? "none"}</div>
      <div data-testid="theme">{dark ? "dark" : "light"}</div>
      {movable && <div data-testid="dragged">{dragged ?? "none"}</div>}
      {movable && <div data-testid="moves">{moves}</div>}
      <div style={{ width: "100%", height: 420 }}>
        <FactoryFloorScene
          layout={layout}
          links={[]}
          selected={selected}
          onSelect={setSelected}
          onMove={movable ? () => setMoves((count) => count + 1) : undefined}
          onItemDrag={
            movable ? (item) => setDragged(item?.ref ?? null) : undefined
          }
          dark={dark}
          reset={0}
          zone="all"
        />
      </div>
    </>
  );
}

declare global {
  interface Window {
    floorNvidiaHarness: {
      mount: (
        id: string,
        name: string,
        itemType: string,
        count?: number,
        movable?: boolean,
        second?: { name: string; type: string },
      ) => void;
      unmount: (id: string) => void;
      setTheme: (id: string, dark: boolean) => void;
      themeReady: (id: string) => boolean;
      failConnections: () => void;
    };
  }
}
window.floorNvidiaHarness = {
  mount(id, name, itemType, count = 1, movable = false, second) {
    if (roots.has(id)) throw new Error("Fixture already mounted");
    const host = document.createElement("section");
    host.id = id;
    document.body.append(host);
    const root = createRoot(host);
    roots.set(id, root);
    root.render(
      <Floor
        id={id}
        name={name}
        itemType={itemType}
        count={count}
        movable={movable}
        second={second}
      />,
    );
  },
  setTheme(id, dark) {
    const update = themes.get(id);
    if (!update) throw new Error("Fixture not mounted");
    update(dark);
  },
  themeReady(id) {
    return themes.has(id);
  },
  failConnections() {
    FactoryConnectionLayer.prototype.update = () => {
      throw new Error("Synthetic connection update failure");
    };
  },
  unmount(id) {
    const root = roots.get(id);
    if (!root) throw new Error("Fixture not mounted");
    root.unmount();
    roots.delete(id);
    document.getElementById(id)?.remove();
  },
};
