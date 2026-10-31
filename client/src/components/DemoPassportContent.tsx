import { useMemo } from "react";
import {
  Download,
  ExternalLink,
  FileJson,
  Layers3,
  Recycle,
  Wrench,
} from "lucide-react";
import {
  buildDemoAasDocuments,
  demoAasIdentity,
  getDemoAasProfile,
} from "@shared/demo-aas";
import {
  demoPassportPath,
  MAX_DEMO_PASSPORT_URL_LENGTH,
  type DemoPassportIdentity,
} from "@shared/demo-passport";
import { PASSPORT_DISCLAIMER } from "@shared/passport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PassportCard } from "./PassportCard";

type Row = { label: string; value: string };
const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const label = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ")
    : "Value";

/** Render model content as text only; demo documents and values never become HTML. */
function modelRows(
  elements: unknown,
  units: ReadonlyMap<string, string>,
  prefix = "",
): Row[] {
  if (!Array.isArray(elements)) return [];
  return elements.flatMap((raw, index): Row[] => {
    const element = record(raw);
    if (!element) return [];
    const displayNames = Array.isArray(element.displayName)
      ? element.displayName.map(record).filter(Boolean)
      : [];
    const name =
      displayNames.find((name) => name?.language === "en")?.text ??
      element.idShort ??
      `Item ${index + 1}`;
    const title = prefix + label(name);
    if (
      ["SubmodelElementCollection", "SubmodelElementList"].includes(
        String(element.modelType),
      )
    )
      return modelRows(element.value, units, title + " / ");
    if (element.modelType === "Entity")
      return modelRows(element.statements, units, title + " / ");
    let value: string;
    if (
      element.modelType === "MultiLanguageProperty" &&
      Array.isArray(element.value)
    ) {
      value = element.value
        .map(record)
        .filter(Boolean)
        .map((entry) => `${entry!.text} (${entry!.language})`)
        .join(" · ");
    } else if (
      element.modelType === "Blob" &&
      typeof element.value === "string"
    ) {
      try {
        value = new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(element.value), (character) =>
            character.charCodeAt(0),
          ),
        );
      } catch {
        value = "Embedded document available in the AAS JSON download";
      }
    } else if (
      record(element.value)?.keys &&
      Array.isArray(record(element.value)!.keys)
    ) {
      value = (record(element.value)!.keys as unknown[])
        .map(record)
        .map((key) => key?.value)
        .filter(Boolean)
        .join(" / ");
    } else if (["string", "number", "boolean"].includes(typeof element.value)) {
      value = String(element.value);
    } else {
      return [];
    }
    const semanticKeys = record(element.semanticId)?.keys;
    const semantic = Array.isArray(semanticKeys)
      ? record(semanticKeys[0])?.value
      : null;
    const unit = typeof semantic === "string" ? units.get(semantic) : null;
    if (element.modelType === "Property" && unit) value += ` ${unit}`;
    return value ? [{ label: title, value }] : [];
  });
}

export function DemoPassportContent({
  identity: input,
  printId,
}: {
  identity: DemoPassportIdentity;
  printId?: string;
}) {
  const identity = useMemo(() => {
    const {
      assetId,
      name,
      assetType,
      manufacturer,
      model,
      serialNumber,
      zone,
    } = demoAasIdentity(input);
    return {
      assetId,
      name,
      assetType,
      manufacturer,
      model,
      serialNumber,
      zone,
    };
  }, [input]);
  const model = useMemo(() => buildDemoAasDocuments(identity), [identity]);
  const units = useMemo(() => {
    const result = new Map<string, string>();
    for (const concept of model.conceptDescriptions) {
      const content = record(
        record((concept.embeddedDataSpecifications as unknown[])?.[0])
          ?.dataSpecificationContent,
      );
      if (typeof concept.id === "string" && typeof content?.unit === "string")
        result.set(concept.id, content.unit);
    }
    return result;
  }, [model]);
  const profile = getDemoAasProfile(identity.assetType);
  const link = useMemo(() => {
    try {
      const url = `${window.location.origin}${window.location.pathname}#${demoPassportPath(identity)}`;
      if (url.length > MAX_DEMO_PASSPORT_URL_LENGTH)
        throw new Error("Demo QR URL exceeds its scan budget");
      return { url, error: null };
    } catch {
      return {
        url: null,
        error:
          "These demo identity fields are too long for a scannable QR label. Shorten the identity fields or download the complete AAS JSON.",
      };
    }
  }, [identity]);

  const download = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              assetAdministrationShells: [model.shell],
              submodels: model.submodels,
              conceptDescriptions: model.conceptDescriptions,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${identity.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "demo"}.aas.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <article id={printId} className="eudpp-page min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="max-w-xl text-sm text-muted-foreground">
          Simulated product information. The QR carries this demo identity and
          opens the same example on another device.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={download}>
            <Download aria-hidden="true" className="size-4" />
            Download AAS JSON
          </Button>
          {link.url && (
            <Button variant="outline" asChild>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" className="size-4" />
                Open demo link
              </a>
            </Button>
          )}
        </div>
      </div>
      <PassportCard
        title={identity.name}
        status="Simulated demonstration"
        rows={[
          { key: "productType", label: "Product type", value: profile.label },
          {
            key: "manufacturer",
            label: "Manufacturer",
            value: identity.manufacturer,
          },
          {
            key: "model",
            label: "Model",
            value: identity.model,
          },
          {
            key: "serial",
            label: "Serial number",
            value: identity.serialNumber,
          },
          {
            key: "assetId",
            label: "Product identifier",
            value: identity.assetId,
          },
          {
            key: "zone",
            label: "Factory zone",
            value: identity.zone,
          },
          {
            key: "source",
            label: "Data source",
            value: "Authored simulation · no connected physical asset",
          },
        ]}
        qr={
          link.url
            ? {
                value: link.url,
                caption:
                  "Open this simulated product identity and its example AAS model.",
                demo: true,
              }
            : undefined
        }
      />
      {link.error && (
        <p role="alert" className="rounded-md border p-3 text-sm">
          {link.error}
        </p>
      )}
      <div
        className="grid min-w-0 gap-4 sm:grid-cols-3"
        aria-label="Demo AAS coverage"
      >
        {[
          {
            icon: Layers3,
            value: model.submodels.length,
            label: "Populated AAS submodels",
          },
          {
            icon: FileJson,
            value: model.conceptDescriptions.length,
            label: "Defined concepts",
          },
          {
            icon: Recycle,
            value: `${profile.massKg} kg`,
            label: "Illustrative product mass",
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border bg-card p-4 print:break-inside-avoid"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <metric.icon aria-hidden="true" className="size-4" />
              {metric.label}
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {metric.value}
            </p>
          </div>
        ))}
      </div>
      <Card className="print:break-inside-avoid print:shadow-none">
        <CardHeader>
          <CardTitle>Technical characteristics</CardTitle>
          <p className="text-sm text-muted-foreground">
            {profile.description} Values below are illustrative specifications.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {profile.specifications.map((specification) => (
              <div
                key={specification.id}
                className="flex min-w-0 items-start justify-between gap-4 border-b pb-3"
              >
                <dt className="text-sm text-muted-foreground">
                  {specification.label}
                </dt>
                <dd className="min-w-0 break-words text-right text-sm font-medium">
                  {specification.value}
                  {specification.unit ? ` ${specification.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Card className="print:break-inside-avoid print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Recycle aria-hidden="true" className="size-4" />
              Materials & circularity
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Example composition by mass, with {profile.expectedServiceYears}{" "}
              years of modeled service life.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {profile.materials.map((material) => (
              <div key={material.name} className="space-y-2">
                <div className="flex justify-between gap-4 text-sm">
                  <span>{material.name}</span>
                  <span className="font-medium tabular-nums">
                    {Math.round(material.massFraction * 1000) / 10}%
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${material.massFraction * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="print:break-inside-avoid print:shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench aria-hidden="true" className="size-4" />
              Use, repair and end of life
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Example maintenance tasks for exploring the demo lifecycle.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-3 pl-5 text-sm">
              {profile.maintenanceTasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-muted-foreground">
              These examples are not operating instructions for real equipment.
              Use the actual manufacturer’s approved documentation for physical
              work.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Explore the complete AAS model</CardTitle>
          <p className="text-sm text-muted-foreground">
            Identity, specifications, documentation, components and lifecycle
            data. Download the same model as machine-readable AAS JSON.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {model.submodels.map((submodel) => (
            <details
              key={submodel.id}
              className="rounded-lg border px-4"
              data-testid="demo-aas-submodel"
            >
              <summary className="cursor-pointer py-3 text-sm font-medium">
                {label(submodel.idShort)}
              </summary>
              <dl className="space-y-3 border-t py-4">
                {modelRows(submodel.submodelElements, units).map(
                  (row, index) => (
                    <div
                      key={`${index}-${row.label}`}
                      className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:gap-5"
                    >
                      <dt className="break-words text-xs text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                        {row.value}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </details>
          ))}
        </CardContent>
      </Card>
      <p className="rounded-lg border bg-muted/20 p-4 text-sm print:break-inside-avoid">
        <strong>Regulatory status:</strong> {PASSPORT_DISCLAIMER} All
        specifications, material shares and lifecycle records here are synthetic
        demonstration data.
      </p>
    </article>
  );
}
