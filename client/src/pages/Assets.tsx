import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { canViewEngineering } from "@/lib/access";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Layers, Pencil, Plus, RefreshCw, Search, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { CreateAssetDialog } from "@/components/CreateAssetDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { userFacingApiError } from "@/lib/errors";

const PAGE_SIZE = 25;

export default function Assets() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: assets, isLoading, isError, error, refetch } = trpc.assets.list.useQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<NonNullable<typeof assets>[number] | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [deletingAsset, setDeletingAsset] = useState<NonNullable<typeof assets>[number] | null>(null);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.assets.delete.useMutation({
    onSuccess: async ({ edgeSyncFailures }) => {
      toast.success(edgeSyncFailures.length ? "Asset deleted; one or more gateways need configuration resync" : "Asset deleted");
      setDeletingAsset(null);
      await utils.assets.list.invalidate();
    },
    onError: (mutationError) => toast.error(`Asset could not be deleted: ${mutationError.message}`),
  });

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return assets ?? [];
    return (assets ?? []).filter((asset) => [
      asset.name, asset.assetId, asset.assetType, asset.manufacturer, asset.model,
      asset.zone, asset.location, asset.lifecycleStage,
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [assets, search]);
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const pageAssets = filteredAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-[var(--workspace-gap)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Industrial Assets</h1>
          <p className="text-muted-foreground">Manage asset identity, AAS data, and connections.</p>
        </div>
        {canViewEngineering(user?.role) && <div className="flex flex-wrap gap-2">
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => window.location.assign("/api/assets/export/automationml")}><Download className="mr-2 h-4 w-4" />Export AutomationML</Button>
          <Button className="flex-1 sm:flex-none" onClick={() => { setEditingAsset(undefined); setCreateOpen(true); }}><Plus className="mr-2 h-4 w-4" />Create Asset</Button>
        </div>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search assets" className="pl-9" placeholder="Search name, asset ID, type, maker, or location" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        </div>
        {!isLoading && <p className="text-sm text-muted-foreground" aria-live="polite">{filteredAssets.length} asset{filteredAssets.length === 1 ? "" : "s"}{search && ` · ${assets?.length ?? 0} total`}</p>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div role="status" className="flex justify-center gap-3 py-12 text-sm text-muted-foreground"><RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />Loading industrial assets…</div>
          ) : isError ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center"><p className="text-sm text-destructive">Industrial assets could not be loaded. {userFacingApiError(error, "The application service is temporarily unavailable. Check your connection and try again.")}</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button></div>
          ) : pageAssets.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Asset</TableHead><TableHead>Type / manufacturer</TableHead><TableHead>Zone / location</TableHead><TableHead>Connection</TableHead><TableHead>Status</TableHead><TableHead>AAS</TableHead>
                  {canViewEngineering(user?.role) && <TableHead className="text-right">Actions</TableHead>}
                </TableRow></TableHeader>
                <TableBody>{pageAssets.map((asset) => <TableRow key={asset.id}>
                  <TableCell className="min-w-56">
                    <span className="font-medium">{asset.name}</span><a className="block text-xs text-primary underline" href={`#/cybersecurity?tab=Findings&targetKind=asset&targetId=${asset.id}`}>Cybersecurity posture</a>
                    <span className="block max-w-72 truncate font-mono text-xs text-muted-foreground" title={asset.assetId}>{asset.assetId}</span>
                  </TableCell>
                  <TableCell className="min-w-48">
                    <span className="capitalize">{asset.assetType.replaceAll("_", " ")}</span>
                    <span className="block max-w-60 truncate text-xs text-muted-foreground">{[asset.manufacturer, asset.model].filter(Boolean).join(" · ") || (asset.aasxImported ? "Not specified in imported AAS" : "Not set")}</span>
                  </TableCell>
                  <TableCell className="min-w-36">{asset.zone ?? "—"}<span className="block text-xs text-muted-foreground">{asset.location ?? "No location"}</span></TableCell>
                  <TableCell className="whitespace-nowrap"><Badge className={asset.connectionConfigured ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}>{asset.connectionConfigured ? "Connection configured" : "Not configured"}</Badge>{asset.connectionCount > 1 && <span className="mt-1 block text-xs text-muted-foreground">{asset.connectionCount} device connections</span>}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{asset.lifecycleStage}</Badge>{asset.isDemo && <span className="mt-1 block"><Badge variant="secondary">Simulated</Badge></span>}{asset.aasxImported && <span className="mt-1 block"><Badge variant="outline">AASX</Badge></span>}</TableCell>
                  <TableCell className="whitespace-nowrap">v{asset.aasVersion}</TableCell>
                  {canViewEngineering(user?.role) && <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {!asset.isDemo && !asset.aasxImported && <Button size="sm" variant="outline" aria-label={`Edit ${asset.name}`} onClick={() => { setEditingAsset(asset); setCreateOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</Button>}
                      <Button size="sm" aria-label={`Open ${asset.name}`} onClick={() => setLocation(`/assets/${asset.id}/aas`)}><Layers className="mr-2 h-4 w-4" />Open</Button>
                      {user?.role === "admin" && !asset.isDemo && <Button size="sm" variant="destructive" aria-label={`Delete ${asset.name}`} onClick={() => setDeletingAsset(asset)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
                    </div>
                  </TableCell>}
                </TableRow>)}</TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">{assets?.length ? "No assets match your search." : "No registered assets."}</div>
          )}
        </CardContent>
      </Card>

      {!isLoading && filteredAssets.length > PAGE_SIZE && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredAssets.length)} of {filteredAssets.length}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
          <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </div>}

      {canViewEngineering(user?.role) && <CreateAssetDialog key={editingAsset?.id ?? "new"} asset={editingAsset} open={createOpen} onOpenChange={setCreateOpen} />}
      <Dialog open={Boolean(deletingAsset)} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeletingAsset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete asset</DialogTitle><DialogDescription>
            Permanently remove {deletingAsset?.name} from the dashboard and BaSyx repository/registry? Historical telemetry and incident records are retained.
          </DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeletingAsset(null)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletingAsset && deleteMutation.mutate({ id: deletingAsset.id })} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? "Deleting…" : "Delete asset"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
