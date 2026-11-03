import { frontendFetch } from "./frontend-fetch";

const configured =
  process.env.RELEASE_ORIGIN ?? "https://smart-factory-iot-app.vercel.app";
const origin = new URL(configured);
if (
  origin.protocol !== "https:" ||
  (configured !== origin.origin && configured !== `${origin.origin}/`)
)
  throw new Error("RELEASE_ORIGIN must be a plain HTTPS origin");

for (const path of ["/health/ready", "/"]) {
  const response = await frontendFetch(new URL(path, origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  if (response.status !== 200)
    throw new Error(
      `Frontend ${path} returned HTTP ${response.status}; expected 200`,
    );
}
console.log("Frontend readiness and root returned HTTP 200");
