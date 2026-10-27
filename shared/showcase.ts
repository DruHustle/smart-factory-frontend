/** Only authored, non-sensitive demonstration metadata belongs in this contract. */
export type Showcase = {
  version: number;
  anchor: string;
  from: string;
  equipmentId: string;
  assetRef: string;
  assetId: string;
  sensorRef: string;
  gatewayRef: string;
  incidentId: number;
  securitySourceId: string;
  label: string;
  standaloneRef?: string;
  securityFindingId?: string;
  passportId?: string;
  chapters?: Array<{
    title: string;
    description: string;
    href: string;
    state: "available" | "prerequisite";
  }>;
  firmware?: Array<{
    id: number;
    version: string;
    deviceType: string;
    releaseNotes: string;
    isStable: boolean;
    artifactAvailable: boolean;
    createdAt: string;
  }>;
  rollouts?: Array<{
    id: number;
    deviceId: number;
    firmwareVersionId: number;
    status: string;
    errorMessage: string;
    createdAt: string;
  }>;
  integrations?: Array<{
    name: string;
    state: string;
    detail: string;
    href: string;
  }>;
  audit?: Array<{ at: string; action: string; detail: string }>;
};
