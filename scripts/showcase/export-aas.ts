/** Pure fixture export: no database, seeding or network access.
 * node --import tsx scripts/showcase/export-aas.ts ../local-tools/demo-aas-validation
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { demoAasEnvironment } from "../../shared/demo-aas";

const output = process.argv[2];
if (!output)
  throw new Error(
    "Specify an output directory for the independent AAS fixtures",
  );
const directory = resolve(output);
mkdirSync(directory, { recursive: true });
const types = [
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
];
for (const assetType of types) {
  const environment = demoAasEnvironment({
    assetId: `urn:smart-factory:validation:${assetType}`,
    name: `Demonstration ${assetType} — Prüfanlage`,
    assetType,
    manufacturer: "Supplied example manufacturer",
    model: `Supplied ${assetType} example`,
    serialNumber: `SIM-${assetType}`,
    zone: "Demonstration utilities",
  });
  writeFileSync(
    resolve(directory, `${assetType}.aas.json`),
    `${JSON.stringify(environment, null, 2)}\n`,
  );
}
console.log(
  `Exported ${types.length} deterministic demonstration AAS environments to ${directory}`,
);
