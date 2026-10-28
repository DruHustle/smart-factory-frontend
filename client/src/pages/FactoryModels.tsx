import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "wouter";
import { Box, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { referenceModels } from "@shared/factory-models";
import { loadEquipmentRenderer } from "@/components/equipment/loadRenderer";
import ModelLoadingPreview, {
  referencePreview,
} from "@/components/equipment/ModelLoadingPreview";
import { PageHeader, EmptyState } from "@/components/workspace/Primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
const Renderer = lazy(loadEquipmentRenderer);

export default function FactoryModels() {
  const [slug, setSlug] = useState("conveyor");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const utils = trpc.useUtils();
  const model = trpc.equipment.reference.useQuery(
    { slug },
    { staleTime: 60000 },
  );
  useEffect(() => {
    void loadEquipmentRenderer().catch(() => {});
  }, []);
  const descriptor = referenceModels.find((model) => model.slug === slug)!;
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Factory models"
        description="Explore factory equipment, materials and internal components in 3D."
        action={
          <Button asChild variant="outline">
            <Link href="/inventory">
              <ArrowLeft className="mr-2 size-4" />
              Assets & devices
            </Link>
          </Button>
        }
      />
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
        aria-label="Factory reference models"
      >
        {referenceModels.map((item) => (
          <button
            key={item.slug}
            type="button"
            aria-pressed={slug === item.slug}
            onPointerEnter={() => {
              void loadEquipmentRenderer().catch(() => {});
              void utils.equipment.reference.prefetch(
                { slug: item.slug },
                { staleTime: 60000 },
              );
            }}
            onFocus={() => {
              void loadEquipmentRenderer().catch(() => {});
              void utils.equipment.reference.prefetch(
                { slug: item.slug },
                { staleTime: 60000 },
              );
            }}
            onClick={() => {
              setSlug(item.slug);
              setSelected(null);
              setSearch("");
            }}
            className={`overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring ${slug === item.slug ? "border-primary ring-1 ring-primary" : "border-border"}`}
          >
            <div className="relative flex h-28 items-center justify-center bg-[#edf2f7] dark:bg-[#101a2a]">
              {referencePreview(item.revision) ? (
                <>
                  <img
                    src={referencePreview(item.revision)}
                    alt=""
                    className="h-full w-full object-contain dark:hidden"
                    loading="lazy"
                  />
                  <img
                    src={referencePreview(item.revision, true)}
                    alt=""
                    className="hidden h-full w-full object-contain dark:block"
                    loading="lazy"
                  />
                </>
              ) : (
                <Box className="size-12 text-info" strokeWidth={1} />
              )}
            </div>
            <span className="block px-3 py-2 text-sm font-medium">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      <section
        className="min-w-0 rounded-xl border bg-card p-3 sm:p-4"
        aria-label="Reference model inspection"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{descriptor.name}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {descriptor.description}
            </p>
          </div>
          <Badge variant="outline">Illustrative reference</Badge>
        </div>
        {model.isLoading ? (
          <ModelLoadingPreview revision={descriptor.revision} />
        ) : model.error || !model.data ? (
          <EmptyState
            error
            title="Reference model unavailable"
            description="The model catalogue could not be loaded."
            action={
              <Button variant="outline" onClick={() => void model.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
            <Suspense
              fallback={<ModelLoadingPreview revision={descriptor.revision} />}
            >
              <Renderer
                key={slug}
                modelUrl={model.data.modelUrl}
                modelRevision={model.data.revision}
                initialViewDirection={model.data.initialViewDirection}
                components={model.data.components}
                selected={selected}
                onSelect={setSelected}
                observations={[]}
                annotations={[]}
              />
            </Suspense>
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Components</h3>
                <Badge variant="secondary">
                  {model.data.components.length}
                </Badge>
              </div>
              <input
                aria-label="Search reference components"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a component…"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
              <div
                className="max-h-[28rem] space-y-1 overflow-y-auto"
                aria-label="Reference components"
              >
                {model.data.components
                  .filter((part) =>
                    part.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((part) => (
                    <button
                      key={part.installedComponentId}
                      type="button"
                      aria-pressed={selected === part.installedComponentId}
                      onClick={() => setSelected(part.installedComponentId)}
                      className={`block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${selected === part.installedComponentId ? "bg-info/10 text-info" : ""}`}
                    >
                      {part.name}
                    </button>
                  ))}
              </div>
            </aside>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Reference geometry supports visual inspection. Connect an installed
          asset through Assets & devices to view its recorded observations.
        </p>
      </section>
    </div>
  );
}
