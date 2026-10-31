import type { NewFactoryItem } from "./named-factory";
export const factoryCatalog: Array<{
  id: string;
  label: string;
  kind: NewFactoryItem["kind"];
  itemType: string;
  width: number;
  depth: number;
  height: number;
}> = [
  {
    id: "pump",
    label: "Pump / motor",
    kind: "asset",
    itemType: "pump",
    width: 2,
    depth: 1.2,
    height: 1.5,
  },
  {
    id: "conveyor",
    label: "Conveyor",
    kind: "asset",
    itemType: "conveyor",
    width: 4,
    depth: 1.1,
    height: 1.2,
  },
  {
    id: "robot",
    label: "Robot arm",
    kind: "asset",
    itemType: "robotic_arm",
    width: 2,
    depth: 2,
    height: 3,
  },
  {
    id: "tank",
    label: "Storage tank",
    kind: "asset",
    itemType: "storage_tank",
    width: 2,
    depth: 2,
    height: 3.1,
  },
  {
    id: "cabinet",
    label: "Control cabinet",
    kind: "asset",
    itemType: "control_cabinet",
    width: 1.2,
    depth: 0.7,
    height: 2.4,
  },
  {
    id: "valve",
    label: "Valve",
    kind: "asset",
    itemType: "valve",
    width: 0.8,
    depth: 0.4,
    height: 1.4,
  },
  {
    id: "rack",
    label: "Warehouse rack",
    kind: "asset",
    itemType: "warehouse_rack",
    width: 2.8,
    depth: 0.9,
    height: 3,
  },
  {
    id: "loading",
    label: "Loading door",
    kind: "asset",
    itemType: "loading_door",
    width: 3.5,
    depth: 0.35,
    height: 3.2,
  },
  {
    id: "exit",
    label: "Exit door",
    kind: "asset",
    itemType: "exit_door",
    width: 1,
    depth: 0.2,
    height: 2.1,
  },
  {
    id: "sensor",
    label: "Sensor",
    kind: "device",
    itemType: "sensor",
    width: 0.15,
    depth: 0.15,
    height: 0.2,
  },
  {
    id: "gateway",
    label: "Gateway",
    kind: "device",
    itemType: "gateway",
    width: 0.25,
    depth: 0.2,
    height: 0.12,
  },
  {
    id: "other",
    label: "Other equipment",
    kind: "asset",
    itemType: "industrial_equipment",
    width: 1,
    depth: 1,
    height: 1,
  },
];
