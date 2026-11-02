// Isolated browser fixture for the real 3D loading handoff.
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../client/src/index.css";
import { FactorySceneStage } from "../../client/src/components/workspace/FactorySceneStage";
import { FactoryConnectionLayer } from "../../client/src/components/workspace/factory-connections";
import * as THREE from "three";
import { layoutFactory } from "../../shared/factory-floor";
import type { InventoryItem } from "../../shared/inventory";

declare global {
  interface Window {
    floorStageHarness: {
      failConnections: () => void;
      disposedGeometries: number;
    };
  }
}
const originalDispose = THREE.BufferGeometry.prototype.dispose;
window.floorStageHarness = {
  disposedGeometries: 0,
  failConnections() {
    FactoryConnectionLayer.prototype.update = () => {
      throw Error("Synthetic mount failure");
    };
  },
};
THREE.BufferGeometry.prototype.dispose = function () {
  window.floorStageHarness.disposedGeometries++;
  return originalDispose.call(this);
};

function Fixture() {
  const [selected, setSelected] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  const [dragged, setDragged] = useState<string | null>(null);
  const [alternate, setAlternate] = useState(false);
  const item: InventoryItem = {
    ref: "asset:1",
    kind: "asset",
    id: "1",
    name: alternate ? "Warehouse rack" : "Transfer conveyor",
    identifier: "synthetic-1",
    itemType: alternate ? "warehouse_rack" : "conveyor",
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
  const layout = useMemo(() => layoutFactory([item]), [alternate]);
  return (
    <>
      <div data-testid="selected">{selected ?? "none"}</div>
      <div data-testid="moves">{moves}</div>
      <div data-testid="dragged">{dragged ?? "none"}</div>
      <button type="button" onClick={() => setAlternate((value) => !value)}>
        Change equipment
      </button>
      <div id="stage" style={{ width: "100%", height: 420 }}>
        <FactorySceneStage
          layout={layout}
          links={[]}
          selected={selected}
          onSelect={setSelected}
          onMove={() => setMoves((value) => value + 1)}
          onItemDrag={(value) => setDragged(value?.ref ?? null)}
          dark={false}
          reset={0}
          zone="all"
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
