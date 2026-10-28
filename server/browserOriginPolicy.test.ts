import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { installBrowserOriginPolicy } from "./_core/browserOriginPolicy";
vi.mock("./security/runtime", () => ({ nativeEvent: vi.fn() }));
let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

it("applies credentialed CORS and the origin boundary to exports and early API routes", async () => {
  const app = express();
  installBrowserOriginPolicy(app, new Set(["https://factory.example"]));
  const write = vi.fn((_req, res) => res.json({ saved: true }));
  app.get("/api/assets/export/automationml", (_req, res) =>
    res.send("<CAEXFile />"),
  );
  app.post("/api/evidence", write);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test listener");
  const base = `http://127.0.0.1:${address.port}`;
  const exported = await fetch(`${base}/api/assets/export/automationml`, {
    headers: { Origin: "https://factory.example" },
  });
  expect(exported.headers.get("access-control-allow-origin")).toBe(
    "https://factory.example",
  );
  expect(exported.headers.get("access-control-allow-credentials")).toBe("true");
  const preflight = await fetch(`${base}/api/evidence`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://factory.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  expect(preflight.status).toBe(204);
  const denied = await fetch(`${base}/api/evidence`, {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
  });
  expect(denied.status).toBe(403);
  expect(write).not.toHaveBeenCalled();
  expect(
    (
      await fetch(`${base}/api/evidence`, {
        method: "POST",
        headers: { Origin: "https://factory.example" },
      })
    ).status,
  ).toBe(200);
  // Existing non-browser service callers retain their independent authentication.
  expect((await fetch(`${base}/api/evidence`, { method: "POST" })).status).toBe(
    200,
  );
  expect(write).toHaveBeenCalledTimes(2);
});
