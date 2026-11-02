import { describe, expect, it } from "vitest";
import type { FloorLayout } from "../client/src/components/workspace/floor-arrangement";
import {
  findExplorePosition,
  isExplorePositionClear,
  moveExplorePosition,
} from "../client/src/components/workspace/floor-explore-navigation";

const layout = {
  width: 12,
  depth: 10,
  zones: [],
  placements: [
    {
      item: { ref: "equipment:conveyor" },
      x: 0,
      z: 0,
      rotation: 45,
      dimensions: { width: 3, depth: 1, height: 2 },
    },
  ],
} as unknown as FloorLayout;

describe("explore camera navigation", () => {
  it("starts at a clear bounded point and can approach a selected item", () => {
    const start = findExplorePosition(layout);
    const focused = findExplorePosition(layout, "equipment:conveyor");
    expect(start && isExplorePositionClear(layout, start)).toBe(true);
    expect(focused && isExplorePositionClear(layout, focused)).toBe(true);
    expect(Math.hypot(focused!.x, focused!.z)).toBeLessThan(
      Math.hypot(start!.x, start!.z),
    );
  });

  it("stops at the floor boundary and cannot tunnel through a rotated footprint", () => {
    const nearEdge = { x: 5.5, z: 4 };
    const edged = moveExplorePosition(layout, nearEdge, 100, 0);
    expect(edged.x).toBeLessThanOrEqual(layout.width / 2 - 0.35);
    expect(isExplorePositionClear(layout, edged)).toBe(true);
    const beforeItem = { x: 0, z: 3 };
    const blocked = moveExplorePosition(layout, beforeItem, 0, -6);
    expect(blocked.z).toBeGreaterThan(0);
    expect(isExplorePositionClear(layout, blocked)).toBe(true);
  });

  it("returns no spawn when the floor is fully obstructed and rejects invalid input", () => {
    const blocked = {
      ...layout,
      placements: [
        {
          ...layout.placements[0],
          dimensions: { width: 30, depth: 30, height: 2 },
        },
      ],
    } as FloorLayout;
    expect(findExplorePosition(blocked)).toBeNull();
    const start = { x: 4, z: 4 };
    expect(moveExplorePosition(layout, start, Number.NaN, 1)).toEqual(start);
  });
});
