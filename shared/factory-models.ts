/** Bundled, illustrative references. These descriptors never identify installed equipment. */
export const factoryModels = [
  {
    slug: "conveyor",
    name: "Belt conveyor",
    description:
      "Belt loop, rollers, bearings, geared drive and adjustable support frame.",
    assetType: "conveyor",
  },
  {
    slug: "robot-arm",
    name: "Six-axis industrial robot",
    description:
      "Six joint assemblies, bearings, drive rotors, cast links and tool flange.",
    assetType: "robot",
  },
  {
    slug: "control-cabinet",
    name: "Industrial control cabinet",
    description:
      "Enclosure, front door, PLC modules, DIN rails, breakers, terminals and wiring.",
    assetType: "other",
  },
  {
    slug: "valve",
    name: "Flanged ball valve",
    description:
      "Hollow body, bored ball, seats, bolted flanges, spindle and handwheel.",
    assetType: "valve",
  },
  {
    slug: "storage-tank",
    name: "Stainless process tank",
    description:
      "Dished vessel, agitator, access cover, nozzles, support feet and access ladder.",
    assetType: "tank",
  },
] as const;

export const referenceModels = [
  ...factoryModels.map((model) => ({
    ...model,
    revision: `smart-factory-illustrative-${model.slug}-1`,
  })),
  {
    slug: "pump-motor",
    name: "Pump and motor",
    description:
      "Detailed centrifugal pump and motor with bearings, seals, windings and coupling.",
    assetType: "pump",
    revision: "smart-factory-illustrative-pump-motor-4",
  },
  {
    slug: "raspberry-pi-4b",
    name: "Raspberry Pi 4 Model B",
    description:
      "Edge board, connectors, headers, processor, memory and wireless shield.",
    assetType: "gateway",
    revision: "smart-factory-illustrative-raspberry-pi-4b-1",
  },
];
