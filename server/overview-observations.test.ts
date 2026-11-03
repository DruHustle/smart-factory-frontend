import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../shared/inventory";
import {
  ALL_ASSET_OBSERVATIONS,
  selectOverviewObservationSource,
} from "../client/src/lib/overview-observations";

const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  ref: "asset:1",
  kind: "asset",
  id: "1",
  name: "Robot",
  identifier: "robot-01",
  itemType: "robot",
  location: null,
  zone: null,
  configured: true,
  route: "Registered",
  status: "unknown",
  lastObserved: null,
  sampleAt: null,
  mode: "unknown",
  quality: "unknown",
  freshnessMs: null,
  lifecycle: null,
  aas: true,
  equipmentId: null,
  firmware: null,
  ...overrides,
});
const sensor = item({
  ref: "device:1",
  kind: "device",
  id: "1",
  name: "WROVER temperature sensor",
  identifier: "wrover-01",
  itemType: "edge_device",
  values: { temperature: 21.5 },
  sampleAt: 1000,
});
const measuredEquipment = item({
  ref: "equipment:00000000-0000-4000-8000-000000000001",
  kind: "equipment",
  id: "00000000-0000-4000-8000-000000000001",
  identifier: "local-pump-01",
  name: "Independent pump",
  itemType: "3D equipment",
  mode: "live",
  sampleAt: 1000,
  evidence: { eligible: true, validForMs: 30000 },
  measurements: {
    temperature: {
      sourceValue: 21.5,
      sourceUnit: "°C",
      canonicalValue: 21.5,
      canonicalUnit: "°C",
      conversionVersion: "sf-units-v1",
      quality: "good",
    },
  },
});

describe("overview observation source routing", () => {
  it("routes observed standalone equipment through its internal asset identity", () => {
    const result = selectOverviewObservationSource(
      [item({}), sensor, measuredEquipment],
      "temperature",
      null,
      3000,
    );
    expect(result.value).toBe(measuredEquipment.ref);
    expect(result.label).toBe("Independent pump");
    expect(result.input).toEqual({ assetIds: ["local-pump-01"] });
    expect(result.source?.evidence?.eligible).toBe(true);
  });

  it("retains explicitly selected equipment when changing to an unobserved metric", () => {
    const result = selectOverviewObservationSource(
      [measuredEquipment, sensor],
      "pressure",
      measuredEquipment.ref,
      3000,
    );
    expect(result.selection).toBe(measuredEquipment.ref);
    expect(result.input).toEqual({ assetIds: ["local-pump-01"] });
  });

  it("includes observed standalone equipment in asset aggregation without admitting static models", () => {
    const result = selectOverviewObservationSource(
      [
        item({}),
        measuredEquipment,
        item({
          kind: "equipment",
          ref: "equipment:static",
          identifier: "static-model",
        }),
      ],
      "temperature",
      ALL_ASSET_OBSERVATIONS,
      3000,
    );
    expect(result.input).toEqual({ assetIds: ["robot-01", "local-pump-01"] });
    expect(result.sources.map((source) => source.ref)).toEqual([
      "asset:1",
      measuredEquipment.ref,
    ]);
  });

  it("does not promote unverified equipment above an eligible device observation", () => {
    const unverifiedEquipment = item({
      ...measuredEquipment,
      sampleAt: 2000,
      sourceContinuity: {
        offline: true,
        interruptedAt: 2000,
        commissioningRevision: null,
      },
    });
    const verifiedSensor = item({
      ...sensor,
      mode: "live",
      evidence: measuredEquipment.evidence,
      measurements: measuredEquipment.measurements,
    });
    expect(
      selectOverviewObservationSource(
        [unverifiedEquipment, verifiedSensor],
        "temperature",
        null,
        3000,
      ).input,
    ).toEqual({ deviceId: 1 });
  });

  it("shows direct device readings when the only registered asset has no measurements", () => {
    const result = selectOverviewObservationSource(
      [item({}), sensor],
      "temperature",
      null,
    );
    expect(result.value).toBe("device:1");
    expect(result.label).toBe("WROVER temperature sensor");
    expect(result.input).toEqual({ deviceId: 1 });
  });

  it("keeps explicit asset selection separate from a device with the same numeric ID", () => {
    const result = selectOverviewObservationSource(
      [item({}), sensor],
      "temperature",
      "asset:1",
    );
    expect(result.input).toEqual({ assetIds: ["robot-01"] });
  });

  it("preserves an explicitly selected device even when the chosen metric has no readings", () => {
    expect(
      selectOverviewObservationSource(
        [item({}), sensor],
        "pressure",
        "device:1",
      ).input,
    ).toEqual({ deviceId: 1 });
  });

  it("excludes static equipment and gateway identity from aggregate asset readings", () => {
    const result = selectOverviewObservationSource(
      [
        item({}),
        sensor,
        item({
          kind: "equipment",
          ref: "equipment:model",
          identifier: "model-only",
        }),
        item({
          kind: "device",
          ref: "device:2",
          id: "2",
          itemType: "gateway",
          values: { temperature: 99 },
        }),
      ],
      "temperature",
      ALL_ASSET_OBSERVATIONS,
    );
    expect(result.input).toEqual({ assetIds: ["robot-01"] });
    expect(result.sources.map((source) => source.ref)).toEqual([
      "asset:1",
      "device:1",
    ]);
  });

  it("uses the newest observed source without treating its values as verified", () => {
    const newer = item({
      ...sensor,
      ref: "device:3",
      id: "3",
      values: undefined,
      sampleAt: 2000,
      measurements: {
        temperature: {
          sourceValue: 23,
          sourceUnit: null,
          canonicalValue: null,
          canonicalUnit: null,
          conversionVersion: null,
          quality: "unknown",
        },
      },
    });
    const result = selectOverviewObservationSource(
      [sensor, newer],
      "temperature",
      null,
    );
    expect(result.input).toEqual({ deviceId: 3 });
    expect(result.source?.measurements?.temperature?.quality).toBe("unknown");
  });

  it("does not prefer a NaN reading over a valid source", () => {
    const invalid = item({
      ...sensor,
      ref: "device:4",
      id: "4",
      sampleAt: 3000,
      values: { temperature: NaN },
    });
    expect(
      selectOverviewObservationSource([invalid, sensor], "temperature", null)
        .input,
    ).toEqual({ deviceId: 1 });
  });

  it("prefers current eligible canonical measurements over a newer unverified source", () => {
    const verified = item({
      ...sensor,
      mode: "live",
      evidence: { eligible: true, validForMs: 30000 },
      measurements: {
        temperature: {
          sourceValue: 21.5,
          sourceUnit: "°C",
          canonicalValue: 21.5,
          canonicalUnit: "°C",
          conversionVersion: "sf-units-v1",
          quality: "good",
        },
      },
    });
    const newer = item({ ...sensor, ref: "device:3", id: "3", sampleAt: 2000 });
    const result = selectOverviewObservationSource(
      [newer, verified],
      "temperature",
      null,
      3000,
    );
    expect(result.input).toEqual({ deviceId: 1 });
    expect(newer.mode).toBe("unknown");
    expect(result.source?.evidence?.eligible).toBe(true);
    expect(
      selectOverviewObservationSource(
        [newer, verified],
        "temperature",
        "device:3",
        3000,
      ).input,
    ).toEqual({ deviceId: 3 });
  });

  it("uses the shared continuity policy rather than promoting a disconnected canonical sample", () => {
    const canonical = {
      temperature: {
        sourceValue: 21.5,
        sourceUnit: "°C",
        canonicalValue: 21.5,
        canonicalUnit: "°C",
        conversionVersion: "sf-units-v1" as const,
        quality: "good" as const,
      },
    };
    const current = item({
      ...sensor,
      mode: "live",
      measurements: canonical,
      evidence: { eligible: true, validForMs: 30000 },
    });
    const interrupted = item({
      ...current,
      ref: "device:3",
      id: "3",
      sampleAt: 2000,
      sourceContinuity: {
        offline: true,
        interruptedAt: 2000,
        commissioningRevision: null,
      },
    });
    expect(
      selectOverviewObservationSource(
        [interrupted, current],
        "temperature",
        null,
        3000,
      ).input,
    ).toEqual({ deviceId: 1 });
  });

  it("recovers an unavailable saved source without inventing a device ID", () => {
    const result = selectOverviewObservationSource(
      [item({}), sensor],
      "temperature",
      "device:999",
    );
    expect(result.input).toEqual({ deviceId: 1 });
    expect(result.value).toBe("device:1");
  });

  it("does not issue an aggregate request above the API's 1000-asset bound", () => {
    const assets = Array.from({ length: 1001 }, (_, i) =>
      item({ ref: `asset:${i + 1}`, identifier: `asset-${i + 1}` }),
    );
    const result = selectOverviewObservationSource(
      assets,
      "temperature",
      ALL_ASSET_OBSERVATIONS,
    );
    expect(result.aggregateAvailable).toBe(false);
    expect(result.input).toEqual({ assetIds: ["asset-1"] });
  });
});
