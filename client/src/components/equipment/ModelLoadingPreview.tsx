import { bundledPreview } from "@shared/bundled-assets";
import pumpPreview from "@/assets/equipment/pump-preview.webp";
import piPreview from "@/assets/equipment/pi-preview.webp";
import pumpPreviewDark from "@/assets/equipment/pump-preview-dark.webp";
import piPreviewDark from "@/assets/equipment/pi-preview-dark.webp";
import conveyor from "@/assets/equipment/conveyor-preview.webp";
import conveyorDark from "@/assets/equipment/conveyor-preview-dark.webp";
import robot from "@/assets/equipment/robot-arm-preview.webp";
import robotDark from "@/assets/equipment/robot-arm-preview-dark.webp";
import cabinet from "@/assets/equipment/control-cabinet-preview.webp";
import cabinetDark from "@/assets/equipment/control-cabinet-preview-dark.webp";
import valve from "@/assets/equipment/valve-preview.webp";
import valveDark from "@/assets/equipment/valve-preview-dark.webp";
import tank from "@/assets/equipment/storage-tank-preview.webp";
import tankDark from "@/assets/equipment/storage-tank-preview-dark.webp";

const previews: Record<string, readonly [string, string]> = {
  "smart-factory-illustrative-pump-motor-4": [pumpPreview, pumpPreviewDark],
  "smart-factory-illustrative-raspberry-pi-4b-1": [piPreview, piPreviewDark],
  "smart-factory-illustrative-conveyor-1": [conveyor, conveyorDark],
  "smart-factory-illustrative-robot-arm-1": [robot, robotDark],
  "smart-factory-illustrative-control-cabinet-1": [cabinet, cabinetDark],
  "smart-factory-illustrative-valve-1": [valve, valveDark],
  "smart-factory-illustrative-storage-tank-1": [tank, tankDark],
};

/** These are rendered previews of these exact public reference revisions. */
export function referencePreview(revision?: string, dark = false) {
  return revision
    ? (previews[revision]?.[dark ? 1 : 0] ?? bundledPreview(revision))
    : undefined;
}

export default function ModelLoadingPreview({
  revision,
  preview = false,
}: {
  revision?: string;
  preview?: boolean;
}) {
  const image = referencePreview(revision);
  return (
    <div
      className={`relative overflow-hidden rounded border bg-[#edf2f7] dark:bg-[#101a2a] ${preview ? "h-64 sm:h-80" : "h-[320px] sm:h-[420px] lg:h-[500px]"}`}
    >
      {image && (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-contain dark:hidden"
          decoding="async"
        />
      )}
      {image && (
        <img
          src={referencePreview(revision, true)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 hidden h-full w-full object-contain dark:block"
          decoding="async"
        />
      )}
      <p
        role="status"
        className="absolute inset-x-0 bottom-0 bg-background/90 px-3 py-2 text-center text-xs"
      >
        {image ? "Model preview · " : ""}Preparing interactive 3D…
      </p>
    </div>
  );
}
