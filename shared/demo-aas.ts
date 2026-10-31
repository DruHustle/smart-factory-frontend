/**
 * Authored demonstration models. Never use this builder to complete live asset data.
 * The AAS 3.0 core structure is interoperable; these application submodels do not
 * claim IDTA template certification, manufacturer approval or EU DPP compliance.
 * No clock, network, Node APIs or random identifiers: browser and server agree.
 */
export const DEMO_AAS_PROFILE_VERSION = "1";
export const demoAasVersion = DEMO_AAS_PROFILE_VERSION;
export const DEMO_AAS_RECORDED_AT = "2026-10-20T10:00:00Z";
export const DEMO_AAS_NOTICE =
  "Authored demonstration data. Technical values, materials, maintenance and environmental figures are synthetic; they are not manufacturer specifications or verified compliance evidence.";

export interface DemoAasInput {
  assetId: string;
  name: string;
  assetType: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  zone?: string | null;
  aasVersion?: number;
}

export interface DemoAasSpecification {
  id: string;
  label: string;
  value: string;
  unit?: string;
  valueType: string;
}
export interface DemoAasProfile {
  key: string;
  label: string;
  description: string;
  massKg: number;
  expectedServiceYears: number;
  specifications: DemoAasSpecification[];
  materials: { name: string; massFraction: number }[];
  components: {
    id: string;
    name: string;
    quantity: number;
    material: string;
  }[];
  maintenanceTasks: string[];
}
export type DemoAasReference = {
  type: "ExternalReference" | "ModelReference";
  keys: { type: string; value: string }[];
};
export type DemoAasElement = {
  modelType: string;
  idShort: string;
  displayName?: { language: string; text: string }[];
  description?: { language: string; text: string }[];
  semanticId: DemoAasReference;
  valueType?: string;
  value?:
    | string
    | { language: string; text: string }[]
    | DemoAasElement[]
    | DemoAasReference;
  contentType?: string;
  entityType?: string;
  statements?: DemoAasElement[];
  first?: DemoAasReference;
  second?: DemoAasReference;
};

const spec = (
  id: string,
  label: string,
  value: number | string,
  unit?: string,
): DemoAasSpecification => ({
  id,
  label,
  value: String(value),
  ...(unit ? { unit } : {}),
  valueType: typeof value === "number" ? "xs:double" : "xs:string",
});
type ProfileSeed = [
  string,
  string,
  number,
  number,
  DemoAasSpecification[],
  string[],
  string[],
];
const seeds: Record<string, ProfileSeed> = {
  pump: [
    "Centrifugal pump and motor",
    "Transfer of simulated process water between storage and production.",
    145,
    15,
    [
      spec("RatedFlow", "Rated flow", 18, "m³/h"),
      spec("RatedHead", "Rated head", 32, "m"),
      spec("MotorPower", "Motor power", 5.5, "kW"),
      spec("MaximumPressure", "Maximum pressure", 10, "bar"),
      spec("MaximumFluidTemperature", "Maximum fluid temperature", 80, "°C"),
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
    ],
    ["Pump casing", "Impeller", "Drive motor", "Mechanical seal", "Base frame"],
    [
      "Inspect the mechanical seal for leakage and the base for loose fixings.",
      "Check alignment, bearing vibration and the suction strainer.",
      "Replace the seal kit after the simulated service interval; retain the old part record.",
    ],
  ],
  motor: [
    "Three phase induction motor",
    "Illustrative drive for a conveyor or process pump.",
    42,
    15,
    [
      spec("RatedPower", "Rated output power", 5.5, "kW"),
      spec("RatedSpeed", "Rated speed", 1470, "r/min"),
      spec("RatedTorque", "Rated torque", 35.7, "N·m"),
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
      spec("SupplyFrequency", "Supply frequency", 50, "Hz"),
      spec("IllustrativeEfficiency", "Illustrative efficiency", 90.4, "%"),
    ],
    [
      "Stator housing",
      "Rotor and shaft",
      "Bearing set",
      "Terminal box",
      "Cooling fan",
    ],
    [
      "Inspect the cooling air path and terminal enclosure.",
      "Trend recorded bearing vibration and winding temperature.",
      "Inspect and lubricate the bearing assembly using the simulated service procedure.",
    ],
  ],
  compressor: [
    "Air compressor",
    "Synthetic utility air supply for packaging actuators.",
    850,
    12,
    [
      spec("RatedPower", "Rated input power", 75, "kW"),
      spec("DeliveryPressure", "Delivery pressure", 8, "bar"),
      spec("FreeAirDelivery", "Free air delivery", 12, "m³/min"),
      spec("ReceiverVolume", "Receiver volume", 500, "L"),
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
      spec("NoiseLevel", "Illustrative sound level", 78, "dB(A)"),
    ],
    [
      "Compression element",
      "Drive motor",
      "Receiver",
      "Inlet filter",
      "Control panel",
    ],
    [
      "Inspect filters, hoses and condensate drains.",
      "Record operating hours and the simulated pressure differential.",
      "Inspect seals and replace the illustrative filter service kit.",
    ],
  ],
  transformer: [
    "Distribution transformer",
    "Illustrative electrical distribution asset; no real energisation is modelled.",
    4200,
    25,
    [
      spec("RatedApparentPower", "Rated apparent power", 1600, "kVA"),
      spec("PrimaryVoltage", "Primary voltage", 11000, "V"),
      spec("SecondaryVoltage", "Secondary voltage", 400, "V"),
      spec("Frequency", "Frequency", 50, "Hz"),
      spec("Impedance", "Illustrative impedance", 6, "%"),
      spec("CoolingType", "Cooling type", "Dry-type air cooled"),
    ],
    [
      "Magnetic core",
      "Primary winding",
      "Secondary winding",
      "Insulated enclosure",
      "Temperature monitor",
    ],
    [
      "Inspect the de-energised enclosure and ventilation path in the demonstration.",
      "Review the recorded temperature profile and inspection history.",
      "Record insulation inspection findings; never infer electrical safety from demo values.",
    ],
  ],
  wind_turbine: [
    "Wind turbine",
    "Illustrative renewable generation asset for the factory energy view.",
    280000,
    20,
    [
      spec("RatedOutput", "Rated electrical output", 2500, "kW"),
      spec("RotorDiameter", "Rotor diameter", 90, "m"),
      spec("HubHeight", "Hub height", 85, "m"),
      spec("CutInWindSpeed", "Cut-in wind speed", 3, "m/s"),
      spec("RatedWindSpeed", "Rated wind speed", 12, "m/s"),
      spec("OutputVoltage", "Output voltage", 690, "V"),
    ],
    ["Tower", "Rotor blade set", "Nacelle", "Generator", "Converter"],
    [
      "Inspect the demonstration tower, blade surfaces and fastener records.",
      "Review the recorded generator temperature and vibration trend.",
      "Plan qualified inspection and a controlled shutdown before any real maintenance.",
    ],
  ],
  conveyor: [
    "Belt conveyor",
    "Transport of simulated workpieces between factory stations.",
    320,
    12,
    [
      spec("BeltLength", "Belt length", 4.5, "m"),
      spec("BeltWidth", "Belt width", 0.6, "m"),
      spec("RatedSpeed", "Rated belt speed", 0.5, "m/s"),
      spec("MaximumLoad", "Distributed load", 150, "kg"),
      spec("DrivePower", "Drive power", 0.75, "kW"),
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
    ],
    ["Conveyor frame", "Drive drum", "Return rollers", "Belt", "Gearmotor"],
    [
      "Inspect belt tracking, tension and visible damage.",
      "Check rollers and drive guards in the illustrative maintenance record.",
      "Replace the belt or rollers as separate serviceable assemblies.",
    ],
  ],
  storage_tank: [
    "Process storage tank",
    "Illustrative buffer vessel for a non-hazardous liquid process.",
    420,
    20,
    [
      spec("NominalVolume", "Nominal volume", 5000, "L"),
      spec("WorkingVolume", "Working volume", 4500, "L"),
      spec("DesignPressure", "Illustrative design pressure", 1, "bar"),
      spec("MaximumTemperature", "Maximum temperature", 80, "°C"),
      spec("VesselDiameter", "Vessel diameter", 1.8, "m"),
      spec("OverallHeight", "Overall height", 2.5, "m"),
    ],
    [
      "Vessel shell",
      "Support legs",
      "Inspection cover",
      "Outlet assembly",
      "Level sensor",
    ],
    [
      "Inspect external surfaces, supports and connections.",
      "Record a simulated cleaning and seal inspection.",
      "Inspect the level sensor and retain calibration evidence separately from simulation.",
    ],
  ],
  valve: [
    "Process isolation valve",
    "Illustrative valve for controlling the simulated factory flow.",
    18,
    15,
    [
      spec("NominalDiameter", "Nominal diameter", 50, "mm"),
      spec("MaximumPressure", "Maximum pressure", 16, "bar"),
      spec("MaximumTemperature", "Maximum fluid temperature", 120, "°C"),
      spec("ActuationPressure", "Pneumatic supply pressure", 6, "bar"),
      spec("StrokeTime", "Illustrative actuation time", 2, "s"),
      spec("Connection", "Connection type", "Flanged"),
    ],
    ["Valve body", "Valve closure", "Stem", "Seal set", "Pneumatic actuator"],
    [
      "Inspect the body and connections for evidence of leakage.",
      "Review the recorded actuator travel and simulated stroke time.",
      "Replace seats and seals using the asset-specific service record.",
    ],
  ],
  robotic_arm: [
    "Industrial robot arm",
    "Illustrative pick and place station; the model does not command physical hardware.",
    165,
    12,
    [
      spec("Axes", "Controlled axes", 6, "count"),
      spec("Payload", "Illustrative payload", 10, "kg"),
      spec("Reach", "Maximum reach", 1.3, "m"),
      spec("Repeatability", "Illustrative repeatability", 0.05, "mm"),
      spec("RatedInputPower", "Rated input power", 3, "kW"),
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
    ],
    [
      "Robot base",
      "Shoulder joint",
      "Upper arm",
      "Wrist assembly",
      "End effector",
    ],
    [
      "Inspect recorded cable routing and joint condition.",
      "Review simulated cycle counts and the programmed service interval.",
      "Plan qualified servicing with verified isolation; simulation is not a safety function.",
    ],
  ],
  control_cabinet: [
    "Control cabinet",
    "Illustrative enclosure for factory control and network equipment.",
    95,
    15,
    [
      spec("SupplyVoltage", "Supply voltage", 400, "V"),
      spec("ControlVoltage", "Control voltage", 24, "V"),
      spec("RatedCurrent", "Illustrative rated current", 32, "A"),
      spec("Width", "Enclosure width", 0.6, "m"),
      spec("Height", "Enclosure height", 1.8, "m"),
      spec("Depth", "Enclosure depth", 0.4, "m"),
    ],
    [
      "Enclosure",
      "Mounting plate",
      "Power supply",
      "Controller",
      "Terminal rail",
    ],
    [
      "Inspect the enclosure and filter condition in the demonstration.",
      "Review the simulated thermal trend and component inventory.",
      "Record qualified electrical inspection separately; no safety certification is implied.",
    ],
  ],
  gateway: [
    "Edge gateway",
    "Illustrative data collection gateway; values are not a board vendor datasheet.",
    0.25,
    7,
    [
      spec("CpuCores", "Illustrative CPU cores", 4, "count"),
      spec("Memory", "Illustrative memory capacity", 4, "GB"),
      spec("Storage", "Illustrative local storage", 32, "GB"),
      spec("InputVoltage", "Input voltage", 5, "V"),
      spec("TypicalPower", "Illustrative power demand", 8, "W"),
      spec("EthernetRate", "Ethernet link rate", 1000, "Mbit/s"),
    ],
    [
      "Printed circuit board",
      "Processor and heat sink",
      "Storage module",
      "Network interface",
      "Enclosure",
    ],
    [
      "Inspect enclosure ventilation and power connections.",
      "Review recorded backup and software inventory entries.",
      "Replace removable storage using a tested backup; demo software is not an update payload.",
    ],
  ],
  generic: [
    "Factory equipment",
    "Illustrative equipment profile for assets without a specific demonstration family.",
    100,
    10,
    [
      spec("NominalWidth", "Illustrative width", 1, "m"),
      spec("NominalHeight", "Illustrative height", 1.5, "m"),
      spec("NominalDepth", "Illustrative depth", 0.8, "m"),
      spec("AmbientMinimum", "Minimum ambient temperature", 5, "°C"),
      spec("AmbientMaximum", "Maximum ambient temperature", 40, "°C"),
      spec("Duty", "Illustrative duty", "Intermittent demonstration"),
    ],
    [
      "Main structure",
      "Serviceable assembly",
      "Monitoring sensor",
      "Connection panel",
    ],
    [
      "Inspect the asset condition and identification record.",
      "Review the simulated operating and maintenance history.",
      "Replace serviceable assemblies according to a verified real asset procedure when available.",
    ],
  ],
};

function profileKey(assetType: string): string {
  const key = assetType.toLowerCase().replaceAll("-", "_");
  if (["pump", "pump_motor"].includes(key)) return "pump";
  if (["robot_arm", "robotic_arm"].includes(key)) return "robotic_arm";
  if (["raspberry_pi_4b", "edge_device", "gateway", "controller"].includes(key))
    return "gateway";
  return Object.hasOwn(seeds, key) ? key : "generic";
}

/** New objects on every call prevent one browser edit from changing shared fixtures. */
export function getDemoAasProfile(assetType: string): DemoAasProfile {
  const key = profileKey(assetType);
  const [
    label,
    description,
    massKg,
    expectedServiceYears,
    specifications,
    components,
    maintenanceTasks,
  ] = seeds[key];
  const materials =
    key === "gateway"
      ? [
          { name: "Aluminium", massFraction: 0.35 },
          { name: "Copper", massFraction: 0.15 },
          { name: "Electronic assembly", massFraction: 0.3 },
          { name: "Polymer", massFraction: 0.2 },
        ]
      : key === "wind_turbine"
        ? [
            { name: "Steel", massFraction: 0.7 },
            { name: "Fibre composite", massFraction: 0.15 },
            { name: "Copper", massFraction: 0.1 },
            { name: "Polymer", massFraction: 0.05 },
          ]
        : [
            {
              name:
                key === "storage_tank" || key === "valve"
                  ? "Stainless steel"
                  : "Steel",
              massFraction: 0.75,
            },
            { name: "Aluminium", massFraction: 0.12 },
            { name: "Copper", massFraction: 0.08 },
            { name: "Polymer", massFraction: 0.05 },
          ];
  const componentMaterials: Record<string, string[]> = {
    pump: ["Steel", "Steel", "Copper", "Polymer", "Steel"],
    motor: ["Steel", "Steel", "Steel", "Polymer", "Aluminium"],
    compressor: ["Steel", "Copper", "Steel", "Polymer", "Aluminium"],
    transformer: ["Steel", "Copper", "Copper", "Aluminium", "Polymer"],
    wind_turbine: ["Steel", "Fibre composite", "Steel", "Copper", "Polymer"],
    conveyor: ["Steel", "Steel", "Aluminium", "Polymer", "Copper"],
    storage_tank: [
      "Stainless steel",
      "Stainless steel",
      "Stainless steel",
      "Stainless steel",
      "Polymer",
    ],
    valve: [
      "Stainless steel",
      "Stainless steel",
      "Stainless steel",
      "Polymer",
      "Aluminium",
    ],
    robotic_arm: ["Steel", "Steel", "Aluminium", "Aluminium", "Polymer"],
    control_cabinet: ["Steel", "Steel", "Copper", "Polymer", "Aluminium"],
    gateway: [
      "Electronic assembly",
      "Aluminium",
      "Electronic assembly",
      "Copper",
      "Polymer",
    ],
    generic: ["Steel", "Aluminium", "Copper", "Polymer"],
  };
  return {
    key,
    label,
    description,
    massKg,
    expectedServiceYears,
    specifications: [
      ...specifications.map((s) => ({ ...s })),
      spec("Mass", "Assembly mass", massKg, "kg"),
      spec(
        "ExpectedServiceLife",
        "Assumed service life",
        expectedServiceYears,
        "a",
      ),
    ],
    materials,
    components: components.map((name, i) => ({
      id: `Component${i + 1}`,
      name,
      quantity: 1,
      material: componentMaterials[key][i],
    })),
    maintenanceTasks: [...maintenanceTasks],
  };
}

const semanticRoot = "urn:smart-factory:demo:concept:1:";
const external = (value: string): DemoAasReference => ({
  type: "ExternalReference",
  keys: [{ type: "GlobalReference", value }],
});
const translated = (en: string, de = en) => [
  { language: "en", text: en },
  { language: "de", text: de },
];
const idShort = (value: string) => {
  const clean = value.replace(/[^a-zA-Z0-9_]/g, "");
  return (
    (/^[a-zA-Z]/.test(clean) ? clean : `Asset_${clean}`).slice(0, 120) ||
    "DemonstrationAsset"
  );
};
const textOr = (value: string | null | undefined, fallback: string) =>
  value?.trim() || fallback;
const legacyOr = (
  value: string | null | undefined,
  placeholder: string,
  fallback: string,
) => (value?.trim() === placeholder ? fallback : textOr(value, fallback));
const fixed = (value: number) => Number(value.toFixed(6));

/** Canonical authored identity; only exact old demo placeholders are replaced. */
export function demoAasIdentity(input: DemoAasInput) {
  const profile = getDemoAasProfile(input.assetType);
  const rated = profile.specifications.find((s) =>
    /^(RatedPower|MotorPower|RatedApparentPower|RatedOutput|DrivePower|NominalVolume|NominalDiameter|Payload|RatedCurrent|TypicalPower)$/.test(
      s.id,
    ),
  );
  return {
    assetId: input.assetId,
    name: input.name,
    assetType: input.assetType,
    manufacturer: legacyOr(
      input.manufacturer,
      "Example manufacturer",
      "Synthetic example manufacturer",
    ),
    model: legacyOr(
      input.model,
      "Demonstration model",
      `${profile.label} — authored example`,
    ),
    serialNumber: legacyOr(
      input.serialNumber,
      "DEMO",
      `SIM-${idShort(input.assetId).slice(-40)}`,
    ),
    zone: textOr(input.zone, "Demonstration factory"),
    manufacturerStreet: "Example Street 1",
    manufacturerZipcode: "00000",
    manufacturerCityTown: "Example City",
    manufacturerNationalCode: "DE",
    manufacturerArticleNumber: `SIM-${profile.key.toUpperCase()}-01`,
    orderCodeOfManufacturer: `SIM-${profile.key.toUpperCase()}-01`,
    ratedValue: rated?.value ?? "",
    ratedUnit: rated?.unit ?? "",
    aasVersion: input.aasVersion ?? 1,
  };
}
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1],
      c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    result +=
      alphabet[(n >>> 18) & 63] +
      alphabet[(n >>> 12) & 63] +
      (b === undefined ? "=" : alphabet[(n >>> 6) & 63]) +
      (c === undefined ? "=" : alphabet[n & 63]);
  }
  return result;
}

export function buildDemoAasDocuments(input: DemoAasInput) {
  if (!input.assetId.trim() || !input.name.trim())
    throw new Error(
      "A demonstration AAS needs a stable asset identifier and name",
    );
  if (
    input.aasVersion !== undefined &&
    (!Number.isSafeInteger(input.aasVersion) || input.aasVersion < 1)
  )
    throw new Error("AAS revision must be a positive integer");
  const profile = getDemoAasProfile(input.assetType);
  const assetId = input.assetId;
  const identity = demoAasIdentity(input);
  const manufacturer = identity.manufacturer;
  const productModel = identity.model;
  const serialNumber = identity.serialNumber;
  const submodelId = (name: string) => `${assetId}/submodels/${name}`;
  const reference = (
    name: string,
    ...path: [string, string][]
  ): DemoAasReference => ({
    type: "ModelReference",
    keys: [
      { type: "Submodel", value: submodelId(name) },
      ...path.map(([type, value]) => ({ type, value })),
    ],
  });
  const concepts = new Map<string, Record<string, unknown>>();
  function semantics(
    key: string,
    label: string,
    definition: string,
    valueType?: string,
    unit?: string,
  ): DemoAasReference {
    const id = `${semanticRoot}${key}${unit ? `:${encodeURIComponent(unit)}` : ""}`;
    if (!concepts.has(id)) {
      const dataType =
        valueType === "langString"
          ? "STRING_TRANSLATABLE"
          : valueType === "xs:boolean"
            ? "BOOLEAN"
            : valueType === "xs:date"
              ? "DATE"
              : valueType === "xs:dateTime"
                ? "TIMESTAMP"
                : valueType === "xs:integer"
                  ? unit
                    ? "INTEGER_MEASURE"
                    : "INTEGER_COUNT"
                  : valueType === "xs:double"
                    ? unit
                      ? "REAL_MEASURE"
                      : "REAL_COUNT"
                    : valueType === "xs:anyURI"
                      ? "IRI"
                      : "STRING";
      concepts.set(id, {
        modelType: "ConceptDescription",
        id,
        idShort: idShort(key),
        displayName: translated(label),
        description: translated(definition),
        ...(valueType
          ? {
              embeddedDataSpecifications: [
                {
                  dataSpecification: external(
                    "https://admin-shell.io/DataSpecificationTemplates/DataSpecificationIEC61360/3/0",
                  ),
                  dataSpecificationContent: {
                    modelType: "DataSpecificationIec61360",
                    preferredName: translated(label),
                    definition: translated(definition),
                    dataType,
                    ...(unit ? { unit } : {}),
                  },
                },
              ],
            }
          : {}),
      });
    }
    return external(id);
  }
  const property = (
    name: string,
    value: string | number | boolean,
    label: string,
    valueType = typeof value === "number"
      ? "xs:double"
      : typeof value === "boolean"
        ? "xs:boolean"
        : "xs:string",
    unit?: string,
    definition = label,
  ): DemoAasElement => ({
    modelType: "Property",
    idShort: name,
    displayName: translated(label),
    description: translated(definition),
    semanticId: semantics(name, label, definition, valueType, unit),
    valueType,
    value: String(value),
  });
  const multilingual = (
    name: string,
    en: string,
    de: string,
    label: string,
  ): DemoAasElement => ({
    modelType: "MultiLanguageProperty",
    idShort: name,
    displayName: translated(label),
    semanticId: semantics(name, label, label, "langString"),
    value: translated(en, de),
  });
  const collection = (
    name: string,
    label: string,
    value: DemoAasElement[],
  ): DemoAasElement => ({
    modelType: "SubmodelElementCollection",
    idShort: name,
    displayName: translated(label),
    semanticId: semantics(name, label, label),
    value,
  });
  const referenceElement = (
    name: string,
    label: string,
    value: DemoAasReference,
  ): DemoAasElement => ({
    modelType: "ReferenceElement",
    idShort: name,
    displayName: translated(label),
    semanticId: semantics(name, label, label),
    value,
  });
  const blob = (name: string, content: string): DemoAasElement => ({
    modelType: "Blob",
    idShort: name,
    displayName: translated("Embedded text document"),
    semanticId: semantics(
      name,
      "Embedded text document",
      "UTF-8 text included in this model, encoded as base64 in normal AAS JSON.",
    ),
    contentType: "text/plain; charset=utf-8",
    value: base64(content),
  });
  const submodel = (
    name: string,
    label: string,
    elements: DemoAasElement[],
  ) => ({
    modelType: "Submodel" as const,
    id: submodelId(name),
    idShort: name,
    kind: "Instance" as const,
    displayName: translated(label),
    description: translated(`${label}. ${DEMO_AAS_NOTICE}`),
    semanticId: semantics(
      name,
      label,
      `Smart Factory authored demonstration profile: ${label}. Application model, not a certified IDTA submodel template.`,
    ),
    administration: { version: String(input.aasVersion ?? 1), revision: "0" },
    submodelElements: elements,
  });
  const materialMasses = profile.materials.map((material) => ({
    ...material,
    massKg: fixed(material.massFraction * profile.massKg),
  }));
  const documents = [
    {
      id: "Datasheet",
      title: "Demonstration technical datasheet",
      body: `${input.name}\nAsset: ${assetId}\n${DEMO_AAS_NOTICE}\n\n${profile.specifications.map((s) => `${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ""}`).join("\n")}\n\nManufacturer label supplied with the demo: ${manufacturer}. These illustrative values are not the manufacturer's published ratings.`,
    },
    {
      id: "MaintenanceGuide",
      title: "Demonstration maintenance guide",
      body: `${input.name}\n${DEMO_AAS_NOTICE}\n\n${profile.maintenanceTasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nFor actual equipment use manufacturer documentation and a qualified maintenance process. This text is an example record, not an instruction to operate hardware.`,
    },
    {
      id: "CircularityGuide",
      title: "Demonstration disassembly and materials guide",
      body: `${input.name}\n${DEMO_AAS_NOTICE}\n\nMaterials (illustrative whole-assembly mass):\n${materialMasses.map((m) => `${m.name}: ${m.massKg} kg (${fixed(m.massFraction * 100)}%)`).join("\n")}\n\nRecord isolation, separate replaceable assemblies, and segregate metals, polymers and electronic parts using a qualified recycler. Recovery figures are scenario assumptions, not guarantees.`,
    },
  ];
  const submodels = [
    submodel("Nameplate", "Digital nameplate", [
      property(
        "URIOfTheProduct",
        assetId,
        "Global asset identifier",
        "xs:anyURI",
      ),
      multilingual("AssetName", input.name, input.name, "Asset name"),
      multilingual(
        "ManufacturerName",
        manufacturer,
        manufacturer,
        "Supplied manufacturer label",
      ),
      multilingual(
        "ManufacturerProductDesignation",
        productModel,
        productModel,
        "Supplied product model",
      ),
      property("SerialNumber", serialNumber, "Serial number"),
      property("AssetType", input.assetType, "Asset type"),
      property(
        "ManufacturerArticleNumber",
        identity.manufacturerArticleNumber,
        "Synthetic article number",
      ),
      property(
        "OrderCodeOfManufacturer",
        identity.orderCodeOfManufacturer,
        "Synthetic order code",
      ),
      property(
        "DemonstrationProfileVersion",
        DEMO_AAS_PROFILE_VERSION,
        "Demonstration profile version",
      ),
      property(
        "YearOfConstruction",
        2025,
        "Illustrative year of construction",
        "xs:integer",
      ),
      property(
        "DateOfManufacture",
        "2025-11-03",
        "Illustrative manufacture date",
        "xs:date",
      ),
      property(
        "InstallationZone",
        textOr(input.zone, "Demonstration factory"),
        "Installation zone",
      ),
      collection(
        "DemonstrationContact",
        "Fictional demonstration contact — not manufacturer contact",
        [
          property(
            "Organisation",
            "Smart Factory demonstration team",
            "Demonstration organisation",
          ),
          property("Street", "Example Street 1", "Fictional street"),
          property("City", "Example City", "Fictional city"),
          property("PostalCode", "00000", "Fictional postal code"),
          property("CountryCode", "DE", "Demonstration country code"),
          property(
            "Email",
            "demo@example.invalid",
            "Non-deliverable example contact",
          ),
        ],
      ),
      property(
        "IdentityVerification",
        "Supplied labels are preserved; manufacturer identity and specifications have not been independently verified.",
        "Identity verification status",
      ),
    ]),
    submodel("TechnicalData", "Technical specifications", [
      multilingual(
        "IntendedUse",
        profile.description,
        "Synthetisches Anlagenmodell für die Smart-Factory-Demonstration.",
        "Intended demonstration use",
      ),
      collection(
        "RatedCharacteristics",
        "Illustrative rated characteristics",
        profile.specifications.map((s) =>
          property(
            s.id,
            s.value,
            s.label,
            s.valueType,
            s.unit,
            `${s.label} in the authored ${profile.label.toLowerCase()} scenario; not a vendor rating.`,
          ),
        ),
      ),
      property(
        "SpecificationSource",
        "Authored Smart Factory demonstration profile; no physical measurements or vendor datasheet used.",
        "Specification source",
      ),
      referenceElement(
        "DatasheetReference",
        "Embedded datasheet",
        reference("HandoverDocumentation", [
          "SubmodelElementCollection",
          "Datasheet",
        ]),
      ),
    ]),
    submodel(
      "HandoverDocumentation",
      "Documents and handover",
      documents.map((document) =>
        collection(document.id, document.title, [
          property(
            "DocumentId",
            `${assetId}/documents/${document.id}`,
            "Document identifier",
            "xs:anyURI",
          ),
          multilingual(
            "Title",
            document.title,
            document.title,
            "Document title",
          ),
          property("Language", "en", "Document language"),
          property("DocumentVersion", "1.0", "Document version"),
          property(
            "DocumentDate",
            "2026-10-20",
            "Authored document date",
            "xs:date",
          ),
          property(
            "DocumentStatus",
            "Synthetic example; supplied in full inside this AAS",
            "Document status",
          ),
          blob("DigitalFile", document.body),
        ]),
      ),
    ),
    submodel("Maintenance", "Maintenance and service history", [
      property("MaintenanceFreeAsset", false, "Maintenance-free asset"),
      property(
        "ServiceIntervalHours",
        2000,
        "Illustrative service interval",
        "xs:integer",
        "h",
      ),
      property(
        "ServiceIntervalMonths",
        6,
        "Illustrative calendar service interval",
        "xs:integer",
        "mo",
      ),
      collection(
        "PlannedTasks",
        "Planned service tasks",
        profile.maintenanceTasks.map((task, i) =>
          collection(`Task${i + 1}`, `Task ${i + 1}`, [
            property("Instruction", task, "Task description"),
            property(
              "TaskStatus",
              "Illustrative planned activity",
              "Task status",
            ),
          ]),
        ),
      ),
      collection("LastService", "Recorded simulated service", [
        property("PerformedOn", "2026-09-15", "Service date", "xs:date"),
        property(
          "HoursAtService",
          1800,
          "Recorded operating hours",
          "xs:integer",
          "h",
        ),
        property(
          "PerformedBy",
          "Demonstration service team",
          "Service provider",
        ),
        property(
          "ServiceResult",
          "Illustrative inspection completed; no physical inspection performed",
          "Service result",
        ),
        referenceElement(
          "InspectedComponent",
          "Example inspected assembly",
          reference("BillOfMaterials", ["Entity", "Component1"]),
        ),
      ]),
      property(
        "NextPlannedService",
        "2027-03-15",
        "Next calendar service in the scenario",
        "xs:date",
      ),
      referenceElement(
        "MaintenanceGuideReference",
        "Embedded maintenance guide",
        reference("HandoverDocumentation", [
          "SubmodelElementCollection",
          "MaintenanceGuide",
        ]),
      ),
    ]),
    submodel("MaterialComposition", "Material composition", [
      property(
        "CompositionScope",
        "Whole assembly mass; simplified non-overlapping material classes",
        "Composition scope",
      ),
      property(
        "TotalMass",
        profile.massKg,
        "Total assembly mass",
        "xs:double",
        "kg",
      ),
      collection(
        "Materials",
        "Illustrative materials",
        materialMasses.map((m, i) =>
          collection(`Material${i + 1}`, m.name, [
            property("MaterialName", m.name, "Material name"),
            property(
              "MaterialMass",
              m.massKg,
              "Material mass",
              "xs:double",
              "kg",
            ),
            property(
              "MassFraction",
              fixed(m.massFraction * 100),
              "Mass fraction",
              "xs:double",
              "%",
            ),
            property(
              "MaterialDataSource",
              "Synthetic mass allocation for demonstration",
              "Material data source",
            ),
          ]),
        ),
      ),
      property(
        "SubstanceAssessment",
        "No verified restricted-substance or chemical assessment is available in this demo.",
        "Substance assessment",
      ),
    ]),
    submodel("Circularity", "Repair and circularity", [
      property(
        "ExpectedServiceLife",
        profile.expectedServiceYears,
        "Assumed service life",
        "xs:double",
        "a",
      ),
      property(
        "IllustrativeRecycledContent",
        25,
        "Assumed recycled input content",
        "xs:double",
        "%",
      ),
      property(
        "IllustrativeRecoverableMass",
        85,
        "Assumed recoverable output mass share",
        "xs:double",
        "%",
      ),
      property(
        "ReplaceableAssemblies",
        profile.components.map((c) => c.name).join(", "),
        "Replaceable assemblies",
      ),
      property(
        "RepairStrategy",
        "Inspect first; repair or replace the affected assembly and retain its service history.",
        "Repair strategy",
      ),
      property(
        "DisassemblyGuidance",
        "Qualified isolation and inspection precede separation of the serviceable assemblies; segregate material streams.",
        "Disassembly guidance",
      ),
      property(
        "EndOfLifeRoute",
        "Assess reuse, then component recovery; send residual materials to qualified recycling or disposal.",
        "End of life route",
      ),
      property(
        "RecoveryEvidence",
        "Scenario assumptions only; no recycler acceptance or recovery certification.",
        "Recovery evidence",
      ),
      referenceElement(
        "CircularityGuideReference",
        "Embedded circularity guide",
        reference("HandoverDocumentation", [
          "SubmodelElementCollection",
          "CircularityGuide",
        ]),
      ),
    ]),
    submodel("SoftwareAndFirmware", "Software and firmware inventory", [
      collection("MonitoringAdapter", "Demonstration monitoring adapter", [
        property(
          "SoftwareName",
          "Smart Factory simulated asset adapter",
          "Software name",
        ),
        property("InstalledVersion", "1.0.0-demo", "Installed version"),
        property(
          "SoftwareProvider",
          "Smart Factory demonstration",
          "Software provider",
        ),
        property(
          "InstallationDate",
          "2026-02-01",
          "Illustrative installation date",
          "xs:date",
        ),
        property(
          "SoftwareRole",
          "Generates recorded demonstration signals; does not control real equipment",
          "Software role",
        ),
      ]),
      property(
        "AssetFirmwareStatus",
        ["gateway", "robotic_arm", "control_cabinet"].includes(profile.key)
          ? "Illustrative embedded controller; manufacturer firmware version not asserted"
          : "No asset firmware version asserted; monitoring adapter is separate",
        "Asset firmware status",
      ),
      property(
        "UpdatePolicy",
        "Demonstration metadata only; no downloadable binary or physical OTA action",
        "Update policy",
      ),
      property("CredentialsIncluded", false, "Credentials included"),
    ]),
    submodel("BillOfMaterials", "Assemblies and components", [
      property(
        "BillOfMaterialsScope",
        `Assembly-level illustrative breakdown of ${profile.components.length} co-managed assemblies; not a complete engineering or manufacturer BOM. The installed CAD/equipment BOM is retained separately.`,
        "Assembly breakdown scope",
      ),
      property(
        "IllustrativeAssemblyCount",
        profile.components.length,
        "Number of illustrative assemblies",
        "xs:integer",
      ),
      ...profile.components.map(
        (component): DemoAasElement => ({
          modelType: "Entity",
          idShort: component.id,
          displayName: translated(component.name),
          semanticId: semantics(
            "AssemblyComponent",
            "Assembly component",
            "Co-managed component described within this demonstration asset.",
          ),
          entityType: "CoManagedEntity",
          statements: [
            property(
              "ComponentIdentifier",
              `${assetId}/components/${component.id}`,
              "Component identifier",
              "xs:anyURI",
            ),
            property("ComponentName", component.name, "Component name"),
            property("Quantity", component.quantity, "Quantity", "xs:integer"),
            property(
              "PrincipalMaterial",
              component.material,
              "Illustrative principal material",
            ),
            property("Serviceable", true, "Serviceable assembly"),
          ],
        }),
      ),
      ...profile.components.map(
        (component): DemoAasElement => ({
          modelType: "RelationshipElement",
          idShort: `Contains${component.id}`,
          displayName: translated(`Asset contains ${component.name}`),
          semanticId: semantics(
            "ContainsComponent",
            "Contains component",
            "The shell's asset contains this co-managed demonstration component.",
          ),
          first: {
            type: "ModelReference",
            keys: [{ type: "AssetAdministrationShell", value: assetId }],
          },
          second: reference("BillOfMaterials", ["Entity", component.id]),
        }),
      ),
    ]),
    submodel("OperationalData", "Recorded demonstration operation", [
      property(
        "DataSource",
        "Authored historical simulation snapshot",
        "Data source",
      ),
      property(
        "RecordedAt",
        DEMO_AAS_RECORDED_AT,
        "Recorded at",
        "xs:dateTime",
      ),
      property(
        "WindowStart",
        "2026-10-20T09:00:00Z",
        "Recorded window start",
        "xs:dateTime",
      ),
      property(
        "WindowEnd",
        DEMO_AAS_RECORDED_AT,
        "Recorded window end",
        "xs:dateTime",
      ),
      property(
        "ConnectionState",
        "Simulated; no current physical connection claimed",
        "Connection state",
      ),
      property(
        "OperatingHours",
        1960,
        "Simulated accumulated operating hours",
        "xs:integer",
        "h",
      ),
      property(
        "RecordedAmbientTemperature",
        23.5,
        "Recorded ambient temperature",
        "xs:double",
        "°C",
      ),
      property(
        "Quality",
        "Synthetic example; not calibrated sensor evidence",
        "Data quality",
      ),
      property(
        "Transport",
        "Simulation snapshot; live measurements use the application's separate telemetry routes",
        "Telemetry transport",
      ),
      property("PhysicalControlEnabled", false, "Physical control enabled"),
    ]),
    submodel("DigitalProductPassport", "Passport identity and provenance", [
      property(
        "UniqueProductIdentifier",
        assetId,
        "Unique product identifier",
        "xs:anyURI",
      ),
      property("PassportLevel", "item", "Passport level"),
      property("Manufacturer", manufacturer, "Supplied manufacturer label"),
      property("Model", productModel, "Supplied product model"),
      property("SerialNumber", serialNumber, "Serial number"),
      property("DataFormat", "AAS 3.0 JSON", "Data format"),
      property(
        "ProfileVersion",
        DEMO_AAS_PROFILE_VERSION,
        "Demonstration profile version",
      ),
      property(
        "IssuedAt",
        DEMO_AAS_RECORDED_AT,
        "Authored snapshot date",
        "xs:dateTime",
      ),
      multilingual(
        "DemonstrationNotice",
        DEMO_AAS_NOTICE,
        "Verfasste Demonstrationsdaten. Technische Werte, Materialien, Wartung und Umweltangaben sind synthetisch; sie sind keine Herstellerangaben oder geprüften Konformitätsnachweise.",
        "Demonstration notice",
      ),
      property(
        "RegulatoryStatus",
        "Voluntary demonstration; EU product-specific compliance has not been assessed",
        "Regulatory status",
      ),
      property(
        "TemplateConformance",
        "Smart Factory application submodels; no IDTA template certification claimed",
        "Submodel profile",
      ),
      referenceElement(
        "ProductNameplate",
        "Product nameplate",
        reference("Nameplate"),
      ),
    ]),
    submodel("CarbonFootprint", "Illustrative environmental footprint", [
      property(
        "IllustrativeCarbonFootprint",
        fixed(profile.massKg * 4.8),
        "Illustrative carbon footprint",
        "xs:double",
        "kg CO2e",
      ),
      property(
        "FunctionalUnit",
        "One complete asset at the demonstration factory gate",
        "Functional unit",
      ),
      property(
        "SystemBoundary",
        "Illustrative cradle-to-gate scope; use and end-of-life phases excluded",
        "System boundary",
      ),
      property(
        "CalculationMethod",
        "Scenario arithmetic: whole-assembly mass multiplied by an assumed 4.8 kg CO2e/kg; not a lifecycle assessment",
        "Calculation method",
      ),
      property(
        "EmissionFactor",
        4.8,
        "Assumed mass-based emission factor",
        "xs:double",
        "kg CO2e/kg",
      ),
      property(
        "ReferencePeriod",
        "2026 demonstration scenario",
        "Reference period",
      ),
      property(
        "VerificationStatus",
        "Unverified synthetic example; no auditor or standard conformity asserted",
        "Verification status",
      ),
      referenceElement(
        "MaterialReference",
        "Materials used by the example calculation",
        reference("MaterialComposition"),
      ),
    ]),
  ];
  const shell = {
    modelType: "AssetAdministrationShell" as const,
    id: assetId,
    idShort: idShort(input.name),
    displayName: translated(input.name),
    description: translated(DEMO_AAS_NOTICE),
    administration: { version: String(input.aasVersion ?? 1), revision: "0" },
    assetInformation: {
      assetKind: "Instance" as const,
      globalAssetId: assetId,
      specificAssetIds: [
        { name: "serialNumber", value: serialNumber },
        { name: "assetType", value: input.assetType },
        { name: "dataOrigin", value: "authored-demonstration" },
      ],
    },
    submodels: submodels.map((s) => reference(s.idShort)),
  };
  return { shell, submodels, conceptDescriptions: [...concepts.values()] };
}

export type DemoAasDocuments = ReturnType<typeof buildDemoAasDocuments>;

/** The standards exchange shape. The app's persistence fields are not an Environment. */
export function demoAasEnvironment(input: DemoAasInput) {
  const { shell, submodels, conceptDescriptions } =
    buildDemoAasDocuments(input);
  return { assetAdministrationShells: [shell], submodels, conceptDescriptions };
}
