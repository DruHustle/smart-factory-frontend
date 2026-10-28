import { expect, it } from "vitest";
import {
  analysisRange,
  parseAnalysisDate,
} from "../client/src/lib/analysis-range";
const anchor = Date.parse("2026-10-28T12:00:00Z");

it("keeps a custom range invalid and editable after either date is cleared", () => {
  for (const query of [
    "range=custom&to=2026-10-28T12:00",
    "range=custom&from=2026-10-28T11:00",
    "range=custom",
  ]) {
    const range = analysisRange(new URLSearchParams(query), anchor, "7d");
    expect(range.custom).toBe(true);
    expect(range.valid).toBe(false);
  }
});

it("accepts UTC links and rejects invalid, reversed, pre-epoch or excessive custom dates", () => {
  expect(parseAnalysisDate("2026-10-28T12:00Z")).toBe(anchor);
  expect(parseAnalysisDate("2026-10-28T12:00")).toBe(anchor);
  expect(parseAnalysisDate("2026-02-30T12:00")).toBeNaN();
  for (const [from, to] of [
    ["invalid", "2026-10-28T12:00"],
    ["2026-10-29T00:00", "2026-10-28T00:00"],
    ["1969-12-31T00:00", "1970-01-01T00:01"],
    ["2026-01-01T00:00", "2026-10-28T00:00"],
  ]) {
    expect(
      analysisRange(new URLSearchParams({ from, to }), anchor, "7d").valid,
    ).toBe(false);
  }
});

it("normalizes malformed aggregation and preset links into supported API inputs", () => {
  for (const interval of ["60000.5", "Infinity", "bad", "-1"])
    expect(
      analysisRange(
        new URLSearchParams({ interval, range: "bad" }),
        anchor,
        "1h",
      ),
    ).toMatchObject({
      valid: true,
      custom: false,
      range: "1h",
      intervalMs: 60000,
      startTime: anchor - 3600000,
    });
});
