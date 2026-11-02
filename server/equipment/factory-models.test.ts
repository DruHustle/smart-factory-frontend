import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { type Server } from "node:http";
import express from "express";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { factoryModels, referenceModels } from "../../shared/factory-models";
import { modelBytes, template, bundledModelCatalog } from "./local";
import { validateModelPackage } from "./packages";
import { sectionCap } from "../../client/src/components/equipment/section";
import { installEquipmentFiles } from "./files";
import { sdk } from "../_core/sdk";
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));

const identities = new Set<string>();
for (const descriptor of factoryModels)
  test(`${descriptor.name} retains separate mapped, closed, bounded components without invented observations`, async () => {
    const revision = `smart-factory-illustrative-${descriptor.slug}-1`;
    const model = await template(revision),
      bytes = await modelBytes(revision);
    expect(model.components.length).toBeGreaterThanOrEqual(15);
    expect(bytes.length).toBeLessThan(600000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(model.sha256);
    expect(model.bindings).toEqual([]);
    expect(model.maintenanceText).toBeNull();
    expect(model.assetType).toBe(descriptor.assetType);
    validateModelPackage(bytes, {
      schemaVersion: "smart-factory-model-1",
      name: model.name,
      provenance: "Original illustrative parametric geometry",
      license: "MIT",
      units: "m",
      handedness: "right",
      upAxis: "+Y",
      components: model.components,
      bindings: model.bindings,
      maintenanceText: null,
    });
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
      "",
    );
    gltf.scene.updateMatrixWorld(true);
    for (const component of model.components) {
      expect(
        identities.has(component.templateComponentId),
        component.name,
      ).toBe(false);
      identities.add(component.templateComponentId);
      let node: THREE.Object3D | undefined = gltf.scene;
      for (const name of component.nodePath.split("/").filter(Boolean))
        node = node?.children.find((child) => child.name === name);
      expect(node, component.name).toBeTruthy();
      expect(gltf.parser.associations.get(node!)?.nodes).toBe(
        component.nodeIndex,
      );
      if (component.solid) {
        const mesh = node as THREE.Mesh;
        const centre = new THREE.Box3()
          .setFromObject(mesh)
          .getCenter(new THREE.Vector3());
        const cap = sectionCap(
          mesh.geometry,
          mesh.matrixWorld,
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -centre.x),
        );
        expect(cap.open, component.name).toBe(false);
        cap.geometry?.dispose();
        mesh.geometry.dispose();
      }
    }
  });

test("all native and authored references are available through the creation catalogue", async () => {
  const catalogue = await bundledModelCatalog();
  expect(catalogue.map((model) => model.revision).sort()).toEqual(
    referenceModels.map((model) => model.revision).sort(),
  );
  await expect(
    template("smart-factory-illustrative-unknown-1"),
  ).rejects.toThrow("Unsupported model revision");
});

let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  installEquipmentFiles(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("No fixture listener");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("reference delivery requires authentication and cannot resolve private imports or unknown revisions", async () => {
  const auth = vi.mocked(sdk.authenticateRequest);
  auth.mockRejectedValueOnce(Error("No session"));
  expect(
    (await fetch(base + "/api/equipment/reference/conveyor/model")).status,
  ).toBe(401);
  auth.mockResolvedValue({
    id: 5,
    role: "viewer",
    passwordChangeRequired: false,
  } as never);
  const response = await fetch(
    base + "/api/equipment/reference/conveyor/model",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(
    bytes.equals(await modelBytes("smart-factory-illustrative-conveyor-1")),
  ).toBe(true);
  expect(
    (
      await fetch(
        base + "/api/equipment/reference/local-import%3Aprivate/model",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await fetch(
        base + "/api/equipment/reference/conveyor/model?revision=wrong",
      )
    ).status,
  ).toBe(404);
  auth.mockResolvedValueOnce({
    id: 5,
    role: "viewer",
    passwordChangeRequired: true,
  } as never);
  expect(
    (await fetch(base + "/api/equipment/reference/conveyor/model")).status,
  ).toBe(403);
});
