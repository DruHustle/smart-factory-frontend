import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import {
  PageHeader,
  SectionNav,
  EmptyState,
  SampleTime,
  CopyIdentifier,
} from "@/components/workspace/Primitives";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { itemHref } from "@shared/inventory";
import { toast } from "sonner";
const UserAccess = lazy(() => import("./UserAccess")),
  OnesaIntegration = lazy(() => import("./OnesaIntegration"));
export default function Administration() {
  const { user } = useAuth(),
    { section = "integrations" } = useParams<{ section?: string }>(),
    [, navigate] = useWorkspaceLocation();
  if (!user?.access?.canEngineer)
    return (
      <EmptyState
        title="Administration unavailable"
        description="Use an individual engineering or administrator account on a private installation."
      />
    );
  const sections = [
    ...(user.access.canAdminister
      ? [{ id: "users", label: "Users & access" }]
      : []),
    { id: "integrations", label: "Integrations" },
    ...(user.access.canAdminister
      ? [
          { id: "audit", label: "Audit trail" },
          { id: "workspace", label: "Workspace settings" },
        ]
      : []),
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration"
        description="Connections, access and recorded workspace activity."
      />
      <SectionNav
        label="Administration sections"
        sections={sections}
        value={section}
        onChange={(v) => navigate(`/administration/${v}`)}
      >
        {!sections.some((s) => s.id === section) ? (
          <EmptyState title="Section unavailable" />
        ) : (
          <Suspense fallback={<EmptyState title="Loading administration…" />}>
            {section === "users" ? (
              <UserAccess embedded />
            ) : section === "integrations" ? (
              <Integrations />
            ) : section === "audit" ? (
              <Audit />
            ) : (
              <Settings />
            )}
          </Suspense>
        )}
      </SectionNav>
    </div>
  );
}
function Integrations() {
  const summary = trpc.system.connections.useQuery();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Configured connection profiles</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <p role="status">Loading profiles…</p>
          ) : summary.error ? (
            <EmptyState
              error
              title="Connection profiles unavailable"
              description={summary.error.message}
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Profiles describe saved configuration. Observation times and
                collector health establish whether a source is receiving.
              </p>
              <ul className="divide-y">
                {summary.data?.profiles.map((p) => (
                  <li
                    key={p.protocol}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {p.protocol.replaceAll("_", " ").toUpperCase()}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.count} configured · Last eligible observation:{" "}
                        <SampleTime value={p.lastObserved} />
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/inventory?view=assets">
                        Review linked assets
                      </Link>
                    </Button>
                  </li>
                ))}
                {!summary.data?.profiles.length && (
                  <li className="py-3 text-sm text-muted-foreground">
                    No equipment connection profiles have been saved. Register
                    an item to configure a supported route.
                  </li>
                )}
                <li className="flex items-center justify-between gap-3 py-3">
                  <span>AAS provisioning</span>
                  <Badge variant="outline">
                    {summary.data?.aasProvisioningConfigured
                      ? "Configured · health not inferred"
                      : "Not configured"}
                  </Badge>
                </li>
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <OperatingStatus />
      <details className="rounded-lg border bg-card p-4" open>
        <summary className="cursor-pointer font-medium">
          Optional Onesa exchange
        </summary>
        <div className="mt-4 [&_.workspace-page-header]:hidden">
          <OnesaIntegration />
        </div>
      </details>
    </div>
  );
}
function Audit() {
  const [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const audit = trpc.system.audit.useQuery({ page, search });
  return (
    <div className="space-y-3">
      <Input
        aria-label="Search audit activity"
        placeholder="Find an action, actor or affected item"
        maxLength={100}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />
      {audit.isLoading ? (
        <EmptyState title="Loading recorded activity…" />
      ) : audit.error ? (
        <EmptyState
          error
          title="Audit activity unavailable"
          description={audit.error.message}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{audit.data?.scope}</p>
          {!audit.data?.items.length ? (
            <EmptyState
              title="No matching recorded activity"
              description="No entries were returned by these sources. This does not attest to activity outside their coverage."
            />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {audit.data.items.map((a) => (
                <li
                  key={a.id}
                  className="grid gap-2 p-4 sm:grid-cols-[160px_1fr_1fr]"
                >
                  <p className="text-xs text-muted-foreground">
                    <SampleTime value={a.occurred_at} />
                  </p>
                  <p className="font-medium capitalize">{a.action}</p>
                  <div>
                    <p className="text-sm">{a.actor}</p>
                    {a.ref ? (
                      <Link
                        className="text-xs underline"
                        href={itemHref(a.ref, "activity")}
                      >
                        {a.target}
                      </Link>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {a.target}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Audit pages" className="flex justify-between">
            <Button
              variant="outline"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="self-center text-sm">
              {audit.data?.total ?? 0} records
            </span>
            <Button
              variant="outline"
              disabled={!audit.data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
function Settings() {
  const setting = trpc.system.demoData.useQuery(),
    utils = trpc.useUtils();
  const change = trpc.system.setDemoData.useMutation({
    onSuccess: async () => {
      toast.success("Visibility updated. No records were created.");
      await utils.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace visibility</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block font-medium">
              Show existing demonstration records
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Applies to this private deployment. Records retain their evidence
              labels. This setting does not seed or commission equipment.
            </span>
          </span>
          <Switch
            aria-label="Show existing demonstration records"
            checked={setting.data?.enabled ?? false}
            disabled={setting.isLoading || !!setting.error || change.isPending}
            onCheckedChange={(enabled) => change.mutate({ enabled })}
          />
        </label>
        {setting.error && (
          <p role="alert" className="text-sm text-destructive">
            Visibility setting unavailable.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Shared walkthrough sessions cannot change this setting or access
          operational records.
        </p>
      </CardContent>
    </Card>
  );
}

function OperatingStatus() {
  const { user } = useAuth();
  const operations = trpc.system.operations.useQuery(undefined, {
    enabled: !!user?.access?.canAdminister,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  if (!user?.access?.canAdminister) return null;
  const data = operations.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operating evidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {operations.isLoading ? (
          <p role="status">Loading operating evidence…</p>
        ) : operations.error ? (
          <EmptyState
            error
            title="Operating evidence unavailable"
            description={operations.error.message}
          />
        ) : (
          data && (
            <>
              <p className="text-xs text-muted-foreground">
                Installation-wide queue counts. A process receipt establishes
                software observation, not physical equipment availability.
              </p>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Telemetry worker
                  </dt>
                  <dd className="font-medium">
                    {data.worker
                      ? data.worker.fresh
                        ? "Current receipt"
                        : "Stale receipt"
                      : "No receipt"}
                  </dd>
                  <dd className="mt-1 text-xs">
                    {data.worker
                      ? `${data.worker.pending} pending · ${data.worker.quarantined} quarantined`
                      : "Queue depth unknown"}
                  </dd>
                  {data.worker && (
                    <dd className="text-xs text-muted-foreground">
                      MQTT:{" "}
                      {data.worker.mqttSubscribed
                        ? "Subscribed"
                        : "Disconnected"}
                      <br />
                      Oldest queued:{" "}
                      <SampleTime value={data.worker.oldestPendingAt} />
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Ingestion quarantine
                  </dt>
                  <dd className="font-medium">
                    {String(data.ingress.quarantined)} retained payloads
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    Latest rejection:{" "}
                    <SampleTime value={data.ingress.latest as string | null} />
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Security delivery
                  </dt>
                  <dd className="font-medium">
                    {String(data.security.pending)} pending
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {String(data.security.quarantined)} quarantined · Oldest:{" "}
                    <SampleTime value={data.security.oldest as string | null} />
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    Email delivery
                  </dt>
                  <dd className="font-medium">
                    {String(data.email.pending)} queued ·{" "}
                    {String(data.email.failed)} failed
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    Provider acceptance does not establish recipient delivery.
                  </dd>
                </div>
              </dl>
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Running software identity
                </summary>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt>API source</dt>
                    <dd>
                      {data.runtime.source ? (
                        <CopyIdentifier value={data.runtime.source} />
                      ) : (
                        "Unversioned development runtime"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Backend source</dt>
                    <dd>
                      {data.runtime.backendSource ? (
                        <CopyIdentifier value={data.runtime.backendSource} />
                      ) : (
                        "No bundled backend identity"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Edge contract source</dt>
                    <dd>
                      {data.runtime.edgeSource ? (
                        <CopyIdentifier value={data.runtime.edgeSource} />
                      ) : (
                        "No qualified edge source"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Applied database revision</dt>
                    <dd>
                      {data.runtime.schema.revision} ·{" "}
                      {data.runtime.schema.ready
                        ? "Verified content"
                        : "Awaiting verification"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Edge contract source identifies the qualified protocol code,
                  not the binary installed on physical equipment.
                </p>
              </details>
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Collector and recovery coverage
                </summary>
                <ul className="mt-3 divide-y">
                  {data.collectors.map((c, i) => (
                    <li
                      className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                      key={i}
                    >
                      <span>
                        {String(c.name)} · {c.active ? "Enabled" : "Paused"}
                      </span>
                      <span className="text-muted-foreground">
                        Last receipt:{" "}
                        <SampleTime
                          value={c.last_received_at as string | null}
                        />
                        {c.last_error ? " · Delivery attention" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm">
                  Backup age: unknown. {data.backup.description}
                </p>
              </details>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
