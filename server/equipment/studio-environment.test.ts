import { test, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

test("the shipped reflection atlas retains finite, unclipped HDR radiance within its budget", () => {
  const compressed = readFileSync(
    "client/src/assets/equipment/studio-environment.bin.gz",
  );
  expect(compressed.length).toBeLessThan(420000);
  const bytes = gunzipSync(compressed);
  expect(bytes.toString("ascii", 0, 4)).toBe("SFE1");
  expect(bytes.readUInt32LE(4)).toBe(384);
  expect(bytes.readUInt32LE(8)).toBe(512);
  expect(bytes.length).toBe(12 + 384 * 512 * 8);
  let highDynamicRange = 0,
    nonzero = 0,
    invalid = 0;
  for (let offset = 12; offset < bytes.length; offset += 2) {
    const value = bytes.readUInt16LE(offset);
    if ((value & 0x7c00) === 0x7c00) invalid++;
    if (value > 0) nonzero++;
    if (value > 0x3c00 && value < 0x7c00) highDynamicRange++;
  }
  expect(highDynamicRange).toBeGreaterThan(1000);
  expect(nonzero).toBeGreaterThan(100000);
  expect(invalid).toBe(0);
});
