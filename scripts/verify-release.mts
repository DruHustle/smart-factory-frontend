import { releaseIdentityCompatibility } from "../shared/runtime-contract";

const origin = new URL(process.env.RELEASE_ORIGIN ?? "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("RELEASE_ORIGIN must be a plain HTTPS origin");
const expected = process.env.RELEASE_SHA ?? "";
if (!/^[a-f0-9]{40}$/.test(expected))
  throw Error("RELEASE_SHA must be a full immutable source revision");
const response = await fetch(
  new URL(`/release.json?revision=${expected}`, origin),
  {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  },
);
if (!response.ok)
  throw Error("The deployed frontend release manifest is unavailable");
const error = releaseIdentityCompatibility(await response.json(), expected);
if (error) throw Error(error);
console.log(`Verified frontend ${expected} at ${origin.origin}`);
