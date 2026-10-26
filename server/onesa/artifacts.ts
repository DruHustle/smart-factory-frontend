import { artifactStatus } from "./model";
import type express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sdk } from "../_core/sdk";
import { isDemoAccount } from "../../shared/demo-accounts";
export const ARTIFACT_FILES = [
  "equipment.json",
  "mappings.json",
  "model-manifest.json",
  "pump-motor.glb",
  "maintenance.txt",
  "demonstrator.aas.json",
  "demonstrator.aasx",
  "onesa-synthetic-evidence.json",
] as const;
export function installArtifactRoutes(app: express.Express) {
  app.get("/api/onesa/artifacts/:name", async (req, res) => {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (
      !["engineer", "admin"].includes(user.role) ||
      isDemoAccount(user.email ?? "") ||
      user.openId.startsWith("demo-")
    )
      return res
        .status(403)
        .json({ error: "Private engineering access required" });
    const name = req.params.name;
    if (!(ARTIFACT_FILES as readonly string[]).includes(name))
      return res.status(404).end();
    if (!(await artifactStatus()).startsWith("Available"))
      return res
        .status(503)
        .json({ error: "Missing or invalid artifact revision mapping" });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const root = fileURLToPath(
      new URL("../../fixtures/equipment/", import.meta.url),
    );
    return res.download(path.join(root, name), name);
  });
}
