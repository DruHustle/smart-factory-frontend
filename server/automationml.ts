import { createHash } from "node:crypto";

export type AutomationMlAsset = {
  assetId: string;
  name: string;
  assetType: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  zone?: string | null;
  location?: string | null;
  lifecycleStage: string;
  aasVersion: number;
};

const CAEX_NAMESPACE = "http://www.dke.de/CAEX";
const XML_SCHEMA_NAMESPACE = "http://www.w3.org/2001/XMLSchema";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function elementId(kind: string, identity: string): string {
  return `ie_${createHash("sha256").update(`${kind}\0${identity}`).digest("hex").slice(0, 24)}`;
}

function amlAttribute(name: string, value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  return `<Attribute Name="${escapeXml(name)}" AttributeDataType="xs:string"><Value>${escapeXml(String(value))}</Value></Attribute>`;
}

/** Export dashboard assets grouped by their recorded zone and location as CAEX 3.0. */
export function buildAutomationMlPlantLayout(assets: readonly AutomationMlAsset[]): string {
  const zones = new Map<string, Map<string, AutomationMlAsset[]>>();
  for (const asset of assets) {
    const zone = asset.zone?.trim() || "Unassigned zone";
    const location = asset.location?.trim() || "Unassigned location";
    const locations = zones.get(zone) ?? new Map<string, AutomationMlAsset[]>();
    const locatedAssets = locations.get(location) ?? [];
    locatedAssets.push(asset);
    locations.set(location, locatedAssets);
    zones.set(zone, locations);
  }

  const groups = [...zones.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([zone, locations]) => {
    const locationElements = [...locations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([location, items]) => {
      const machineElements = [...items].sort((left, right) => left.assetId.localeCompare(right.assetId)).map((asset) => {
        const attributes = [
          amlAttribute("AASAssetId", asset.assetId),
          amlAttribute("AssetType", asset.assetType),
          amlAttribute("AASVersion", asset.aasVersion),
          amlAttribute("LifecycleStage", asset.lifecycleStage),
          amlAttribute("Manufacturer", asset.manufacturer),
          amlAttribute("Model", asset.model),
          amlAttribute("SerialNumber", asset.serialNumber),
        ].join("");
        return `<InternalElement ID="${elementId("asset", asset.assetId)}" Name="${escapeXml(asset.name)}">${attributes}</InternalElement>`;
      }).join("");
      const locationId = elementId("location", `${zone}\0${location}`);
      return `<InternalElement ID="${locationId}" Name="${escapeXml(location)}">${machineElements}</InternalElement>`;
    }).join("");
    const zoneId = elementId("zone", zone);
    return `<InternalElement ID="${zoneId}" Name="${escapeXml(zone)}">${locationElements}</InternalElement>`;
  }).join("");

  const writtenAt = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<CAEXFile xmlns="${CAEX_NAMESPACE}" xmlns:xs="${XML_SCHEMA_NAMESPACE}" SchemaVersion="3.0" FileName="smart-factory.aml"><SourceDocumentInformation OriginName="Smart Factory" OriginID="smart-factory-iot" OriginVersion="1.0" LastWritingDateTime="${writtenAt}" OriginVendor="Smart Factory"/><InstanceHierarchy Name="Smart Factory">${groups}</InstanceHierarchy></CAEXFile>`;
}
