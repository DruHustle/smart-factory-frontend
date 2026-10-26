import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBatch, digest } from "./contract";
import { parseReport } from "./reports";
for (const mode of ["simulated", "replay"])
  for (const extension of ["json", "ndjson"])
    it(`independently validates the owned ${mode} ${extension} fixture`, () => {
      const events = parseBatch(
        readFileSync(`fixtures/security/v1/${mode}.${extension}`),
        extension === "ndjson",
      );
      expect(events).toHaveLength(5);
      expect(events.every((e) => e.mode === mode)).toBe(true);
    });
it("preserves original report bytes and separate advisory CVSS", () => {
  const raw = readFileSync("fixtures/security/trivy-schema2.json", "utf8"),
    parsed = parseReport(raw);
  expect(parsed.sha256).toBe(digest(raw));
  expect(parsed.report.Results[0].Vulnerabilities[0].CVSS?.nvd?.V3Score).toBe(
    7.5,
  );
  expect(parseReport(raw + "\n").sha256).not.toBe(parsed.sha256);
});
for (const change of [
  { SchemaVersion: 3 },
  { Metadata: { arbitrary: "unsupported" } },
  { CreatedAt: "2026-02-30T00:00:00Z" },
])
  it(`rejects unsupported report profile ${JSON.stringify(change)}`, () => {
    const report = JSON.parse(
      readFileSync("fixtures/security/trivy-schema2.json", "utf8"),
    );
    expect(() => parseReport(JSON.stringify({ ...report, ...change }))).toThrow(
      "unsupported_trivy_subset",
    );
  });
it("rejects oversized reports and CVSS outside its documented numeric range", () => {
  expect(() => parseReport("x".repeat(4194305))).toThrow("report_too_large");
  const report = JSON.parse(
    readFileSync("fixtures/security/trivy-schema2.json", "utf8"),
  );
  report.Results[0].Vulnerabilities[0].CVSS.nvd.V3Score = 10.1;
  expect(() => parseReport(JSON.stringify(report))).toThrow(
    "unsupported_trivy_subset",
  );
});
