import { describe, expect, it } from "vitest";
import {
  buildDemoAasDocuments,
  demoAasEnvironment,
  demoAasIdentity,
  getDemoAasProfile,
  DEMO_AAS_NOTICE,
  DEMO_AAS_RECORDED_AT,
  type DemoAasElement,
} from "../shared/demo-aas";

const identity = {
  assetId: "urn:smart-factory:test:pump-01",
  name: "Transfer pump — Prüfanlage",
  assetType: "pump",
  manufacturer: "Supplied manufacturer",
  model: "Supplied model",
  serialNumber: "KEPT-001",
  zone: "Utilities",
};
const children = (node: DemoAasElement): DemoAasElement[] =>
  node.statements ??
  (Array.isArray(node.value) && node.value[0] && "modelType" in node.value[0]
    ? (node.value as DemoAasElement[])
    : []);
function allElements(elements: DemoAasElement[]): DemoAasElement[] {
  return elements.flatMap((node) => [node, ...allElements(children(node))]);
}

describe("Complete authored demonstration AAS", () => {
  it("preserves supplied identity across shell, passport and nameplate and stays deterministic", () => {
    const built = buildDemoAasDocuments(identity);
    expect(buildDemoAasDocuments(identity)).toEqual(built);
    expect(built.shell.assetInformation.globalAssetId).toBe(identity.assetId);
    expect(
      built.shell.submodels.map((reference) => reference.keys[0].value),
    ).toEqual(built.submodels.map((s) => s.id));
    expect(
      built.shell.assetInformation.specificAssetIds.find(
        (id) => id.name === "serialNumber",
      )?.value,
    ).toBe("KEPT-001");
    const passport = built.submodels.find(
      (s) => s.idShort === "DigitalProductPassport",
    )!;
    for (const [field, expected] of [
      ["Manufacturer", identity.manufacturer],
      ["Model", identity.model],
      ["SerialNumber", identity.serialNumber],
    ]) {
      expect(
        passport.submodelElements.find((element) => element.idShort === field)
          ?.value,
      ).toBe(expected);
    }
    expect(built.shell.description[0].text).toBe(DEMO_AAS_NOTICE);
  });

  it("normalizes only exact legacy placeholders without losing known identities", () => {
    const old = demoAasIdentity({
      ...identity,
      manufacturer: "Example manufacturer",
      model: "Demonstration model",
      serialNumber: "DEMO",
    });
    expect(old.manufacturer).toBe("Synthetic example manufacturer");
    expect(old.model).toMatch(/authored example/);
    expect(old.serialNumber).toMatch(/^SIM-/);
    expect(demoAasIdentity(identity)).toMatchObject(identity);
    expect(
      demoAasIdentity({ ...identity, manufacturer: "example manufacturer" })
        .manufacturer,
    ).toBe("example manufacturer");
  });

  it.each([
    "pump",
    "pump-motor",
    "motor",
    "compressor",
    "transformer",
    "wind_turbine",
    "conveyor",
    "storage-tank",
    "storage_tank",
    "valve",
    "robot-arm",
    "robotic_arm",
    "control-cabinet",
    "control_cabinet",
    "raspberry-pi-4b",
    "edge_device",
    "gateway",
    "other",
  ])(
    "populates %s with usable content, definitions and complete materials",
    (assetType) => {
      const built = buildDemoAasDocuments({ ...identity, assetType });
      expect(built.submodels).toHaveLength(11);
      expect(built.submodels.every((s) => s.submodelElements.length >= 3)).toBe(
        true,
      );
      const elements = built.submodels.flatMap((s) =>
        allElements(s.submodelElements),
      );
      expect(elements.length).toBeGreaterThan(160);
      const concepts = new Map(built.conceptDescriptions.map((c) => [c.id, c]));
      for (const element of elements) {
        expect(concepts.has(element.semanticId.keys[0].value)).toBe(true);
        if (element.modelType === "Property")
          expect(typeof element.value).toBe("string");
        expect(element).not.toHaveProperty("unit");
        const siblings = children(element);
        expect(new Set(siblings.map((s) => s.idShort)).size).toBe(
          siblings.length,
        );
      }
      const profile = getDemoAasProfile(assetType);
      expect(
        profile.materials.reduce((total, m) => total + m.massFraction, 0),
      ).toBeCloseTo(1, 12);
      const materials = built.submodels.find(
        (s) => s.idShort === "MaterialComposition",
      )!;
      const entries = children(
        materials.submodelElements.find((e) => e.idShort === "Materials")!,
      );
      const totalMass = entries.reduce(
        (sum, entry) =>
          sum +
          Number(
            children(entry).find((e) => e.idShort === "MaterialMass")!.value,
          ),
        0,
      );
      expect(totalMass).toBeCloseTo(profile.massKg, 6);
      expect(JSON.stringify(built)).not.toMatch(/"value":\[\]/);
    },
  );

  it("embeds three readable UTF-8 handover documents instead of broken external file links", () => {
    const built = buildDemoAasDocuments(identity);
    const docs = built.submodels.find(
      (s) => s.idShort === "HandoverDocumentation",
    )!;
    const blobs = allElements(docs.submodelElements).filter(
      (e) => e.modelType === "Blob",
    );
    expect(blobs).toHaveLength(3);
    for (const blob of blobs) {
      const text = Buffer.from(blob.value as string, "base64").toString("utf8");
      expect(text).toContain(identity.name);
      expect(text).toContain(DEMO_AAS_NOTICE);
      expect(text.length).toBeGreaterThan(300);
      expect(blob.contentType).toBe("text/plain; charset=utf-8");
    }
    expect(
      allElements(docs.submodelElements).some((e) => e.modelType === "File"),
    ).toBe(false);
  });

  it("resolves every internal model reference, including component and document targets", () => {
    const env = demoAasEnvironment(identity);
    const byId = new Map<string, any>(
      [
        ...env.assetAdministrationShells,
        ...env.submodels,
        ...env.conceptDescriptions,
      ].map((root) => [String(root.id), root]),
    );
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      const record = value as any;
      if (record.type === "ModelReference") {
        let target = byId.get(record.keys[0].value);
        expect(target?.modelType).toBe(record.keys[0].type);
        for (const key of record.keys.slice(1)) {
          target = (target.submodelElements ?? children(target)).find(
            (child: DemoAasElement) => child.idShort === key.value,
          );
          expect(target?.modelType).toBe(key.type);
        }
      }
      Object.values(record).forEach(walk);
    };
    walk(env);
  });

  it("provides real unit definitions and explicit recorded/synthetic provenance", () => {
    const built = buildDemoAasDocuments(identity);
    const concepts = built.conceptDescriptions as any[];
    expect(
      concepts.some(
        (c) =>
          c.embeddedDataSpecifications?.[0].dataSpecificationContent.unit ===
          "kg",
      ),
    ).toBe(true);
    const operations = built.submodels.find(
      (s) => s.idShort === "OperationalData",
    )!;
    expect(
      operations.submodelElements.find((e) => e.idShort === "RecordedAt")
        ?.value,
    ).toBe(DEMO_AAS_RECORDED_AT);
    expect(
      operations.submodelElements.find(
        (e) => e.idShort === "PhysicalControlEnabled",
      )?.value,
    ).toBe("false");
    expect(JSON.stringify(built)).toContain("not been assessed");
    expect(JSON.stringify(built)).toContain(
      "no IDTA template certification claimed",
    );
  });

  it("isolates returned profile objects and supports known type aliases", () => {
    const profile = getDemoAasProfile("pump-motor");
    profile.specifications[0].value = "999";
    profile.materials[0].massFraction = 0;
    expect(getDemoAasProfile("pump").specifications[0].value).toBe("18");
    expect(getDemoAasProfile("pump").materials[0].massFraction).toBe(0.75);
    expect(getDemoAasProfile("robot-arm")).toEqual(
      getDemoAasProfile("robotic_arm"),
    );
    expect(getDemoAasProfile("storage-tank")).toEqual(
      getDemoAasProfile("storage_tank"),
    );
    expect(getDemoAasProfile("raspberry-pi-4b")).toEqual(
      getDemoAasProfile("gateway"),
    );
    expect(getDemoAasProfile("unknown-new-type").key).toBe("generic");
    expect(getDemoAasProfile("constructor").key).toBe("generic");
    expect(getDemoAasProfile("__proto__").key).toBe("generic");
  });

  it("keeps the assembly illustration separate from the installed engineering BOM", () => {
    const built = buildDemoAasDocuments(identity);
    const bom = built.submodels.find((s) => s.idShort === "BillOfMaterials")!;
    expect(
      bom.submodelElements.find((e) => e.idShort === "BillOfMaterialsScope")
        ?.value,
    ).toMatch(/not a complete engineering or manufacturer BOM/);
    const assemblies = bom.submodelElements.filter(
      (e) => e.modelType === "Entity",
    );
    expect(
      Number(
        bom.submodelElements.find(
          (e) => e.idShort === "IllustrativeAssemblyCount",
        )?.value,
      ),
    ).toBe(assemblies.length);
    expect(
      bom.submodelElements.filter((e) => e.modelType === "RelationshipElement"),
    ).toHaveLength(assemblies.length);
    const nameplate = built.submodels.find((s) => s.idShort === "Nameplate")!;
    expect(
      nameplate.submodelElements.find(
        (e) => e.idShort === "OrderCodeOfManufacturer",
      )?.value,
    ).toBe(demoAasIdentity(identity).orderCodeOfManufacturer);
  });

  it("rejects missing stable identifiers and invalid revisions", () => {
    expect(() => buildDemoAasDocuments({ ...identity, assetId: " " })).toThrow(
      /stable asset/,
    );
    expect(() => buildDemoAasDocuments({ ...identity, aasVersion: 0 })).toThrow(
      /positive integer/,
    );
    expect(
      buildDemoAasDocuments({ ...identity, aasVersion: 7 }).shell.administration
        .version,
    ).toBe("7");
  });
});
