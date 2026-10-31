import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "wouter";
import { Box, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { referenceModels } from "@shared/factory-models";
import { industrialAssets } from "@shared/industrial-assets";
import { loadEquipmentRenderer } from "@/components/equipment/loadRenderer";
import ModelLoadingPreview, { referencePreview } from "@/components/equipment/ModelLoadingPreview";
import IndustrialAssetInstall from "@/components/equipment/IndustrialAssetInstall";
import { PageHeader, EmptyState } from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
const Renderer = lazy(loadEquipmentRenderer);
const entries = [
  ...industrialAssets.map((asset) => ({ ...asset, revision: asset.models.compact.revision, provider: "NVIDIA" })),
  ...referenceModels.map((model) => ({ ...model, category: "Equipment", provider: "Smart Factory" })),
];

export default function FactoryModels() {
  const [slug, setSlug] = useState(industrialAssets[0]?.slug ?? "conveyor");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [librarySearch, setLibrarySearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [quality, setQuality] = useState<"compact" | "detail">("compact");
  const utils = trpc.useUtils();
  const industrial = industrialAssets.find((asset) => asset.slug === slug);
  const model = trpc.equipment.reference.useQuery(
    { slug: industrial ? "conveyor" : slug },
    { staleTime: 60000, enabled: !industrial },
  );
  useEffect(() => { void loadEquipmentRenderer().catch(() => {}); }, []);
  const descriptor = entries.find((item) => item.slug === slug)!;
  const converted = industrial?.models[quality];
  const data = converted ? {
    modelUrl: converted.url,
    revision: converted.revision,
    components: converted.manifest.components.map((part) => ({ ...part, installedComponentId: part.templateComponentId })),
    initialViewDirection: undefined,
  } : model.data;
  const filtered = entries.filter((item) =>
    (provider === "all" || item.provider === provider) &&
    `${item.name} ${item.description} ${item.category} ${item.provider}`.toLowerCase().includes(librarySearch.toLowerCase()),
  );
  return <div className="min-w-0 space-y-5">
    <PageHeader title="Factory models" description="Industrial 3D asset library · NVIDIA OpenUSD references and Smart Factory equipment."
      action={<Button asChild variant="outline"><Link href="/inventory"><ArrowLeft className="mr-2 size-4" />Assets & devices</Link></Button>} />
    <div className="flex flex-wrap gap-3">
      <input aria-label="Search factory models" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} placeholder="Search equipment, storage or material handling…" className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
      <select aria-label="Model provider" value={provider} onChange={(e) => setProvider(e.target.value)} className="h-10 max-w-full rounded-md border bg-background px-3 text-sm"><option value="all">All providers</option><option>NVIDIA</option><option>Smart Factory</option></select>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Factory reference models">
      {filtered.map((item) => <button key={item.slug} type="button" aria-label={item.name} aria-pressed={slug === item.slug}
        onPointerEnter={() => { void loadEquipmentRenderer().catch(() => {}); if (item.provider === "Smart Factory") void utils.equipment.reference.prefetch({ slug: item.slug }, { staleTime: 60000 }); }}
        onFocus={() => { void loadEquipmentRenderer().catch(() => {}); }}
        onClick={() => { setSlug(item.slug); setSelected(null); setSearch(""); setQuality("compact"); }}
        className={`overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring ${slug === item.slug ? "border-primary ring-1 ring-primary" : "border-border"}`}>
        <div className="relative flex h-28 items-center justify-center bg-[#edf2f7] dark:bg-[#101a2a]">
          {referencePreview(item.revision) ? <>
            <img src={referencePreview(item.revision)} alt="" className="h-full w-full object-contain dark:hidden" loading="lazy" />
            <img src={referencePreview(item.revision, true)} alt="" className="hidden h-full w-full object-contain dark:block" loading="lazy" />
          </> : <Box className="size-12 text-info" strokeWidth={1} />}
        </div>
        <span className="block px-3 pt-2 text-sm font-medium">{item.name}</span>
        <span className="block px-3 pb-2 text-xs text-muted-foreground">{item.provider} · {item.category}</span>
      </button>)}
    </div>
    {!filtered.length && <p role="status" className="text-sm text-muted-foreground">No models match these filters. The current inspection remains open.</p>}
    <section className="min-w-0 rounded-xl border bg-card p-3 sm:p-4" aria-label="Reference model inspection">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{descriptor.name}</h2><p className="max-w-2xl text-sm text-muted-foreground">{descriptor.description}</p></div>
        <Badge variant="outline">{industrial ? "NVIDIA · CC BY 4.0" : "Illustrative reference"}</Badge>
      </div>
      {converted && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label>Rendering quality <select aria-label="Rendering quality" value={quality} onChange={(e) => setQuality(e.target.value as "compact" | "detail")} className="ml-2 h-9 rounded-md border bg-background px-2"><option value="compact">Compact · fast loading</option><option value="detail">Detailed inspection</option></select></label>
        <span className="text-xs text-muted-foreground">{(converted.bytes / 1048576).toFixed(1)} MiB · {converted.triangles.toLocaleString()} triangles · static visualization</span>
      </div>}
      {!industrial && model.isLoading ? <ModelLoadingPreview revision={descriptor.revision} /> : !data || (!industrial && model.error) ?
        <EmptyState error title="Reference model unavailable" description="The model catalogue could not be loaded." action={<Button variant="outline" onClick={() => void model.refetch()}>Retry</Button>} /> :
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <Suspense fallback={<ModelLoadingPreview revision={data.revision} />}>
            <Renderer key={`${slug}:${quality}`} modelUrl={data.modelUrl} modelRevision={data.revision} initialViewDirection={data.initialViewDirection} components={data.components} selected={selected} onSelect={setSelected} observations={[]} annotations={[]} />
          </Suspense>
          <aside className="min-w-0 space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-medium">Components</h3><Badge variant="secondary">{data.components.length}</Badge></div>
            <input aria-label="Search reference components" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a component…" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
            <div className="max-h-[28rem] space-y-1 overflow-y-auto" aria-label="Reference components">
              {data.components.filter((part) => part.name.toLowerCase().includes(search.toLowerCase())).map((part) => <button key={part.installedComponentId} type="button" aria-pressed={selected === part.installedComponentId} onClick={() => setSelected(part.installedComponentId)} className={`block w-full break-words rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${selected === part.installedComponentId ? "bg-info/10 text-info" : ""}`}>{part.name}</button>)}
            </div>
          </aside>
        </div>}
      {industrial && converted && <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3" aria-label="Asset provenance and license">
        <p className="text-sm">{industrial.attribution}</p>
        <p className="text-xs text-muted-foreground">Adapted from OpenUSD to static GLB: geometry simplified and materials converted to browser PBR colors. Native textures, animation, articulation and physics are not transferred.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <a className="underline" href={industrial.sourceUrl} target="_blank" rel="noopener noreferrer">Pinned NVIDIA source</a>
          <a className="underline" href={industrial.licenseUrl} target="_blank" rel="noopener noreferrer">CC BY 4.0 license</a>
          <a className="underline" href={industrial.sourceReceiptUrl} target="_blank" rel="noopener noreferrer">Conversion provenance</a>
        </div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Conversion and simulation limitations</summary><div className="mt-2 space-y-1">{industrial.limitations.map((text) => <p key={text}>{text}</p>)}</div></details>
        <IndustrialAssetInstall key={converted.revision} model={converted} />
      </div>}
      <p className="mt-4 text-xs text-muted-foreground">Reference geometry supports visual inspection. Connect an installed asset through Assets & devices to view its recorded observations. Visual cuts and exploded spacing are not certified engineering drawings.</p>
    </section>
  </div>;
}
