import { describe, expect, it } from "vitest";
import {
  analyseProduction,
  counterDelta,
  defaultOperationsConfiguration,
  operationsConfiguration,
  productionPeriod,
  resolveShift,
  operationScenarios,
  type ProductionRecord,
} from "../../shared/operations";
import { demoOperations } from "./demo";

const start = Date.parse("2026-11-02T06:00:00Z"),
  end = start + 3600000;
const record = (patch: Partial<ProductionRecord> = {}): ProductionRecord => ({
  id: 1,
  startTime: start,
  endTime: end,
  product: "Part A",
  totalCount: 400,
  goodCount: 380,
  idealCycleSeconds: 6,
  meterStartKwh: 100,
  meterEndKwh: 110,
  meterBoundary: "Line A",
  boundaryLabel: "Line A",
  complete: true,
  evidence: "Verified shift sheet",
  downtime: [
    {
      startTime: start,
      endTime: start + 600000,
      reason: "Jam",
      planned: false,
    },
  ],
  provenance: "manual",
  author: "Engineer",
  recordedAt: new Date(end).toISOString(),
  ...patch,
});

describe("configured local shift boundaries", () => {
  const config = {
    ...defaultOperationsConfiguration,
    boundaryLabel: "Line A",
    timeZone: "Europe/Berlin",
    shifts: [
      { id: "early", name: "Early", startMinute: 0 },
      { id: "day", name: "Day", startMinute: 480 },
      { id: "late", name: "Late", startMinute: 960 },
    ],
  };
  it("uses actual elapsed time across spring and autumn clock changes", () => {
    const spring = resolveShift(config, Date.parse("2026-03-29T03:00:00Z"));
    expect((spring.endTime - spring.startTime) / 3600000).toBe(7);
    const autumn = resolveShift(config, Date.parse("2026-10-25T03:00:00Z"));
    expect((autumn.endTime - autumn.startTime) / 3600000).toBe(9);
  });
  it("treats exact boundaries as the next shift and supports overnight selection", () => {
    const current = resolveShift(config, Date.parse("2026-11-02T12:00:00Z"));
    const prior = resolveShift(config, current.startTime - 1),
      next = resolveShift(config, current.endTime);
    expect(prior.endTime).toBe(current.startTime);
    expect(next.startTime).toBe(current.endTime);
    const night = resolveShift(
      defaultOperationsConfiguration,
      Date.parse("2026-11-02T02:00:00Z"),
    );
    expect(new Date(night.startTime).toISOString()).toBe(
      "2026-11-01T22:00:00.000Z",
    );
  });
  it("uses the first repeated local time and advances a missing time by the gap", () => {
    const unusual = {
      ...config,
      shifts: [
        { id: "a", name: "A", startMinute: 150 },
        { id: "b", name: "B", startMinute: 600 },
      ],
    };
    expect(
      resolveShift(unusual, Date.parse("2026-10-25T01:00:00Z")).startTime,
    ).toBe(Date.parse("2026-10-25T00:30:00Z"));
    expect(
      resolveShift(unusual, Date.parse("2026-03-29T02:00:00Z")).startTime,
    ).toBe(Date.parse("2026-03-29T01:30:00Z"));
  });
  it("rejects ambiguous configuration and invalid input periods", () => {
    expect(
      operationsConfiguration.safeParse({ ...config, timeZone: "not/a/zone" })
        .success,
    ).toBe(false);
    expect(
      operationsConfiguration.safeParse({
        ...config,
        shifts: [config.shifts[0], config.shifts[0]],
      }).success,
    ).toBe(false);
    const { id, provenance, author, recordedAt, boundaryLabel, ...input } =
      record();
    expect(
      productionPeriod.safeParse({ ...input, goodCount: 401 }).success,
    ).toBe(false);
    expect(
      productionPeriod.safeParse({
        ...input,
        downtime: [
          {
            startTime: start - 1,
            endTime: end,
            reason: "Outside",
            planned: false,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("traceable production and utilities", () => {
  it("calculates OEE from the underlying times and quantities", () => {
    const result = analyseProduction([record()], start, end, "Line A");
    expect(result.availability).toBeCloseTo(5 / 6);
    expect(result.performance).toBeCloseTo(0.8);
    expect(result.quality).toBeCloseTo(0.95);
    expect(result.oee).toBeCloseTo((5 / 6) * 0.8 * 0.95);
    expect(result.energyPerGoodUnit).toBeCloseTo(10 / 380);
    expect(result.coveragePercent).toBe(100);
    expect(result.recordIds).toEqual([1]);
  });
  it("unions overlaps, gives planned shutdown precedence and reconciles reason totals", () => {
    const result = analyseProduction(
      [
        record({
          totalCount: 300,
          goodCount: 290,
          downtime: [
            {
              startTime: start,
              endTime: start + 10 * 60000,
              reason: "Planned",
              planned: true,
            },
            {
              startTime: start + 5 * 60000,
              endTime: start + 15 * 60000,
              reason: "Jam",
              planned: false,
            },
            {
              startTime: start + 14 * 60000,
              endTime: start + 20 * 60000,
              reason: "Low air",
              planned: false,
            },
          ],
        }),
      ],
      start,
      end,
      "Line A",
    );
    expect(result.plannedProductionSeconds).toBe(3000);
    expect(result.operatingSeconds).toBe(2400);
    expect(result.unplannedDowntimeSeconds).toBe(600);
    expect(result.downtimeReasons.reduce((sum, r) => sum + r.seconds, 0)).toBe(
      600,
    );
    expect(result.downtimeReasons.map((r) => r.seconds)).toEqual([300, 300]);
  });
  it("weights different product cycles through the recorded periods", () => {
    const a = record({
      endTime: start + 1800000,
      downtime: [],
      totalCount: 150,
      goodCount: 140,
      idealCycleSeconds: 6,
      meterEndKwh: 105,
    });
    const b = record({
      id: 2,
      startTime: start + 1800000,
      downtime: [],
      totalCount: 100,
      goodCount: 95,
      idealCycleSeconds: 12,
      meterStartKwh: 105,
    });
    const result = analyseProduction([a, b], start, end, "Line A");
    expect(result.performance).toBeCloseTo((150 * 6 + 100 * 12) / 3600);
    expect(result.quality).toBeCloseTo(235 / 250);
    expect(result.energyKwh).toBe(10);
  });
  it("keeps missing periods and incomplete records out of whole-window OEE", () => {
    const result = analyseProduction(
      [record({ endTime: start + 1800000, totalCount: 100, goodCount: 99 })],
      start,
      end,
      "Line A",
    );
    expect(result.coveragePercent).toBe(50);
    expect(result.oee).toBeNull();
    expect(result.energyPerGoodUnit).toBeNull();
    expect(
      analyseProduction([record({ complete: false })], start, end, "Line A")
        .oee,
    ).toBeNull();
    expect(analyseProduction([], start, end, "Line A")).toMatchObject({
      oee: null,
      totalCount: null,
      energyKwh: null,
    });
  });
  it("never prorates counters or double-counts overlapping production periods", () => {
    expect(
      analyseProduction([record()], start + 1, end, "Line A"),
    ).toMatchObject({ totalCount: null, oee: null, excludedRecordIds: [1] });
    expect(
      analyseProduction([record(), record({ id: 2 })], start, end, "Line A"),
    ).toMatchObject({ totalCount: null, oee: null });
    expect(
      analyseProduction(
        [record({ boundaryLabel: "Shared factory meter" })],
        start,
        end,
        "Line A",
      ).oee,
    ).toBeNull();
  });
  it("makes meter reset, unmatched boundary and invalid ideal rates explicit", () => {
    expect(counterDelta(100, 10)).toMatchObject({ value: null });
    const reset = analyseProduction(
      [record({ meterEndKwh: 10 })],
      start,
      end,
      "Line A",
    );
    expect(reset.energyKwh).toBeNull();
    expect(reset.oee).not.toBeNull();
    expect(reset.reasons.join(" ")).toContain("reset");
    expect(
      analyseProduction(
        [record({ meterBoundary: "Other line" })],
        start,
        end,
        "Line A",
      ).energyPerGoodUnit,
    ).toBeNull();
    const invalid = analyseProduction(
      [record({ idealCycleSeconds: 20 })],
      start,
      end,
      "Line A",
    );
    expect(invalid.performance).toBeNull();
    expect(invalid.oee).toBeNull();
  });
});

describe("coherent recorded OT scenarios", () => {
  const showcase = {
    anchor: new Date(end).toISOString(),
    assetRef: "asset:12",
    sensorRef: "device:10",
    gatewayRef: "device:11",
    incidentId: 23,
  } as import("../../shared/showcase").Showcase;
  for (const scenario of operationScenarios)
    it(`${scenario} reuses canonical identities and reconciles its counts to displayed rates`, () => {
      const result = demoOperations(scenario, showcase),
        points = result.evidence!.signals;
      expect(result.evidence!.assetRef).toBe("asset:12");
      const produced = Math.floor(
        points
          .slice(0, -1)
          .reduce(
            (sum, p, i) =>
              sum +
              ((p.outputPerMinute ?? 0) * (points[i + 1].at - p.at)) / 60000,
            0,
          ),
      );
      expect(result.records[0].totalCount).toBe(produced);
      expect(result.analysis.totalCount).toBe(produced);
      expect(
        result.analysis.downtimeReasons.reduce((sum, r) => sum + r.seconds, 0),
      ).toBe(result.analysis.unplannedDowntimeSeconds);
      expect(result.demo).toBe(true);
    });
  it("shows an outage as unknown equipment state and missing coverage rather than a stop", () => {
    const result = demoOperations("gateway-outage", showcase);
    expect(result.evidence).toMatchObject({
      operatingState: "unknown",
      condition: "unknown",
      connectivity: "disconnected",
    });
    expect(result.analysis).toMatchObject({
      coveragePercent: 50,
      oee: null,
      unplannedDowntimeSeconds: 0,
    });
    expect(
      result.evidence!.signals.filter((p) => p.pressureBar == null).length,
    ).toBeGreaterThan(0);
  });
  it("keeps the terminal maintenance plot point stopped without inventing a restart", () => {
    const result = demoOperations("maintenance", showcase);
    expect(result.evidence!.operatingState).toBe("maintenance");
    expect(result.evidence!.signals.at(-1)).toMatchObject({
      at: result.analysis.endTime,
      outputPerMinute: 0,
    });
    expect(result.records[0].totalCount).toBe(288);
    expect(result.analysis.plannedProductionSeconds).toBe(1800);
  });
});
