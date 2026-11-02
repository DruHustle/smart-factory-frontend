import { describe, expect, it } from "vitest";
import { inventoryLocation } from "../client/src/lib/inventory-location";

describe("inventory location display", () => {
  it("shows an identical zone and location only once", () => {
    expect(inventoryLocation("Assembly", "Assembly")).toBe("Assembly");
  });

  it("keeps the complete location when it already includes the zone", () => {
    expect(inventoryLocation("Assembly", "Assembly · illustrative floor")).toBe(
      "Assembly · illustrative floor",
    );
    expect(inventoryLocation("Assembly · Line 2", "Assembly")).toBe(
      "Assembly · Line 2",
    );
  });

  it("retains distinct location details and does not confuse a word prefix", () => {
    expect(inventoryLocation("Assembly", "Building B")).toBe(
      "Assembly · Building B",
    );
    expect(inventoryLocation("Assembly", "Assembly line 2")).toBe(
      "Assembly · Assembly line 2",
    );
  });

  it("handles missing and padded values without adding separators", () => {
    expect(inventoryLocation(null, " Building B ")).toBe("Building B");
    expect(inventoryLocation(" Assembly ", undefined)).toBe("Assembly");
    expect(inventoryLocation(" ", null)).toBe("");
  });
});
