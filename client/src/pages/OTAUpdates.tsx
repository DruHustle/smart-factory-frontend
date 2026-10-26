import { PageHeader } from "@/components/workspace/Primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Package, RefreshCw } from "lucide-react";

type Deployment = {
  id: number;
  deviceId: number;
  firmwareVersionId: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
};

export default function OTAUpdates() {
  const capability = trpc.ota.capability.useQuery();
  const deploymentsQuery = trpc.ota.list.useQuery({ limit: 50 });
  const devicesQuery = trpc.devices.list.useQuery();
  const firmwareQuery = trpc.firmware.list.useQuery();

  const deployments = deploymentsQuery.data ?? [];
  const firmwareVersions = firmwareQuery.data ?? [];
  const devices = devicesQuery.data ?? [];
  const loading = deploymentsQuery.isLoading || firmwareQuery.isLoading;
  const deviceName = (id: number) => devices.find((device) => device.id === id)?.name ?? `Device ${id}`;
  const firmwareVersion = (id: number) => firmwareVersions.find((firmware) => firmware.id === id)?.version ?? `Release ${id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader title="Firmware & updates" description="Firmware inventory and recorded rollout history."/>
        <Button variant="outline" size="sm" onClick={() => { void Promise.all([deploymentsQuery.refetch(), firmwareQuery.refetch(), devicesQuery.refetch(), capability.refetch()]); }} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <Card className="border-amber-500/40 bg-amber-500/[0.06]" role="status">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-amber-600" />OTA delivery is disabled</CardTitle>
          <CardDescription>{capability.data?.reason ?? "No verified firmware release service and device update agent are connected."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Firmware catalog entries and older rollout rows are database records only. They do not transfer or install code, confirm a device version, or perform rollback.</p>
          <p>WROVER firmware is loaded over USB with PlatformIO, Raspberry Pi software is deployed using the documented staged update procedure, and the ADA031 V4 controller is programmed over USB. Generic industrial assets need a manufacturer-supported update agent.</p>
        </CardContent>
      </Card>

      {devicesQuery.isError && <p role="alert" className="text-sm text-destructive">Device names could not be loaded. Records show device IDs; use Refresh to try again.</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5 text-primary" />Firmware inventory</CardTitle>
          <CardDescription>Release metadata is shown without exposing artifact URLs or credentials.</CardDescription>
        </CardHeader>
        <CardContent>
          {firmwareQuery.isLoading ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading firmware inventory…</p>
            : firmwareQuery.isError ? <p role="alert" className="py-6 text-center text-sm text-destructive">Firmware inventory could not be loaded. Use Refresh to try again.</p>
            : firmwareVersions.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {firmwareVersions.map((firmware) => <div key={firmware.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-medium">{firmware.version}</span>
                {firmware.isStable && <Badge variant="outline">Stable</Badge>}
              </div>
              <p className="mt-1 text-xs capitalize text-muted-foreground">Target type: {firmware.deviceType}</p>
              <p className="mt-2 text-sm text-muted-foreground">{firmware.releaseNotes || "No release notes provided."}</p>
              <p className="mt-2 text-xs text-muted-foreground">{firmware.artifactAvailable ? "Artifact metadata present; delivery remains disabled." : "No verified binary artifact and checksum registered."}</p>
              <p className="mt-1 text-xs text-muted-foreground">Cataloged {new Date(firmware.createdAt).toLocaleDateString()}</p>
            </div>)}
          </div> : <p className="py-6 text-center text-sm text-muted-foreground">No firmware releases are registered.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recorded deployments (unconfirmed)</CardTitle>
          <CardDescription>Legacy records are displayed for audit context and are not evidence that a device was updated.</CardDescription>
        </CardHeader>
        <CardContent>
          {deploymentsQuery.isLoading ? <div role="status" className="flex justify-center gap-3 py-8 text-sm text-muted-foreground"><RefreshCw aria-hidden="true" className="h-6 w-6 animate-spin" />Loading deployment records…</div>
            : deploymentsQuery.isError ? <p role="alert" className="py-6 text-center text-sm text-destructive">Deployment records could not be loaded. Use Refresh to try again.</p>
            : deployments.length ? <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Release</TableHead><TableHead>Recorded status</TableHead><TableHead>Record created</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
              <TableBody>{deployments.map((deployment: Deployment) => <TableRow key={deployment.id}>
                <TableCell>{deviceName(deployment.deviceId)}</TableCell>
                <TableCell className="font-mono">{firmwareVersion(deployment.firmwareVersionId)}</TableCell>
                <TableCell><Badge variant="outline">Legacy record · {deployment.status.replaceAll("_", " ")}</Badge></TableCell>
                <TableCell>{new Date(deployment.createdAt).toLocaleString()}</TableCell>
                <TableCell className="max-w-sm whitespace-normal text-sm text-muted-foreground">{deployment.errorMessage ?? "No device acknowledgement is stored."}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div> : <p className="py-6 text-center text-sm text-muted-foreground">No deployment records are present.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
