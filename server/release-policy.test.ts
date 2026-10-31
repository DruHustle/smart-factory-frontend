import { describe, expect, it } from "vitest";
import {
  promotionCompatibility,
  releaseIdentityCompatibility,
  requiredCapabilities,
  runtimeContractVersion,
  type RuntimeContract,
} from "../shared/runtime-contract";

const source = "a".repeat(40);
const expected = {
  backend: "b".repeat(40),
  edge: "c".repeat(40),
  schemaDigest: "d".repeat(64),
};
const runtime = (): RuntimeContract => ({
  source,
  backendSource: expected.backend,
  edgeSource: expected.edge,
  contractVersion: runtimeContractVersion,
  versioned: true,
  deployment: "bundle",
  capabilities: [...requiredCapabilities],
  schema: {
    ready: true,
    revision: "0030_infrastructure_monitor",
    digest: expected.schemaDigest,
  },
  worker: { fresh: true, compatible: true },
});
describe("coordinated production promotion", () => {
  it("accepts the qualified API with a compatible current worker", () => {
    expect(promotionCompatibility(runtime(), expected)).toBeNull();
  });
  it("blocks the account-request UI until its API is deployed", () => {
    expect(
      promotionCompatibility(
        {
          ...runtime(),
          capabilities: runtime().capabilities.filter(
            (capability) => capability !== "account-requests-v1",
          ),
        },
        expected,
      ),
    ).toBeTruthy();
  });
  it.each([
    { backendSource: "e".repeat(40) },
    { edgeSource: "e".repeat(40) },
    { source: null },
    { source: "main" },
    { deployment: "standalone" },
    { worker: null },
    { worker: { fresh: false, compatible: true } },
    { worker: { fresh: true, compatible: false } },
    { schema: { ready: true, revision: "0030", digest: "e".repeat(64) } },
    { capabilities: requiredCapabilities.slice(1) },
  ])(
    "rejects a ready service with incompatible release evidence: %j",
    (change) => {
      expect(
        promotionCompatibility({ ...runtime(), ...change }, expected),
      ).toBeTruthy();
    },
  );
});

const release = () => ({
  application: "Smart Factory",
  source,
  builtAt: "2026-10-28T10:00:00Z",
  contractVersion: runtimeContractVersion,
  requiredCapabilities: [...requiredCapabilities],
});
describe("deployed frontend identity", () => {
  it("accepts the exact built revision and required capabilities", () => {
    expect(releaseIdentityCompatibility(release(), source)).toBeNull();
  });
  it.each([
    null,
    {},
    { status: "ready" },
    { ...release(), source: "e".repeat(40) },
    { ...release(), application: "Other application" },
    { ...release(), requiredCapabilities: requiredCapabilities.slice(1) },
    { ...release(), builtAt: "invalid" },
    { ...release(), contractVersion: 1 },
  ])(
    "rejects a healthy or cached origin without the approved artifact: %j",
    (value) => {
      expect(releaseIdentityCompatibility(value, source)).toBeTruthy();
    },
  );
  it("refuses an unspecified expected source", () => {
    expect(releaseIdentityCompatibility(release(), "")).toBeTruthy();
  });
});
