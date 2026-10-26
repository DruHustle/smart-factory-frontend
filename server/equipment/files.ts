import express from "express";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sdk } from "../_core/sdk";
import { workspace, template, modelBytes } from "./local";
import { importModel } from "./packages";
import { demonstrationOnly } from "../../shared/access-policy";
const root = new URL("../../fixtures/equipment/", import.meta.url);
let uploads = 0;
export function installEquipmentFiles(app: express.Express) {
  app.post("/api/equipment/model-import", async (req, res) => {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (
      !["engineer", "admin"].includes(user.role) || demonstrationOnly(user)
    )
      return res
        .status(403)
        .json({ error: "Individual engineering access required" });
    const envelope =
      req.get("content-type") ===
      "application/vnd.smart-factory.model+octet-stream";
    if (!envelope && req.get("content-type") !== "model/gltf-binary")
      return res
        .status(415)
        .json({
          error:
            "Use the Smart Factory model envelope or a binary GLB with bounded mapping header",
        });
    let manifest: unknown;
    if (!envelope) {
      const encoded = req.get("x-equipment-manifest");
      if (!encoded || encoded.length > 16000)
        return res
          .status(400)
          .json({ error: "Provide a bounded base64 JSON mapping manifest" });
      try {
        manifest = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid mapping manifest" });
      }
    }
    if (uploads >= 2)
      return res
        .status(429)
        .setHeader("Retry-After", "2")
        .json({ error: "Model import capacity busy" });
    uploads++;
    express.raw({ type: () => true, limit: envelope ? "21mb" : "20mb" })(
      req,
      res,
      async (error) => {
        try {
          if (error || !Buffer.isBuffer(req.body))
            return res.status(413).json({
              error: "GLB exceeds the 20 MiB limit or could not be read",
            });
          let glb: Buffer = req.body;
          if (envelope) {
            if (glb.length < 4) throw new Error("Invalid envelope");
            const length = glb.readUInt32LE(0);
            if (length < 2 || length > 128 * 1024 || length + 4 >= glb.length)
              throw new Error("Manifest budget exceeded");
            manifest = JSON.parse(glb.toString("utf8", 4, 4 + length));
            glb = glb.subarray(4 + length);
          }
          return res
            .status(201)
            .json(await importModel(glb, manifest, user.id));
        } catch {
          return res.status(422).json({
            error:
              "Model/manifest validation or storage budget failed. Check IDs, paths, units, resource URLs and supported static GLB format.",
          });
        } finally {
          uploads--;
        }
      },
    );
  });
  app.get("/api/equipment/:id/:resource", async (req, res) => {
    try {
      await sdk.authenticateRequest(req);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!["model", "document"].includes(req.params.resource))
      return res.status(404).end();
    try {
      const w = await workspace(req.params.id),
        t = await template(w.templateRevision);
      if (
        w.templateRevision !== t.revision ||
        (req.query.revision && req.query.revision !== t.revision)
      )
        throw new Error("Model revision missing");
      const model = req.params.resource === "model";
      const bytes = model
        ? await modelBytes(t.revision)
        : t.maintenanceText === null
          ? null
          : t.maintenanceText !== undefined
            ? Buffer.from(t.maintenanceText)
            : await readFile(new URL("maintenance.txt", root));
      if (!bytes)
        return res
          .status(404)
          .json({ error: "No document associated with this model package" });
      if (
        model &&
        createHash("sha256").update(bytes).digest("hex") !== t.sha256
      )
        throw new Error("Model revision mismatch");
      return res
        .setHeader("Cache-Control", "private, no-store")
        .setHeader("X-Content-Type-Options", "nosniff")
        .setHeader(
          "Content-Type",
          model ? "model/gltf-binary" : "text/plain; charset=utf-8",
        )
        .send(bytes);
    } catch {
      return res.status(404).json({
        error: "Equipment/model/document unavailable or revision invalid",
      });
    }
  });
}
