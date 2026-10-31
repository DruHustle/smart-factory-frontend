import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { useFactorySelection } from "./factory-selection";
import {
  useDemoSandbox,
  startDemoSandbox,
  changeDemoFactory,
} from "./demo-sandbox";
import {
  sandboxInventory,
  type DemoSandbox,
  type SandboxRole,
} from "@shared/demo-sandbox";
import {
  namedFactoryDraft,
  type NamedFactory,
  type NamedFactoryDraft,
  type NewFactoryItem,
  type PhysicalDimensions,
  type NamedFactorySummary,
} from "@shared/named-factory";

const draftOf = (factory: NamedFactory): NamedFactoryDraft => ({
  document: factory.document,
  dimensions: factory.dimensions,
  tags: factory.tags,
});
export function factoryDraftFingerprint(value: NamedFactoryDraft) {
  return JSON.stringify({
    document: {
      ...value.document,
      placements: [...value.document.placements].sort((a, b) =>
        a.ref.localeCompare(b.ref),
      ),
    },
    dimensions: Object.fromEntries(Object.entries(value.dimensions).sort()),
    tags: Object.fromEntries(Object.entries(value.tags).sort()),
  });
}
export function demoFactorySnapshot(
  state: DemoSandbox,
  id: string,
): NamedFactory | undefined {
  const factory = state.factories.find((f) => f.id === id);
  if (!factory) return;
  const refs = new Set(factory.draft.document.placements.map((p) => p.ref));
  const items = sandboxInventory(state)
    .filter((item) => refs.has(item.ref))
    .map((item) => ({
      ...item,
      factoryId: id,
      factoryTag: factory.draft.tags[item.ref],
    }));
  return {
    id,
    name: factory.draft.document.name,
    width: factory.draft.document.width,
    depth: factory.draft.document.depth,
    version: factory.version,
    updatedAt: factory.updatedAt,
    ...factory.draft,
    items,
    total: items.length,
    unavailableItems: 0,
  };
}
export function useFactoryDirectory() {
  const { user } = useAuth(),
    selection = useFactorySelection(),
    state = useDemoSandbox(),
    utils = trpc.useUtils();
  const role: SandboxRole =
    user?.role === "admin" ||
    user?.role === "engineer" ||
    user?.role === "operator"
      ? user.role
      : "viewer";
  const canEdit = selection.demo
    ? ["engineer", "admin"].includes(role)
    : !!user?.access?.canEngineer;
  const canDelete = selection.demo
    ? role === "admin"
    : !!user?.access?.canAdminister;
  const list = trpc.factories.list.useQuery(undefined, {
    enabled: !!user && !selection.demo,
    staleTime: 30000,
    retry: false,
  });
  const reference = trpc.factory.floor.useQuery(
    { zone: "" },
    { enabled: !!user && selection.demo, staleTime: 60000 },
  );
  useEffect(() => {
    if (selection.demo && reference.data && !state) {
      const seeded = startDemoSandbox(reference.data.items);
      const bench = seeded.factories.find(
        (factory) => factory.draft.document.name === "Current Pi + DHT11 setup",
      );
      if (bench && !selection.id) selection.select(bench.id);
    }
  }, [selection.demo, reference.data, state]);
  const create = trpc.factories.create.useMutation();
  const factories: NamedFactorySummary[] = selection.demo
    ? (state?.factories ?? []).map((f) => ({
        id: f.id,
        name: f.draft.document.name,
        width: f.draft.document.width,
        depth: f.draft.document.depth,
        version: f.version,
        items: f.draft.document.placements.length,
        updatedAt: f.updatedAt,
      }))
    : Array.isArray(list.data)
      ? list.data
      : [];
  const createFactory = async (draft: NamedFactoryDraft) => {
    if (!canEdit)
      throw Error("Creating a factory requires Engineer or Admin access.");
    let result: NamedFactory;
    if (selection.demo) {
      const changed = await changeDemoFactory(role, {
        type: "factory.create",
        draft,
      });
      const old = new Set(changed.before.factories.map((f) => f.id));
      const added = changed.after.factories.find((f) => !old.has(f.id))!;
      result = demoFactorySnapshot(changed.after, added.id)!;
    } else {
      result = await create.mutateAsync(draft);
      utils.factories.get.setData({ id: result.id }, result);
      await utils.factories.list.invalidate();
    }
    selection.select(result.id);
    return result;
  };
  return {
    ...selection,
    user,
    role,
    canEdit,
    canDelete,
    state,
    factories,
    createFactory,
    referenceItems: reference.data?.items ?? [],
    loading: selection.demo ? !state && reference.isLoading : list.isLoading,
    error: selection.demo ? reference.error : list.error,
  };
}
const browserDraft = z
  .object({
    baseVersion: z.number().int().positive(),
    baseFingerprint: z.string().max(2000000),
    writer: z.string(),
    draft: namedFactoryDraft,
  })
  .strict();
type BrowserDraft = z.infer<typeof browserDraft>;
export function useNamedFactory(id: string) {
  const directory = useFactoryDirectory(),
    utils = trpc.useUtils(),
    documentActive = useDocumentActive();
  const [grabbing, setGrabbing] = useState(false);
  const query = trpc.factories.get.useQuery(
    { id },
    {
      enabled: !!directory.user && !directory.demo,
      staleTime: 30000,
      refetchInterval: documentActive && !grabbing ? 60000 : false,
      retry: false,
    },
  );
  const local = useMemo(
    () =>
      directory.demo && directory.state
        ? demoFactorySnapshot(directory.state, id)
        : undefined,
    [directory.demo, directory.state, id],
  );
  const factory = directory.demo ? local : query.data;
  const key =
    "smart-factory:named-factory-draft:v1:" + directory.scope + ":" + id;
  const writer = useRef(crypto.randomUUID());
  const [draft, setDraft] = useState<BrowserDraft | null>(null),
    draftRef = useRef<BrowserDraft | null>(null);
  const [storageError, setStorageError] = useState(""),
    recoveryRaw = useRef<string | null>(null),
    lastRaw = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false);
  const changeState = (next: BrowserDraft) => {
    draftRef.current = next;
    setDraft(next);
  };
  useEffect(() => {
    if (!factory) return;
    const current = draftRef.current;
    if (!current) {
      let stored: BrowserDraft | undefined;
      try {
        const raw = localStorage.getItem(key);
        lastRaw.current = raw;
        if (raw) {
          if (raw.length > 4000000) throw Error("Draft capacity exceeded");
          const parsed = browserDraft.safeParse(JSON.parse(raw));
          if (!parsed.success) throw Error("Saved draft is invalid");
          stored = parsed.data;
        }
      } catch {
        try {
          recoveryRaw.current = localStorage.getItem(key);
        } catch {}
        setStorageError(
          "The saved browser draft could not be loaded. Download it before replacing it.",
        );
      }
      changeState(
        stored ?? {
          baseVersion: factory.version,
          baseFingerprint: factoryDraftFingerprint(draftOf(factory)),
          writer: writer.current,
          draft: structuredClone(draftOf(factory)),
        },
      );
    } else if (
      factory.version > current.baseVersion &&
      !grabbing &&
      factoryDraftFingerprint(current.draft) === current.baseFingerprint
    ) {
      changeState({
        baseVersion: factory.version,
        baseFingerprint: factoryDraftFingerprint(draftOf(factory)),
        writer: writer.current,
        draft: structuredClone(draftOf(factory)),
      });
    }
  }, [factory, key, grabbing]);
  const dirty =
    !!draft && factoryDraftFingerprint(draft.draft) !== draft.baseFingerprint;
  useEffect(() => {
    if (!draft || recoveryRaw.current) return;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== lastRaw.current && stored !== null) {
        setStorageError(
          "Another tab has a different browser draft. Download your draft before reloading.",
        );
        return;
      }
      if (dirty) {
        const raw = JSON.stringify({ ...draft, writer: writer.current });
        if (raw.length > 4000000) throw Error("Draft capacity exceeded");
        localStorage.setItem(key, raw);
        lastRaw.current = raw;
      } else if (stored === lastRaw.current) {
        localStorage.removeItem(key);
        lastRaw.current = null;
      }
      setStorageError("");
    } catch {
      setStorageError(
        "This browser could not store your draft. Save to the factory or download it before leaving.",
      );
    }
  }, [draft, dirty, key]);
  const update = (next: NamedFactoryDraft) => {
    const current = draftRef.current;
    if (current && directory.canEdit)
      changeState({ ...current, writer: writer.current, draft: next });
  };
  const cached = (result: NamedFactory) => {
    if (!directory.demo) {
      utils.factories.get.setData({ id }, result);
      void utils.factories.list.invalidate();
      void utils.inventory.invalidate();
      void utils.factory.floor.invalidate();
      void utils.factories.activity.invalidate();
    }
  };
  const exclusive = async <T>(run: () => Promise<T>) => {
    if (busyRef.current)
      throw Error("Wait for the current factory operation to finish.");
    busyRef.current = true;
    setBusy(true);
    try {
      return await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const currentDraft = () => {
    if (!draftRef.current) throw Error("The factory is still loading.");
    return draftRef.current;
  };
  const saveMutation = trpc.factories.save.useMutation(),
    addMutation = trpc.factories.add.useMutation(),
    attachMutation = trpc.factories.attach.useMutation(),
    deleteMutation = trpc.factories.deleteItem.useMutation();
  const save = () =>
    exclusive(async () => {
      const submitted = currentDraft(),
        fingerprint = factoryDraftFingerprint(submitted.draft);
      let result: NamedFactory;
      if (directory.demo) {
        const changed = await changeDemoFactory(directory.role, {
          type: "factory.save",
          id,
          expectedVersion: submitted.baseVersion,
          draft: submitted.draft,
        });
        result = demoFactorySnapshot(changed.after, id)!;
      } else
        result = await saveMutation.mutateAsync({
          id,
          expectedVersion: submitted.baseVersion,
          draft: submitted.draft,
        });
      const current = currentDraft();
      changeState({
        baseVersion: result.version,
        baseFingerprint: factoryDraftFingerprint(draftOf(result)),
        writer: writer.current,
        draft:
          factoryDraftFingerprint(current.draft) === fingerprint
            ? structuredClone(draftOf(result))
            : current.draft,
      });
      cached(result);
      return result;
    });
  const reconcileInventory = (result: NamedFactory) => {
    const current = currentDraft(),
      old = new Map(current.draft.document.placements.map((p) => [p.ref, p]));
    const next: NamedFactoryDraft = {
      document: {
        ...current.draft.document,
        placements: result.document.placements.map((p) => old.get(p.ref) ?? p),
      },
      dimensions: Object.fromEntries(
        result.document.placements.map((p) => [
          p.ref,
          current.draft.dimensions[p.ref] ?? result.dimensions[p.ref],
        ]),
      ),
      tags: Object.fromEntries(
        result.document.placements.map((p) => [
          p.ref,
          current.draft.tags[p.ref] ?? result.tags[p.ref],
        ]),
      ),
    };
    changeState({
      baseVersion: result.version,
      baseFingerprint: factoryDraftFingerprint(draftOf(result)),
      writer: writer.current,
      draft: next,
    });
    cached(result);
  };
  const add = (item: NewFactoryItem) =>
    exclusive(async () => {
      const version = currentDraft().baseVersion;
      if (directory.demo) {
        const changed = await changeDemoFactory(directory.role, {
          type: "factory.add",
          id,
          expectedVersion: version,
          item,
        });
        const result = demoFactorySnapshot(changed.after, id)!;
        const old = new Set(
          changed.before.factories
            .find((f) => f.id === id)!
            .draft.document.placements.map((p) => p.ref),
        );
        const ref = result.document.placements.find(
          (p) => !old.has(p.ref),
        )!.ref;
        reconcileInventory(result);
        return ref;
      }
      const result = await addMutation.mutateAsync({
        id,
        expectedVersion: version,
        item,
      });
      reconcileInventory(result.factory);
      return result.ref;
    });
  const attach = (ref: string, dimensions: PhysicalDimensions, tag: string) =>
    exclusive(async () => {
      const version = currentDraft().baseVersion;
      if (directory.demo) {
        const changed = await changeDemoFactory(directory.role, {
          type: "factory.attach",
          id,
          expectedVersion: version,
          ref,
          dimensions,
          tag,
        });
        reconcileInventory(demoFactorySnapshot(changed.after, id)!);
        return ref;
      }
      const result = await attachMutation.mutateAsync({
        id,
        expectedVersion: version,
        ref,
        dimensions,
        tag,
      });
      reconcileInventory(result.factory);
      return result.ref;
    });
  const remove = (ref: string) =>
    exclusive(async () => {
      const version = currentDraft().baseVersion;
      if (directory.demo) {
        const changed = await changeDemoFactory(directory.role, {
          type: "factory.deleteItem",
          id,
          expectedVersion: version,
          ref,
        });
        reconcileInventory(demoFactorySnapshot(changed.after, id)!);
      } else {
        const result = await deleteMutation.mutateAsync({
          id,
          expectedVersion: version,
          ref,
        });
        reconcileInventory(result);
        return result.cleanupWarnings ?? [];
      }
      return [];
    });
  const reload = async () => {
    const current = directory.demo ? local : (await query.refetch()).data;
    if (!current) throw Error("The factory is unavailable.");
    try {
      localStorage.removeItem(key);
    } catch {}
    lastRaw.current = null;
    recoveryRaw.current = null;
    setStorageError("");
    changeState({
      baseVersion: current.version,
      baseFingerprint: factoryDraftFingerprint(draftOf(current)),
      writer: writer.current,
      draft: structuredClone(draftOf(current)),
    });
  };
  return {
    ...directory,
    factory,
    draft: draft?.draft,
    baseVersion: draft?.baseVersion,
    dirty,
    busy,
    storageError,
    conflict:
      !!factory && !!draft && factory.version > draft.baseVersion && dirty,
    validation: draft ? namedFactoryDraft.safeParse(draft.draft) : undefined,
    update,
    save,
    add,
    attach,
    remove,
    reload,
    setGrabbing,
    loadingFactory: directory.demo ? directory.loading : query.isLoading,
    factoryError: directory.demo ? undefined : query.error,
    recoveryRaw: recoveryRaw.current,
    refresh: () => (directory.demo ? Promise.resolve() : query.refetch()),
  };
}
