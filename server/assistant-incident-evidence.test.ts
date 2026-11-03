import { describe, expect, it } from "vitest";
import { incidentSourceSummary } from "./assistantInvestigation";

describe("Assistant incident source evidence", () => {
  it("distinguishes expired source proof from an acknowledged investigation", () => {
    const result = incidentSourceSummary({
      currentCondition: "unknown",
      sourceCondition: "active",
      acknowledged: true,
      conditionReason: "sample_expired",
      conditionEvidence: { occurredAt: Date.parse("2026-11-02T10:00:00Z"), value: 3.4, unit: "mm/s" },
      conditionValidUntil: "2026-11-02T10:05:00Z",
    });
    expect(result).toContain("Current source condition: unknown");
    expect(result).toContain("acknowledgement: acknowledged");
    expect(result).toContain("exceeded its maximum age");
    expect(result).toContain("Last verified source evidence: 3.4 mm/s at 2026-11-02T10:00:00.000Z (active)");
    expect(result).toContain("Evidence validity ends 2026-11-02T10:05:00.000Z");
  });
  it("does not invent source proof for an unverified incident", () => {
    const result = incidentSourceSummary({ currentCondition: "unknown", acknowledged: false });
    expect(result).toContain("unacknowledged");
    expect(result).toContain("No verified source observation is recorded");
  });
});
