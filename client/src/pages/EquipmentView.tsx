import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useWorkspaceLocation as useHashLocation } from "@/lib/hashLocation";
import { useEffect, useState, useRef, lazy, Suspense } from "react";
import type { LocalRendererHandle } from "@/components/equipment/LocalEquipmentRenderer";
import { loadEquipmentRenderer } from "@/components/equipment/loadRenderer";
import ModelLoadingPreview from "@/components/equipment/ModelLoadingPreview";
const LocalEquipmentRenderer = lazy(loadEquipmentRenderer);
const ModelImport = lazy(() => import("@/components/equipment/ModelImport"));
const ModelReplacement = lazy(
  () => import("@/components/equipment/ModelReplacement"),
);
const EquipmentBindingEditor = lazy(() =>
  import("@/components/workspace/MappingEditors").then((m) => ({
    default: m.EquipmentBindingEditor,
  })),
);
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function EquipmentView({
  equipmentId,
  embedded = false,
  section = "3d",
  active = true,
}: {
  equipmentId?: string;
  embedded?: boolean;
  section?: string;
  active?: boolean;
} = {}) {
  const [hashLocation] = useHashLocation();
  const access = trpc.equipment.access.useQuery();
  const writable = access.data?.canWrite === true;
  const catalog = trpc.equipment.list.useQuery(undefined, {
    enabled: !embedded,
  });
  const template = trpc.equipment.template.useQuery(undefined, {
    enabled: !embedded,
  });
  const models = trpc.equipment.models.useQuery(undefined, {
    enabled: !embedded,
  });
  const [modelRevision, setModelRevision] = useState("");
  const selectedTemplate = trpc.equipment.bindingTemplate.useQuery(
    { revision: modelRevision },
    { enabled: !embedded && writable && !!modelRevision },
  );
  const bindingModel = modelRevision ? selectedTemplate.data : template.data;
  const securityAccess = trpc.security.availability.useQuery();
  const securityFindingId = new URLSearchParams(
    hashLocation.split("?")[1] ?? "",
  ).get("securityFinding");
  const findingLocation = trpc.security.equipmentForFinding.useQuery(
    { id: securityFindingId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!securityFindingId && securityAccess.data?.enabled === true },
  );
  const assets = trpc.assets.list.useQuery(undefined, { enabled: !embedded });
  const [existingAssetId, setExistingAssetId] = useState(""),
    [bindingText, setBindingText] = useState("");
  const utils = trpc.useUtils();
  const [id, setId] = useState(equipmentId ?? ""),
    [name, setName] = useState(""),
    [serial, setSerial] = useState(""),
    [kind, setKind] = useState<"real" | "simulated">("simulated"),
    [notice, setNotice] = useState("");
  const create = trpc.equipment.create.useMutation({
    onSuccess: (r) => {
      setId(r.id);
      setName("");
      setSerial("");
      void utils.equipment.list.invalidate();
    },
    onError: (e) => setNotice(e.message),
  });
  useEffect(() => {
    if (equipmentId) setId(equipmentId);
  }, [equipmentId]);
  useEffect(() => {
    if (findingLocation.data) setId(findingLocation.data.equipmentId);
  }, [findingLocation.data?.equipmentId]);
  useEffect(() => {
    if (!securityFindingId && !id && catalog.data?.length) {
      const requested = new URL(window.location.href).searchParams.get(
        "equipment",
      );
      setId(
        catalog.data.find((e) => e.id === requested)?.id ?? catalog.data[0].id,
      );
    }
  }, [catalog.data, id, securityFindingId]);
  useEffect(() => {
    if (!id) return;
    const url = new URL(window.location.href);
    url.searchParams.set("equipment", id);
    window.history.replaceState(window.history.state, "", url);
  }, [id]);
  return (
    <div className="space-y-5 min-w-0">
      {securityFindingId &&
        !findingLocation.isLoading &&
        !findingLocation.data && (
          <p role="status">
            No explicit equipment focus is available for this finding. Choose
            equipment or review the finding in the security list.
          </p>
        )}
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Equipment view</h1>
          <p className="text-muted-foreground">
            Local equipment, components, observations and saved work
          </p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!embedded && (
        <>
          <label className="block text-sm" htmlFor="local-equipment">
            Installed equipment
          </label>
          <select
            id="local-equipment"
            className="w-full rounded border bg-background p-2 text-foreground sm:max-w-lg"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            <option value="">Choose local equipment</option>
            {catalog.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.serialNumber} · {e.kind}
              </option>
            ))}
          </select>
          {catalog.isError && (
            <p role="alert">
              Local equipment could not be loaded. Check Smart Factory storage.
            </p>
          )}
          {writable && (
            <details className="rounded border p-4">
              <summary className="cursor-pointer font-medium">
                Create local equipment
              </summary>
              <form
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (template.data) {
                    try {
                      create.mutate({
                        name,
                        serialNumber: serial,
                        kind,
                        templateRevision:
                          modelRevision || template.data.revision,
                        ...(existingAssetId
                          ? {
                              existingAssetId: Number(existingAssetId),
                              sourceBindings: JSON.parse(bindingText),
                            }
                          : {}),
                      });
                    } catch {
                      setNotice(
                        "Provide valid explicit source metric bindings",
                      );
                    }
                  }
                }}
              >
                <label className="text-sm sm:col-span-2">
                  Acquisition source
                  <select
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={existingAssetId}
                    onChange={(e) => {
                      setExistingAssetId(e.target.value);
                      if (e.target.value) {
                        const a = assets.data?.find(
                          (a) => a.id === Number(e.target.value),
                        );
                        setName(a?.name ?? "");
                        setSerial(a?.serialNumber ?? "Declared by operator");
                        setKind("real");
                        setBindingText(
                          JSON.stringify(
                            bindingModel?.bindings.map((b) => ({
                              ...b,
                              sourceUnit: b.unit,
                            })) ?? [],
                            null,
                            2,
                          ),
                        );
                      }
                    }}
                  >
                    <option value="">Create a new local instance</option>
                    {assets.data
                      ?.filter((a) => !a.isDemo)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.assetId}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm">
                  Equipment name
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  Serial number
                  <Input
                    required
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    maxLength={128}
                  />
                </label>
                <label className="text-sm">
                  Equipment data mode
                  <select
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="simulated">Simulated equipment</option>
                    <option value="real">
                      Real equipment · initially no readings
                    </option>
                  </select>
                </label>
                <label className="text-sm">
                  Local model/template
                  <select
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={modelRevision}
                    onChange={(e) => {
                      setModelRevision(e.target.value);
                      setBindingText("[]");
                    }}
                  >
                    <option value="">
                      Bundled illustrative pump and motor
                    </option>
                    {models.data?.bundledModels
                      .filter((m) => m.revision !== template.data?.revision)
                      .map((m) => (
                        <option key={m.revision} value={m.revision}>
                          {m.name}
                        </option>
                      ))}
                    {models.data?.imported.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.id.slice(-12)}
                      </option>
                    ))}
                  </select>
                </label>
                {modelRevision && selectedTemplate.error && (
                  <p role="alert">
                    Model mapping metadata is unavailable. Retry selecting the
                    model before creating equipment.
                  </p>
                )}
                {existingAssetId && (
                  <Suspense
                    fallback={<p role="status">Loading mapping editor…</p>}
                  >
                    <EquipmentBindingEditor
                      value={bindingText || "[]"}
                      onChange={setBindingText}
                      components={bindingModel?.components ?? []}
                    />
                  </Suspense>
                )}
                <Button
                  disabled={
                    !template.data ||
                    create.isPending ||
                    (!!modelRevision && !selectedTemplate.data)
                  }
                >
                  Create equipment
                </Button>
              </form>
              <p className="mt-3 text-xs text-muted-foreground">
                Uses Smart Factory storage and auth. No Onesa pairing is
                required. Models and mappings are owned and validated by Smart
                Factory.
              </p>
            </details>
          )}
          {writable && (
            <Suspense fallback={<p role="status">Loading model tools…</p>}>
              <ModelImport />
            </Suspense>
          )}
        </>
      )}
      {id ? (
        <LocalWorkspace
          id={id}
          writable={writable}
          section={embedded ? section : undefined}
          active={active}
        />
      ) : (
        <p>
          No installed equipment selected. An engineer can create an instance
          from the local template.
        </p>
      )}
    </div>
  );
}
function LocalWorkspace({
  id,
  writable,
  section,
  active,
}: {
  id: string;
  writable: boolean;
  section?: string;
  active: boolean;
}) {
  const wide = useMediaQuery("(min-width:1280px)"),
    documentActive = useDocumentActive();
  const [treeOpen, setTreeOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(false);
  const [stream, setStream] = useState<"live" | "simulated" | undefined>(
    undefined,
  );
  const data = trpc.equipment.get.useQuery(
    { id, mode: stream },
    {
      staleTime: 15000,
      refetchInterval: active && documentActive ? 30000 : false,
      refetchIntervalInBackground: false,
    },
  );
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState("");
  const [replayAt, setReplayAt] = useState<string | null>(null);
  useEffect(() => setStream(undefined), [id]);
  const renderer = useRef<LocalRendererHandle>(null);
  const [viewName, setViewName] = useState("");
  const [componentSearch, setComponentSearch] = useState("");
  const w = data.data;
  const [securityOverlay, setSecurityOverlay] = useState(false);
  const securityAccess = trpc.security.availability.useQuery();
  const security = trpc.security.equipmentOverlay.useQuery(
    { id },
    {
      enabled:
        active && securityOverlay && securityAccess.data?.enabled === true,
    },
  );
  const securityFindingId = new URLSearchParams(
    window.location.hash.split("?")[1] ?? "",
  ).get("securityFinding");
  const linkedFinding = trpc.security.equipmentForFinding.useQuery(
    { id: securityFindingId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!securityFindingId && securityAccess.data?.enabled === true },
  );
  useEffect(() => {
    setSelected(w?.selectedComponent ?? null);
    setNote("");
    setReplayAt(null);
  }, [w?.id, w?.version]);
  useEffect(() => {
    if (
      linkedFinding.data?.equipmentId === id &&
      w?.components.some(
        (c) => c.installedComponentId === linkedFinding.data?.componentId,
      )
    ) {
      setSelected(linkedFinding.data.componentId);
      setSecurityOverlay(true);
    }
  }, [linkedFinding.data?.componentId, id, w?.id]);
  const save = trpc.equipment.save.useMutation({
    onSuccess: () => {
      setNote("");
      setNotice("Local work saved.");
      void utils.equipment.get.invalidate({ id });
    },
    onError: (e) => setNotice(e.message),
  });
  const scenario = trpc.equipment.simulate.useMutation({
    onSuccess: () => {
      setNotice(
        "Simulated source sample persisted through the existing telemetry pipeline.",
      );
      void utils.equipment.get.invalidate({ id });
    },
    onError: (e) => setNotice(e.message),
  });
  if (data.isError)
    return (
      <p role="alert">Equipment context is unavailable: {data.error.message}</p>
    );
  if (!w) return <p role="status">Loading local equipment…</p>;
  const activeObservations = replayAt
    ? w.history
        .filter((o) => o.observedAt === replayAt)
        .map((o) => ({ ...o, mode: "replay" }))
    : w.observations;
  const component = w.components.find(
    (c) => c.installedComponentId === selected,
  );
  const observations = activeObservations.filter(
    (o) => o.componentId === selected,
  );
  const notes = w.annotations.filter((a) => a.componentId === selected);
  const canEdit = writable && !w.isDemo;
  const tree = (
    <Card>
      <CardHeader>
        <CardTitle>Components</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input
          aria-label="Search BOM"
          placeholder="Search assembly / BOM"
          value={componentSearch}
          onChange={(e) => setComponentSearch(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {w.components.length} selectable entries · repeated sets show quantity
        </p>
        <div className="flex max-h-[500px] flex-col gap-2 overflow-y-auto">
          {w.components
            .filter((c) =>
              c.name.toLowerCase().includes(componentSearch.toLowerCase()),
            )
            .map((c) => (
              <Button
                key={c.installedComponentId}
                aria-label={c.name}
                aria-pressed={selected === c.installedComponentId}
                variant={
                  selected === c.installedComponentId ? "default" : "outline"
                }
                onClick={() => setSelected(c.installedComponentId)}
                title={`${c.designation ?? c.name} · quantity ${c.quantity ?? 1}`}
                style={{
                  paddingLeft: `${0.6 + Math.min(4, c.nodePath.split("/").length - 2) * 0.6}rem`,
                }}
                className="min-h-10 h-auto justify-start whitespace-normal border-0 text-left text-sm"
              >
                {c.parentTemplateComponentId ? "↳ " : ""}
                {c.name}
              </Button>
            ))}
        </div>
      </CardContent>
    </Card>
  );
  const inspector = (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{component?.name ?? "Component inspector"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {component ? (
          <>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Designation / material
                </dt>
                <dd>
                  {component.designation ?? component.name} ·{" "}
                  {component.material ?? "Not specified"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Quantity</dt>
                <dd>{component.quantity ?? 1}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Description</dt>
                <dd>
                  {component.description ?? "No reviewed component description"}
                </dd>
              </div>
            </dl>
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">
                Exact component identities
              </summary>
              <p className="mt-2 break-all">
                Installed: {component.installedComponentId}
                <br />
                Template: {component.templateComponentId}
              </p>
            </details>
            <div className="space-y-3 border-t pt-3">
              <h3 className="text-sm font-semibold">Linked observations</h3>
              {observations.length ? (
                observations.map((o) => (
                  <div key={o.metric} className="rounded-md border p-3 text-sm">
                    <p className="capitalize">{o.metric}</p>
                    <p className="mt-1 font-semibold">
                      {o.value == null
                        ? "Unavailable"
                        : `${Number(o.value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${o.unit}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(o.mode)} · {o.freshness} ·{" "}
                      {String(o.sourceQuality)}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {o.observedAt ?? "No observation time"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No component-specific measurements are linked. Parent
                  equipment values are not assigned to this component.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a component in the viewer or assembly tree.
          </p>
        )}
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-4">
      {!section && (
        <>
          {" "}
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{w.name}</h2>
            <Badge variant="outline">
              {w.kind === "simulated"
                ? "Simulated equipment"
                : "Real equipment"}
            </Badge>
            {w.isDemo && (
              <Badge variant="outline">Read-only demonstration</Badge>
            )}
          </div>
          <p className="break-all text-xs text-muted-foreground">
            {w.serialNumber} · instance {w.id} · local revision {w.version}
          </p>
        </>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Observation stream
        <select
          className="h-10 min-w-0 flex-1 rounded border border-input bg-background px-2 sm:flex-none"
          value={stream ?? w.stream}
          onChange={(e) => {
            setStream(e.target.value as "live" | "simulated");
            setReplayAt(null);
          }}
        >
          <option value="live">Explicit live evidence</option>
          <option value="simulated">Explicitly simulated source</option>
        </select>
      </label>
      {!wide && (
        <div className="flex gap-2">
          <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
            <SheetTrigger asChild>
              <Button variant="outline">Assembly / BOM</Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[65dvh] overflow-y-auto"
            >
              <SheetHeader>
                <SheetTitle>Assembly and components</SheetTitle>
                <SheetDescription>
                  Select a component; close this panel to inspect it in the
                  viewer.
                </SheetDescription>
              </SheetHeader>
              {tree}
            </SheetContent>
          </Sheet>
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetTrigger asChild>
              <Button variant="outline">Component details</Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[65dvh] overflow-y-auto"
            >
              <SheetHeader>
                <SheetTitle>Component inspector</SheetTitle>
                <SheetDescription>
                  Identity and explicitly linked evidence for the selected
                  component.
                </SheetDescription>
              </SheetHeader>
              {inspector}
            </SheetContent>
          </Sheet>
        </div>
      )}
      <div
        className={`grid items-start gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_16rem] ${section === "observations" ? "hidden" : ""}`}
      >
        {wide && tree}
        <Card className="min-w-0 py-3">
          {!section && (
            <CardHeader className="py-1">
              <CardTitle className="text-sm">3D inspection</CardTitle>
            </CardHeader>
          )}
          <CardContent className="space-y-3 px-3 sm:px-4">
            <Suspense
              fallback={<ModelLoadingPreview revision={w.templateRevision} />}
            >
              <LocalEquipmentRenderer
                ref={renderer}
                modelUrl={w.modelUrl}
                modelRevision={w.templateRevision}
                initialViewDirection={w.renderer.initialViewDirection}
                components={w.components}
                selected={selected}
                onSelect={setSelected}
                focusComponentId={
                  linkedFinding.data?.equipmentId === id
                    ? linkedFinding.data.componentId
                    : undefined
                }
                securityFindings={
                  securityOverlay ? security.data?.mapped : undefined
                }
                observations={activeObservations}
                annotations={w.annotations}
              />
            </Suspense>
            {securityAccess.data?.enabled && (
              <div className="space-y-2 rounded border p-3 text-sm">
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    aria-label="Equipment security overlay"
                    checked={securityOverlay}
                    onChange={(e) => setSecurityOverlay(e.target.checked)}
                  />
                  Security overlay · explicit component mappings only
                </label>
                {securityOverlay && (
                  <>
                    <p>
                      Blue rings identify mapped security findings for review.
                      Process alarms keep their own markers. No compromise is
                      inferred from a shared asset label.
                    </p>
                    {security.error ? (
                      <p>
                        Security evidence is unavailable; the equipment viewer
                        remains operational.
                      </p>
                    ) : security.data?.mapped.length ? (
                      security.data.mapped.map((f) => (
                        <div key={f.id} className="flex flex-wrap gap-2">
                          <a
                            className="text-primary underline"
                            href={`#/cybersecurity?finding=${f.id}`}
                          >
                            {f.title} · {f.mode}
                          </a>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelected(f.componentId)}
                          >
                            Select mapped component
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p>
                        No explicit component findings. Review unbound security
                        findings in the list workspace.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-sm">
              <a
                className="text-primary underline"
                href={w.modelUrl}
                download="equipment.glb"
              >
                Download local GLB
              </a>
              {w.documentUrl ? (
                <a
                  className="text-primary underline"
                  href={w.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open local maintenance document
                </a>
              ) : (
                <span>No associated maintenance document</span>
              )}
            </div>
            <p className="break-all text-xs text-muted-foreground">
              Model revision: {w.templateRevision} · illustrative geometry, not
              validated CAD or robot planning data
            </p>
          </CardContent>
        </Card>
        {wide && inspector}
      </div>
      {replayAt && (
        <p role="status" className="rounded border p-3 text-sm">
          History replay: {replayAt}{" "}
          <Button variant="outline" size="sm" onClick={() => setReplayAt(null)}>
            Return to latest
          </Button>
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border p-3 text-sm">
          {notice}
        </p>
      )}
      {section === "observations" && (
        <label className="block text-sm">
          Observation component
          <select
            aria-label="Observation component"
            className="ml-2 max-w-full rounded border bg-background p-2"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value || null)}
          >
            <option value="">Select a component</option>
            {w.components.map((c) => (
              <option
                key={c.installedComponentId}
                value={c.installedComponentId}
              >
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(!section || section === "observations") && (
        <Card>
          <CardHeader>
            <CardTitle>
              {component?.name ?? "Select component"} · observations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {component ? (
              <p className="break-all text-xs text-muted-foreground">
                {component.designation} · quantity {component.quantity ?? 1} ·{" "}
                {component.material}
                <br />
                {component.description}
                <br />
                Template component: {component.templateComponentId}
                <br />
                Installed component: {component.installedComponentId}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a component in the model or BOM to inspect its details.
              </p>
            )}
            {observations.length ? (
              observations.map((o) => (
                <div
                  key={o.metric}
                  className="flex flex-wrap justify-between gap-2 rounded border p-3 text-sm"
                >
                  <span>{o.metric}</span>
                  <strong>
                    {o.value == null
                      ? "Unavailable"
                      : `${Number(o.value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${o.unit}`}
                  </strong>
                  <span>
                    {String(o.mode)} · {o.freshness} · quality{" "}
                    {String(o.sourceQuality)}
                  </span>
                  {o.alarmActive && (
                    <Badge variant="destructive">
                      Source alarm active · {String(o.mode)}
                    </Badge>
                  )}
                  {o.conversion && (
                    <span className="w-full text-xs text-muted-foreground">
                      Source {o.rawValue} {o.sourceUnit} · conversion ×{" "}
                      {o.conversion.factor}
                    </span>
                  )}
                  <time className="w-full text-xs text-muted-foreground">
                    {o.observedAt ?? "No observation"}
                  </time>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No metric binding for this component. Select a component with an
                explicit source binding. Missing data is unavailable.
              </p>
            )}
            {canEdit && w.kind === "simulated" && w.observations.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  Run local simulated scenario
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["normal", "alarm", "recovery", "stale"] as const).map(
                    (s) => (
                      <Button
                        key={s}
                        variant="outline"
                        disabled={scenario.isPending}
                        onClick={() => scenario.mutate({ id, scenario: s })}
                      >
                        {s[0].toUpperCase() + s.slice(1)}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {(!section || section === "views") && (
        <Card>
          <CardHeader>
            <CardTitle>Local notes and selected component</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {notes.map((a) => (
              <p
                key={a.id}
                className="whitespace-pre-wrap rounded border p-3 text-sm"
              >
                {a.text}
              </p>
            ))}
            {canEdit ? (
              <>
                <label className="text-sm" htmlFor="equipment-note">
                  {component
                    ? `Note for ${component.name}`
                    : "Select a component to add a note"}
                </label>
                <Textarea
                  id="equipment-note"
                  disabled={!component}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                />
                <Button
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      id,
                      expectedVersion: w.version,
                      selectedComponent: selected,
                      annotations:
                        note.trim() && selected
                          ? [
                              ...w.annotations,
                              {
                                id: crypto.randomUUID(),
                                componentId: selected,
                                text: note.trim(),
                              },
                            ]
                          : w.annotations,
                      viewpoints: w.viewpoints,
                    })
                  }
                >
                  Save local work
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Public demonstration work is read-only.
              </p>
            )}
            <div className="space-y-2">
              {w.viewpoints.map((v) => (
                <Button
                  key={v.id}
                  variant="outline"
                  onClick={() => renderer.current?.restore(v)}
                >
                  Open viewpoint: {v.name}
                </Button>
              ))}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    aria-label="Viewpoint name"
                    className="sm:max-w-xs"
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    placeholder="Viewpoint name"
                    maxLength={80}
                  />
                  <Button
                    variant="outline"
                    disabled={save.isPending || !viewName.trim()}
                    onClick={() => {
                      const v = renderer.current?.capture();
                      if (v)
                        save.mutate({
                          id,
                          expectedVersion: w.version,
                          selectedComponent: selected,
                          annotations: w.annotations,
                          viewpoints: [
                            ...w.viewpoints,
                            {
                              ...v,
                              id: crypto.randomUUID(),
                              name: viewName.trim(),
                            },
                          ],
                        });
                    }}
                  >
                    Save viewpoint
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {canEdit && (
        <Suspense fallback={<p role="status">Loading model tools…</p>}>
          <ModelReplacement id={id} version={w.version} />
        </Suspense>
      )}
      {(!section || section === "observations") && (
        <details className="rounded border p-4">
          <summary className="cursor-pointer font-medium">
            Classified local history
          </summary>
          <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {w.history
              .filter((o) => o.componentId === selected)
              .map((o, i) => (
                <div key={i} className="rounded border p-2 text-xs">
                  <strong>
                    {o.metric}:{" "}
                    {o.value == null
                      ? "Unavailable"
                      : `${Number(o.value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${o.unit}`}
                  </strong>
                  <p>
                    {o.observedAt} · {String(o.mode)} · quality{" "}
                    {String(o.sourceQuality)}
                  </p>
                  <p className="break-all">
                    Run: {String(o.scenarioRunId ?? o.replayRunId ?? "none")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReplayAt(o.observedAt)}
                  >
                    Replay this observation time
                  </Button>
                </div>
              ))}
            {!w.history.length && (
              <p className="text-sm text-muted-foreground">
                No local history yet.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
