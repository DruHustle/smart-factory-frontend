import { describe, expect, it } from "vitest";
import {
  decodeDemoPassport,
  demoPassportPath,
  encodeDemoPassport,
  MAX_DEMO_PASSPORT_TOKEN_LENGTH,
} from "../shared/demo-passport";

const identity = {
  assetId: "urn:demo:sandbox:pump-01",
  name: "Umwälzpumpe · Pump 01",
  assetType: "pump",
  manufacturer: "Example manufacturer",
  model: "SIM-PUMP-01",
  serialNumber: "DEMO-001",
  zone: "Wärmeversorgung",
};

describe("portable demo passport identity", () => {
  it("round-trips Unicode without browser storage, user identity or an API token", () => {
    const token = encodeDemoPassport(identity);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDemoPassport(token)).toEqual(identity);
    expect(demoPassportPath(identity)).toBe(`/passport/demo/${token}`);
    expect(token.length).toBeLessThan(600);
  });

  it("rejects extra fields rather than leaking arbitrary workspace data", () => {
    expect(() =>
      encodeDemoPassport({ ...identity, secret: "must-not-share" } as never),
    ).toThrow();
  });

  it("rejects corrupt, oversized, unversioned and noncanonical links", () => {
    for (const value of [
      "",
      "not%base64",
      "A".repeat(MAX_DEMO_PASSPORT_TOKEN_LENGTH + 1),
      btoa(JSON.stringify(identity)),
      btoa(JSON.stringify([2, ...Object.values(identity)])),
      encodeDemoPassport(identity) + "=",
      btoa("[]"),
      btoa(String.fromCharCode(0xff)),
    ])
      expect(decodeDemoPassport(value)).toBeNull();
  });

  it("fails explicitly when Unicode input cannot fit a usable QR code", () => {
    expect(() =>
      encodeDemoPassport({
        ...identity,
        assetId: "製".repeat(180),
        name: "製".repeat(180),
        manufacturer: "製".repeat(180),
      }),
    ).toThrow(/too long/);
  });

  it("round-trips the largest accepted ASCII identity and refuses the next larger payload", () => {
    const large = {
      ...identity,
      assetId: "urn:demo:" + "a".repeat(170),
      name: "N".repeat(180),
      manufacturer: "M".repeat(180),
      model: "M",
    };
    let lastAccepted = 0;
    for (let length = 1; length <= 100; length++) {
      const candidate = { ...large, model: "M".repeat(length) };
      let token: string;
      try {
        token = encodeDemoPassport(candidate);
      } catch {
        break;
      }
      expect(token.length).toBeLessThanOrEqual(MAX_DEMO_PASSPORT_TOKEN_LENGTH);
      expect(decodeDemoPassport(token)).toEqual(candidate);
      lastAccepted = length;
    }
    expect(lastAccepted).toBeGreaterThan(0);
    expect(lastAccepted).toBeLessThan(100);
    expect(() =>
      encodeDemoPassport({ ...large, model: "M".repeat(lastAccepted + 1) }),
    ).toThrow(/too long/);
  });
});
