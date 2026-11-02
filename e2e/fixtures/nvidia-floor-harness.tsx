// Synthetic browser-only harness for the real floor component; not an app route.
import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../client/src/index.css";
import FactoryFloorScene from "../../client/src/components/workspace/FactoryFloorScene";
import { layoutFactory } from "../../shared/factory-floor";
import type { InventoryItem } from "../../shared/inventory";

const roots = new Map<string, Root>();
function Floor({ name, itemType }: { name: string; itemType: string }) {
  const [selected, setSelected] = useState<string | null>(null);
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
  const layout = layoutFactory([item]);
  // Put the single synthetic item at the camera target for direct picking.
  layout.placements[0].x = 0;
  layout.placements[0].z = 0;
  return (
    <>
      <div data-testid="selected">{selected ?? "none"}</div>
      <div style={{ width: "100%", height: 420 }}>
        <FactoryFloorScene
          layout={layout}
          links={[]}
          selected={selected}
          onSelect={setSelected}
          dark={false}
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
      mount: (id: string, name: string, itemType: string) => void;
      unmount: (id: string) => void;
    };
  }
}
window.floorNvidiaHarness = {
  mount(id, name, itemType) {
    if (roots.has(id)) throw new Error("Fixture already mounted");
    const host = document.createElement("section");
    host.id = id;
    document.body.append(host);
    const root = createRoot(host);
    roots.set(id, root);
    root.render(<Floor name={name} itemType={itemType} />);
  },
  unmount(id) {
    const root = roots.get(id);
    if (!root) throw new Error("Fixture not mounted");
    root.unmount();
    roots.delete(id);
    document.getElementById(id)?.remove();
  },
};
