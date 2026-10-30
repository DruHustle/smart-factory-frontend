import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  Save,
  Download,
  Trash2,
  CopyPlus,
  LayoutTemplate,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoSandbox } from "@/lib/demo-sandbox";
import { sandboxInventory } from "@shared/demo-sandbox";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/workspace/Primitives";
import { FactoryFloor } from "@/components/workspace/FactoryFloor";
import {
  factoryLayoutDocument,
  layoutFromInventory,
  type FactoryLayoutDocument,
} from "@shared/factory-layout";

type Draft = {
  key: string;
  document: FactoryLayoutDocument;
  sourceId?: string;
  version: number;
  updatedAt: string;
};
const fresh = (): Draft => ({
  key: crypto.randomUUID(),
  document: {
    name: "My factory",
    width: 40,
    depth: 30,
    zones: [],
    placements: [],
  },
  version: 0,
  updatedAt: new Date().toISOString(),
});
function drafts(key: string): Draft[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 4000000) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(0, 50).flatMap((v) => {
      const doc = factoryLayoutDocument.safeParse(v?.document);
      return doc.success && typeof v.key === "string" && v.key.length < 100
        ? [
            {
              ...v,
              document: doc.data,
              version: Number.isSafeInteger(v.version) ? v.version : 0,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

export default function FactoryLayouts() {
  const { user } = useAuth();
  const key = user?.access?.demoOnly
    ? "demo-visitor"
    : `${user?.id ?? "anonymous"}:${user?.access?.workspaceView ?? "configured"}`;
  return <FactoryLayoutsEditor key={key} />;
}
function FactoryLayoutsEditor() {
  const { user } = useAuth(),
    demo = !!user?.access?.demoOnly;
  const sandbox = useDemoSandbox();
  const storageKey = demo
    ? "smart-factory:layout-drafts:v1:demo-visitor"
    : `smart-factory:layout-drafts:v1:${user?.id ?? "anonymous"}:${user?.access?.workspaceView ?? "configured"}`;
  const initial = useMemo(() => drafts(storageKey), [storageKey]);
  const [draft, setDraft] = useState<Draft>(() => initial[0] ?? fresh());
  const [local, setLocal] = useState(initial),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [opening, setOpening] = useState(false);
  const openRequest = useRef(0);
  const cancelOpen = () => {
    openRequest.current++;
    setOpening(false);
  };
  const localRef = useRef(local);
  localRef.current = local;
  const floor = trpc.factory.floor.useQuery({ zone: "" }, { staleTime: 30000 });
  const owned = trpc.factoryLayouts.list.useQuery(
    { archived },
    { enabled: !!user && !demo, staleTime: 30000, retry: false },
  );
  const utils = trpc.useUtils();
  const save = trpc.factoryLayouts.save.useMutation({
    onSuccess: async () => {
      await utils.factoryLayouts.list.invalidate();
      toast.success("Layout saved to your account");
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = trpc.factoryLayouts.archive.useMutation({
    onSuccess: async () => {
      await utils.factoryLayouts.list.invalidate();
      toast.success("Layout archive updated");
    },
    onError: (e) => toast.error(e.message),
  });
  useEffect(() => {
    const valid = factoryLayoutDocument.safeParse(draft.document);
    if (!valid.success) return;
    const next = [
      { ...draft, document: valid.data, updatedAt: new Date().toISOString() },
      ...localRef.current.filter((d) => d.key !== draft.key),
    ];
    if (next.length > 50) {
      setStorageError(true);
      return;
    }
    setLocal(next);
  }, [draft, storageKey]);
  useEffect(() => {
    try {
      const raw = JSON.stringify(local);
      if (raw.length > 4000000) throw Error("Browser draft capacity reached");
      localStorage.setItem(storageKey, raw);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [local, storageKey]);
  const update = (document: FactoryLayoutDocument) => {
    cancelOpen();
    setDraft((d) => ({ ...d, document }));
  };
  const hasDraftRoom = () => {
    if (localRef.current.length < 50) return true;
    toast.error(
      "This browser has 50 drafts. Download and remove a draft before starting another.",
    );
    return false;
  };
  const activate = (next: Draft) => {
    cancelOpen();
    setDraft(next);
    setSelected(null);
  };
  const removeDraft = (removed: Draft) => {
    cancelOpen();
    const next = localRef.current.filter((d) => d.key !== removed.key);
    setLocal(next);
    if (draft.key === removed.key) {
      setDraft(next[0] ?? fresh());
      setSelected(null);
    }
    toast.success("Browser draft removed. Account saves are retained.", {
      action: {
        label: "Undo",
        onClick: () => {
          if (!hasDraftRoom()) return;
          setLocal((current) => [
            removed,
            ...current.filter((d) => d.key !== removed.key),
          ]);
          activate(removed);
        },
      },
    });
  };
  const items = useMemo(
      () =>
        demo && sandbox ? sandboxInventory(sandbox) : (floor.data?.items ?? []),
      [demo, sandbox, floor.data],
    ),
    byRef = new Map(items.map((i) => [i.ref, i]));
  const placements = new Map(draft.document.placements.map((p) => [p.ref, p]));
  const placed = items
    .filter((i) => placements.has(i.ref))
    .map((i) => ({
      ...i,
      zone:
        draft.document.zones.find((z) => z.id === placements.get(i.ref)?.zoneId)
          ?.name ?? "Unassigned",
    }));
  const active = selected ? placements.get(selected) : undefined;
  const valid = factoryLayoutDocument.safeParse(draft.document);
  const place = (ref: string) => {
    if (placements.has(ref)) return;
    update({
      ...draft.document,
      placements: [
        ...draft.document.placements,
        { ref, x: 0, z: 0, rotation: 0, zoneId: null },
      ],
    });
    setSelected(ref);
  };
  const move = (ref: string, x: number, z: number) =>
    update({
      ...draft.document,
      placements: draft.document.placements.map((p) =>
        p.ref === ref
          ? {
              ...p,
              x,
              z,
              zoneId:
                draft.document.zones.find(
                  (a) =>
                    x >= a.x &&
                    x <= a.x + a.width &&
                    z >= a.z &&
                    z <= a.z + a.depth,
                )?.id ?? null,
            }
          : p,
      ),
    });
  const resize = (width: number, depth: number) => {
    if (!Number.isFinite(width) || !Number.isFinite(depth)) return;
    const w = Math.max(4, Math.min(1000, width)),
      d = Math.max(4, Math.min(1000, depth)),
      sx = w / draft.document.width,
      sz = d / draft.document.depth;
    update({
      ...draft.document,
      width: w,
      depth: d,
      zones: draft.document.zones.map((a) => ({
        ...a,
        x: a.x * sx,
        z: a.z * sz,
        width: a.width * sx,
        depth: a.depth * sz,
      })),
      placements: draft.document.placements.map((p) => ({
        ...p,
        x: p.x * sx,
        z: p.z * sz,
      })),
    });
  };
  const openSaved = async (id: string) => {
    const request = ++openRequest.current;
    const fromArchive = archived;
    setOpening(true);
    try {
      const result = await utils.factoryLayouts.get.fetch(
        { id },
        { staleTime: 0 },
      );
      if (request !== openRequest.current) return;
      const existing = localRef.current.find((d) => d.sourceId === id);
      if (!existing && !hasDraftRoom()) return;
      setDraft({
        key: existing?.key ?? crypto.randomUUID(),
        document: result.document,
        sourceId: fromArchive ? undefined : result.id,
        version: fromArchive ? 0 : result.version,
        updatedAt: result.updatedAt,
      });
      setSelected(null);
      if (result.omittedItems)
        toast.info(
          `${result.omittedItems} items are unavailable in this workspace and are omitted from this view.`,
        );
    } catch (e) {
      if (request === openRequest.current)
        toast.error(e instanceof Error ? e.message : "Layout unavailable");
    } finally {
      if (request === openRequest.current) setOpening(false);
    }
  };
  const persist = () => {
    if (!valid.success) {
      toast.error(valid.error.issues[0]?.message ?? "Review the layout fields");
      return;
    }
    if (demo) {
      if (storageError)
        toast.error(
          "Browser storage is unavailable. Download this layout to retain a copy.",
        );
      else toast.success("Demo layout saved in this browser");
    } else {
      const submittedKey = draft.key;
      save.mutate(
        {
          id: draft.sourceId,
          expectedVersion: draft.sourceId ? draft.version : 0,
          document: valid.data,
        },
        {
          onSuccess: (result) => {
            // Acknowledgements belong to the submitted draft. Keep edits made while saving.
            const acknowledge = (d: Draft) =>
              d.key === submittedKey
                ? { ...d, sourceId: result.id, version: result.version }
                : d;
            setLocal((current) => current.map(acknowledge));
            setDraft(acknowledge);
          },
        },
      );
    }
  };
  const download = () => {
    if (!valid.success) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(valid.data, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "factory-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  if (floor.isLoading) return <EmptyState title="Loading factory inventory…" />;
  if (floor.error)
    return (
      <EmptyState
        title="Factory inventory unavailable"
        description={floor.error.message}
        error
      />
    );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Factory layouts"
        description="Design a floor, define zones and place your equipment."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-label="New layout"
          title="New layout"
          onClick={() => {
            if (hasDraftRoom()) activate(fresh());
          }}
        >
          <Plus className="mr-2 size-4" />
          New
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Use current factory arrangement"
          title="Use current factory arrangement"
          onClick={() => {
            update(layoutFromInventory(items));
            setSelected(null);
          }}
        >
          <LayoutTemplate className="size-4" />
        </Button>
        <Button
          aria-label={demo ? "Save demo layout" : "Save layout"}
          title={
            demo ? "Save layout in this browser" : "Save layout to your account"
          }
          aria-busy={save.isPending}
          onClick={persist}
          disabled={save.isPending || opening || !valid.success}
        >
          <Save className="mr-2 size-4" />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {!demo && draft.sourceId && (
          <Button
            variant="outline"
            size="icon"
            aria-label="Save as new layout"
            title="Save as new layout"
            onClick={() => {
              if (hasDraftRoom())
                activate({
                  ...draft,
                  sourceId: undefined,
                  version: 0,
                  key: crypto.randomUUID(),
                });
            }}
          >
            <CopyPlus className="size-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label="Download layout"
          title="Download layout"
          onClick={download}
          disabled={!valid.success}
        >
          <Download className="size-4" />
        </Button>
        <Button asChild variant="ghost" size="icon">
          <Link href="/" aria-label="Factory overview" title="Factory overview">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
      </div>
      <p className="rounded-md border bg-muted/30 p-3 text-sm">
        {demo
          ? "Demo design workspace. Create, rearrange and reopen layouts in this browser using simulated inventory."
          : "Layouts are private to your account. Draft edits are retained in this browser; Save layout stores a version in your account."}{" "}
        Equipment footprints are illustrative; the layout does not operate
        machinery.
      </p>
      {storageError && (
        <p
          role="alert"
          className="rounded-md border border-warning p-3 text-sm"
        >
          This browser cannot retain the draft. Download a copy
          {!demo ? " or save to your account" : ""} before leaving.
        </p>
      )}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          className="order-2 min-w-0 space-y-4 lg:order-1"
          aria-label="Layout editor"
        >
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Floor</h2>
            <label className="block text-sm">
              Layout name
              <input
                aria-label="Layout name"
                className="workspace-control mt-1 w-full"
                maxLength={120}
                value={draft.document.name}
                onChange={(e) =>
                  update({ ...draft.document, name: e.target.value })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                Width (m)
                <input
                  key={draft.key + "width" + draft.document.width}
                  aria-label="Floor width in metres"
                  type="number"
                  min={4}
                  max={1000}
                  className="workspace-control mt-1 w-full"
                  defaultValue={draft.document.width}
                  onBlur={(e) =>
                    resize(Number(e.target.value), draft.document.depth)
                  }
                />
              </label>
              <label className="text-xs">
                Depth (m)
                <input
                  key={draft.key + "depth" + draft.document.depth}
                  aria-label="Floor depth in metres"
                  type="number"
                  min={4}
                  max={1000}
                  className="workspace-control mt-1 w-full"
                  defaultValue={draft.document.depth}
                  onBlur={(e) =>
                    resize(draft.document.width, Number(e.target.value))
                  }
                />
              </label>
            </div>
            <h3 className="pt-2 text-sm font-medium">Zones</h3>
            <Button
              variant="outline"
              size="sm"
              disabled={draft.document.zones.length >= 100}
              onClick={() => {
                const w = Math.min(10, draft.document.width),
                  d = Math.min(8, draft.document.depth);
                update({
                  ...draft.document,
                  zones: [
                    ...draft.document.zones,
                    {
                      id: crypto.randomUUID(),
                      name: `Zone ${draft.document.zones.length + 1}`,
                      x: -w / 2,
                      z: -d / 2,
                      width: w,
                      depth: d,
                    },
                  ],
                });
              }}
            >
              Add zone
            </Button>
            {draft.document.zones.map((zone, index) => (
              <fieldset
                key={zone.id}
                className="space-y-2 rounded-md border p-2"
              >
                <legend className="px-1 text-xs">{zone.name}</legend>
                <input
                  className="workspace-control w-full"
                  aria-label={`Zone ${index + 1} name`}
                  maxLength={80}
                  value={zone.name}
                  onChange={(e) =>
                    update({
                      ...draft.document,
                      zones: draft.document.zones.map((a) =>
                        a.id === zone.id ? { ...a, name: e.target.value } : a,
                      ),
                    })
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["x", "Left (m)", zone.x + draft.document.width / 2],
                      ["z", "Top (m)", zone.z + draft.document.depth / 2],
                      ["width", "Width (m)", zone.width],
                      ["depth", "Depth (m)", zone.depth],
                    ] as const
                  ).map(([field, label, value]) => (
                    <label key={field} className="text-xs">
                      {label}
                      <input
                        key={`${draft.key}:${zone.id}:${field}:${value}`}
                        aria-label={`${zone.name} ${label}`}
                        type="number"
                        step="0.5"
                        className="workspace-control mt-1 w-full"
                        defaultValue={Number(value.toFixed(2))}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const a = {
                            ...zone,
                            [field]:
                              field === "x"
                                ? n - draft.document.width / 2
                                : field === "z"
                                  ? n - draft.document.depth / 2
                                  : n,
                          };
                          a.width = Math.max(
                            1,
                            Math.min(draft.document.width, a.width),
                          );
                          a.depth = Math.max(
                            1,
                            Math.min(draft.document.depth, a.depth),
                          );
                          a.x = Math.max(
                            -draft.document.width / 2,
                            Math.min(draft.document.width / 2 - a.width, a.x),
                          );
                          a.z = Math.max(
                            -draft.document.depth / 2,
                            Math.min(draft.document.depth / 2 - a.depth, a.z),
                          );
                          update({
                            ...draft.document,
                            zones: draft.document.zones.map((v) =>
                              v.id === a.id ? a : v,
                            ),
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      ...draft.document,
                      zones: draft.document.zones.filter(
                        (a) => a.id !== zone.id,
                      ),
                      placements: draft.document.placements.map((p) =>
                        p.zoneId === zone.id ? { ...p, zoneId: null } : p,
                      ),
                    })
                  }
                >
                  Remove zone
                </Button>
              </fieldset>
            ))}
          </section>
          <section
            className="space-y-2 rounded-lg border bg-card p-4"
            aria-label="Equipment palette"
          >
            <h2 className="font-semibold">
              Equipment · {placed.length} placed / {items.length} available
            </h2>
            {placed.length < draft.document.placements.length && (
              <p className="text-sm text-muted-foreground">
                {draft.document.placements.length - placed.length} saved items
                are unavailable in this workspace. They remain in your draft;
                reset demo equipment can be placed again.
              </p>
            )}
            <input
              aria-label="Find equipment to place"
              className="workspace-control w-full"
              placeholder="Find equipment…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {items
                .filter((i) =>
                  `${i.name} ${i.identifier}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <li key={i.ref}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 h-auto w-full justify-start whitespace-normal text-left"
                      onClick={() =>
                        placements.has(i.ref)
                          ? setSelected(i.ref)
                          : place(i.ref)
                      }
                      aria-label={`${placements.has(i.ref) ? "Select placed" : "Place"} ${i.name} (${i.kind})`}
                    >
                      {i.name} · {i.kind}
                      {placements.has(i.ref) ? " · Placed" : ""}
                    </Button>
                  </li>
                ))}
            </ul>
            {active && (
              <div className="space-y-2 rounded-md bg-muted/30 p-2">
                <p className="text-sm font-medium">
                  {byRef.get(active.ref)?.name ?? "Selected item"}
                </p>
                <label className="block text-xs">
                  Rotation (degrees)
                  <input
                    key={`${draft.key}:${active.ref}:${active.rotation}`}
                    aria-label="Selected item rotation"
                    type="number"
                    min={0}
                    max={360}
                    defaultValue={active.rotation}
                    className="workspace-control mt-1 w-full"
                    onBlur={(e) => {
                      const rotation = Number(e.target.value);
                      if (!Number.isFinite(rotation)) return;
                      update({
                        ...draft.document,
                        placements: draft.document.placements.map((p) =>
                          p.ref === active.ref
                            ? { ...p, rotation: ((rotation % 360) + 360) % 360 }
                            : p,
                        ),
                      });
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    update({
                      ...draft.document,
                      placements: draft.document.placements.filter(
                        (p) => p.ref !== active.ref,
                      ),
                    });
                    setSelected(null);
                  }}
                >
                  Remove from layout
                </Button>
              </div>
            )}
          </section>
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Browser drafts</h2>
            <ul className="space-y-1">
              {local.map((d) => (
                <li key={d.key} className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={d.key === draft.key ? "secondary" : "ghost"}
                    className="h-auto min-h-11 min-w-0 flex-1 shrink justify-start whitespace-normal text-left [overflow-wrap:anywhere]"
                    onClick={() => {
                      activate(d);
                    }}
                  >
                    {d.document.name} · {d.document.placements.length} items
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={save.isPending}
                    aria-label={`Remove browser draft ${d.document.name}`}
                    onClick={() => removeDraft(d)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
          {!demo && (
            <section className="space-y-2 rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Saved to your account</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />
                Show archived
              </label>
              {owned.error ? (
                <p role="alert">{owned.error.message}</p>
              ) : owned.isLoading ? (
                <p>Loading layouts…</p>
              ) : !owned.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No saved layouts yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {owned.data.map((d) => (
                    <li key={d.id} className="rounded-md border p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto min-h-11 w-full justify-start whitespace-normal"
                        disabled={save.isPending || archive.isPending}
                        onClick={() => void openSaved(d.id)}
                      >
                        {d.name} · v{d.version}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          archive.isPending || save.isPending || opening
                        }
                        onClick={() =>
                          archive.mutate({
                            id: d.id,
                            expectedVersion: d.version,
                            archived: !archived,
                          })
                        }
                      >
                        {archived ? "Restore layout" : "Archive layout"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
        <section
          className="order-1 min-w-0 space-y-3 lg:order-2"
          aria-label="Layout canvas"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {draft.document.name || "Untitled layout"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {draft.document.width} × {draft.document.depth} m ·{" "}
              {draft.document.placements.length} placed
            </p>
          </div>
          {!valid.success ? (
            <EmptyState
              title="Review layout fields"
              description={valid.error.issues[0]?.message}
            />
          ) : (
            <FactoryFloor
              key={draft.key}
              items={placed}
              links={floor.data?.links ?? []}
              selected={selected}
              onSelect={(ref) => setSelected(ref || null)}
              returnTo="/layouts"
              demo={demo}
              layoutDocument={valid.data}
              onLayoutMove={move}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Grab equipment to move it; its connection lines follow. Grab empty
            floor to move the view, and release to drop. Floor size and zones
            describe this drawing, while source records retain their original
            identities and evidence.
          </p>
        </section>
      </div>
    </div>
  );
}
