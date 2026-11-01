import { expect, it } from "vitest";
import {
  inventoryFilters,
  listPage,
  monitoringFilters,
} from "../client/src/lib/list-filters";
import { inventoryFilter } from "./inventory";
import { monitoringInput } from "./monitoring";

it("recovers malformed bookmark pagination without sending rejected API inputs", () => {
  for (const value of [
    "Infinity",
    "NaN",
    "-1",
    "0.5",
    "100001",
    "9007199254740993",
    "bad",
  ])
    expect(listPage(value)).toBe(0);
  expect(listPage(null)).toBe(0);
  expect(listPage("3")).toBe(3);
  expect(listPage("100000")).toBe(100000);
});

it("keeps long searches and obsolete inventory bookmarks inside the actual API contract", () => {
  const params = new URLSearchParams({
    search: "s".repeat(200),
    zone: "z".repeat(200),
    page: "Infinity",
    view: "retired",
    status: "online",
    mode: "invalid",
    capability: "unsupported",
    sort: "invalid",
  });
  const filter = inventoryFilters(params);
  expect(inventoryFilter.safeParse(filter).success).toBe(true);
  expect(filter).toMatchObject({
    page: 0,
    view: "all",
    status: "all",
    mode: "all",
    capability: "all",
    sort: "name",
  });
  expect(filter.search).toHaveLength(100);
  expect(filter.zone).toHaveLength(100);
  expect(
    inventoryFilters(
      new URLSearchParams(
        "view=gateways&status=stale&mode=replay&capability=3d&sort=recent&page=2",
      ),
    ),
  ).toMatchObject({
    view: "gateways",
    status: "stale",
    mode: "replay",
    capability: "3d",
    sort: "recent",
    page: 2,
  });
});

it("recovers invalid monitoring filters and retains the demo evidence default", () => {
  const params = new URLSearchParams({
    search: "s".repeat(200),
    type: "retired",
    status: "online",
    scope: "invalid",
    page: "1.5",
  });
  const { scope, ...filter } = monitoringFilters(params, true);
  expect(scope).toBe("simulated");
  expect(monitoringInput.safeParse(filter).success).toBe(true);
  expect(filter).toMatchObject({ type: "all", status: "all", page: 0 });
  expect(
    monitoringFilters(
      new URLSearchParams("type=gateway&status=stale&scope=live&page=2"),
    ),
  ).toMatchObject({ type: "gateway", status: "stale", scope: "live", page: 2 });
});
