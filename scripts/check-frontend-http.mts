import { frontendFetch } from "./frontend-fetch";

for (const path of ["/health/ready", "/"]) {
  const response = await frontendFetch(
    new URL(path, "https://smart-factory-iot-app.vercel.app"),
    { cache: "no-store", signal: AbortSignal.timeout(10000) },
  );
  await response.body?.cancel();
  if (response.status !== 200)
    throw new Error(
      `Frontend ${path} returned HTTP ${response.status}; expected 200`,
    );
}
console.log("Frontend readiness and root returned HTTP 200");
