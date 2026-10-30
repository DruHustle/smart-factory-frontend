import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/workspace/Primitives";
import { FactoryFloor } from "@/components/workspace/FactoryFloor";
import { DEMO_ACCOUNTS } from "@shared/demo-accounts";
import { canonicalUnits, metrics, type Metric } from "@shared/measurements";
import {
  demoRoleAllows,
  sandboxInventory,
  type SandboxAction,
  type SandboxRole,
} from "@shared/demo-sandbox";
import {
  useDemoSandbox,
  startDemoSandbox,
  changeDemoSandbox,
  resetDemoSandbox,
  restoreDemoSandbox,
  demoSandboxStorageError,
} from "@/lib/demo-sandbox";
const tabs = [
  ["floor", "Factory floor"],
  ["inventory", "Inventory & engineering"],
  ["telemetry", "Telemetry & incidents"],
  ["network", "Network & security"],
  ["firmware", "Firmware & integrations"],
  ["administration", "Users & settings"],
  ["passport", "Digital passport"],
] as const;
const csvCell = (value: string) =>
  '"' +
  (/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') +
  '"';
const auditLabels: Record<string, string> = {
  "item.save": "Saved equipment",
  "item.connect": "Changed demo connection",
  sample: "Generated simulated reading",
  threshold: "Configured demo threshold",
  incident: "Updated demo incident",
  user: "Updated demo user",
  firmware: "Added firmware metadata",
  deploy: "Queued simulated deployment",
  completeDeployment: "Completed simulated deployment",
  finding: "Created simulated security finding",
  decision: "Recorded investigation decision",
  scenario: "Changed diagnostics scenario",
  settings: "Updated demo settings",
};
export default function DemoSandbox() {
  const { user, login } = useAuth(),
    demo = !!user?.access?.demoOnly;
  const role: SandboxRole =
    user?.role === "admin" ||
    user?.role === "engineer" ||
    user?.role === "operator"
      ? user.role
      : "viewer";
  const [location, navigate] = useWorkspaceLocation(),
    params = new URLSearchParams(location.split("?")[1] ?? "");
  const tab = tabs.some(([id]) => id === params.get("tab"))
    ? params.get("tab")!
    : "floor";
  const floor = trpc.factory.floor.useQuery(
    { zone: "" },
    { enabled: demo, staleTime: 30000 },
  );
  const state = useDemoSandbox();
  useEffect(() => {
    if (demo && floor.data && !state) startDemoSandbox(floor.data.items);
  }, [demo, floor.data, state]);
  const [itemRef, setItemRef] = useState(params.get("item") ?? ""),
    [switching, setSwitching] = useState(false),
    [resetConfirm, setResetConfirm] = useState(false);
  const [name, setName] = useState("My demo pump"),
    [kind, setKind] = useState<"asset" | "device">("asset"),
    [itemType, setItemType] = useState("pump"),
    [zone, setZone] = useState("My production area");
  const [metric, setMetric] = useState<Metric>("temperature"),
    [value, setValue] = useState("85"),
    [warning, setWarning] = useState("60"),
    [critical, setCritical] = useState("80"),
    [direction, setDirection] = useState<"above" | "below">("above");
  const [firmware, setFirmware] = useState("demo-2.0.0"),
    [actorName, setActorName] = useState("Example Technician"),
    [actorRole, setActorRole] = useState<SandboxRole>("engineer"),
    [decision, setDecision] = useState(
      "Reviewed the simulated source evidence.",
    ),
    [findingState, setFindingState] = useState<
      "investigated" | "deferred" | "resolved"
    >("investigated");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (state && !state.items.some((i) => i.ref === itemRef))
      setItemRef(state.items[0]?.ref ?? "");
  }, [state, itemRef]);
  const action = (a: SandboxAction) => {
    try {
      changeDemoSandbox(role, a);
      toast.success(
        a.type === "sample"
          ? "Simulated reading generated"
          : a.type === "deploy"
            ? "Demo deployment queued"
            : "Demo workspace updated",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Demo action unavailable");
    }
  };
  const open = (next: string) =>
    navigate(
      `/sandbox?tab=${next}${itemRef ? `&item=${encodeURIComponent(itemRef)}` : ""}`,
    );
  const download = (data: unknown, name: string, type = "application/json") => {
    const url = URL.createObjectURL(
      new Blob(
        [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
        { type },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (!demo)
    return (
      <EmptyState
        title="Editable demo workspace"
        description="Sign in with a demo account to explore a resettable simulation."
        action={
          <Button asChild>
            <Link href="/login">Open demo sign-in</Link>
          </Button>
        }
      />
    );
  if (floor.error)
    return (
      <EmptyState
        error
        title="Demo inventory unavailable"
        description={floor.error.message}
      />
    );
  if (!state) return <EmptyState title="Preparing your demo workspace…" />;
  const inventory = sandboxInventory(state),
    item = state.items.find((i) => i.ref === itemRef),
    samples = state.samples.filter((s) => s.itemRef === itemRef).slice(-20),
    operate = demoRoleAllows(role, "operator"),
    engineer = demoRoleAllows(role, "engineer"),
    admin = role === "admin";
  const selector = (
    <label className="block text-sm">
      Demo equipment
      <select
        className="workspace-control mt-1 w-full"
        aria-label="Demo equipment"
        value={itemRef}
        onChange={(e) => setItemRef(e.target.value)}
      >
        {state.items.map((i) => (
          <option key={i.ref} value={i.ref}>
            {i.name} · {i.kind}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Demo sandbox"
        description="Create, edit and explore a simulated factory. Your changes stay in this browser."
      />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-info/5 p-3">
        <strong className="text-sm">Editable simulation</strong>
        <label className="flex items-center gap-2 text-sm">
          Demo role
          <select
            aria-label="Demo role"
            className="workspace-control"
            disabled={switching}
            value={role}
            onChange={async (e) => {
              const account = DEMO_ACCOUNTS.find(
                (a) => a.role === e.target.value,
              );
              if (!account) return;
              setSwitching(true);
              const result = await login(account.email, account.password);
              setSwitching(false);
              if (!result.success)
                toast.error(result.error ?? "Demo role switch failed");
            }}
          >
            {["viewer", "operator", "engineer", "admin"].map((r) => (
              <option key={r} value={r}>
                {r === "admin"
                  ? "Administrator"
                  : r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setResetConfirm(true)}
        >
          Reset demo
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/layouts">Design a factory layout</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/">Reference factory overview</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Viewers explore and design personal layouts. Operators try telemetry and
        incident actions. Engineers manage simulated equipment, rules and
        firmware. Administrators also manage demo users and settings. Actions
        here do not operate equipment or send messages.
      </p>
      {demoSandboxStorageError() && (
        <p
          role="alert"
          className="rounded-md border border-warning p-3 text-sm"
        >
          Browser storage is unavailable. Keep this tab open and export your
          demo work before leaving.
        </p>
      )}
      {resetConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reset demo workspace"
          className="space-y-3 rounded-lg border bg-card p-4"
        >
          <h2 className="font-semibold">
            Reset this browser’s demo workspace?
          </h2>
          <p className="text-sm">
            This restores the sample inventory and removes this sandbox’s edits,
            readings, simulated users and workflow history. Export a backup
            first if you want to keep them. Saved factory layout drafts remain
            available.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                resetDemoSandbox(floor.data?.items ?? []);
                setSelected(null);
                setResetConfirm(false);
                toast.success("Demo workspace reset");
              }}
            >
              Reset this demo workspace
            </Button>
            <Button variant="outline" onClick={() => setResetConfirm(false)}>
              Keep my demo
            </Button>
          </div>
        </div>
      )}
      <nav aria-label="Demo sandbox sections" className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "default" : "outline"}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => open(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "floor" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{state.settings.name}</h2>
          <p className="text-sm">
            {state.items.length} demo items ·{" "}
            {state.incidents.filter((i) => i.status !== "resolved").length} open
            simulated incidents
          </p>
          <FactoryFloor
            key={state.id}
            arrangementKey="smart-factory:demo-floor-arrangement:v1"
            items={inventory}
            links={(floor.data?.links ?? []).filter(
              (l) =>
                state.items.some((i) => i.ref === l.from) &&
                state.items.some((i) => i.ref === l.to),
            )}
            selected={selected}
            onSelect={setSelected}
            returnTo="/sandbox"
            demo
          />
          <Button onClick={() => open("inventory")}>
            Create or edit demo equipment
          </Button>
        </section>
      ) : tab === "inventory" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Create equipment</h2>
            <p className="text-sm text-muted-foreground">
              These records are local to your demo workspace. Switch to Engineer
              or Administrator to edit.
            </p>
            <fieldset disabled={!engineer} className="space-y-3">
              <label className="block text-sm">
                Equipment name
                <input
                  aria-label="Demo equipment name"
                  className="workspace-control mt-1 w-full"
                  maxLength={180}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  Record
                  <select
                    aria-label="Demo record kind"
                    className="workspace-control mt-1 w-full"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="asset">Asset / machine</option>
                    <option value="device">Device / gateway</option>
                  </select>
                </label>
                <label className="text-sm">
                  Type
                  <select
                    aria-label="Demo equipment type"
                    className="workspace-control mt-1 w-full"
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value)}
                  >
                    {[
                      "pump",
                      "motor",
                      "robot",
                      "conveyor",
                      "tank",
                      "valve",
                      "controller",
                      "sensor",
                      "gateway",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                Zone
                <input
                  aria-label="Demo equipment zone"
                  className="workspace-control mt-1 w-full"
                  maxLength={80}
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </label>
              <Button
                onClick={() =>
                  action({
                    type: "item.save",
                    item: {
                      name,
                      kind,
                      itemType,
                      zone,
                      manufacturer: "Example manufacturer",
                      model: "Demonstration model",
                      serial: `DEMO-${state.items.length + 1}`,
                    },
                  })
                }
              >
                Create demo equipment
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  action({
                    type: "item.save",
                    item: {
                      name: "Imported demo machine",
                      kind: "asset",
                      itemType: "motor",
                      zone: "Imported examples",
                      manufacturer: "Sample AAS manufacturer",
                      model: "AASX example",
                      serial: "DEMO-AASX",
                    },
                  })
                }
              >
                Try sample AASX import
              </Button>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              The sample import demonstrates creation from reviewed example
              identity fields. It does not upload or publish a private AAS
              package.
            </p>
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Inspect and edit equipment</h2>
            {selector}
            {item && (
              <>
                <dl className="space-y-1 break-words text-sm">
                  <dt>Identifier</dt>
                  <dd className="break-all">{item.identifier}</dd>
                  <dt>Type / zone</dt>
                  <dd>
                    {item.itemType} · {item.zone ?? "Unassigned"}
                  </dd>
                  <dt>Demo connection</dt>
                  <dd>
                    {item.connected
                      ? "Configured in simulation"
                      : "Not configured"}
                  </dd>
                </dl>
                <fieldset disabled={!engineer} className="space-y-2">
                  <label className="block text-sm">
                    Rename selected item
                    <input
                      key={item.ref + item.name}
                      aria-label="Rename demo item"
                      className="workspace-control mt-1 w-full"
                      defaultValue={item.name}
                      maxLength={180}
                      onBlur={(e) => {
                        if (
                          e.target.value.trim() &&
                          e.target.value !== item.name
                        )
                          action({
                            type: "item.save",
                            item: { ...item, name: e.target.value },
                          });
                      }}
                    />
                  </label>
                  <Button
                    variant="outline"
                    onClick={() =>
                      action({
                        type: "item.connect",
                        ref: item.ref,
                        connected: !item.connected,
                      })
                    }
                  >
                    {item.connected
                      ? "Disconnect demo item"
                      : "Configure demo connection"}
                  </Button>
                </fieldset>
                <Button variant="outline" onClick={() => open("passport")}>
                  Open demo passport
                </Button>
              </>
            )}
          </section>
        </div>
      ) : tab === "telemetry" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Simulate telemetry</h2>
            {selector}
            <label className="block text-sm">
              Metric
              <select
                aria-label="Demo metric"
                className="workspace-control mt-1 w-full"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {m} ({canonicalUnits[m]})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Value ({canonicalUnits[metric]})
              <input
                aria-label="Simulated reading value"
                type="number"
                className="workspace-control mt-1 w-full"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <Button
              disabled={!operate || !item}
              onClick={() =>
                action({
                  type: "sample",
                  ref: itemRef,
                  metric,
                  value: Number(value),
                })
              }
            >
              Generate simulated reading
            </Button>
            <fieldset
              disabled={!engineer}
              className="space-y-2 rounded-md border p-3"
            >
              <legend className="px-1 text-sm">Demo threshold rule</legend>
              <select
                aria-label="Threshold direction"
                className="workspace-control w-full"
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as typeof direction)
                }
              >
                <option value="above">Above limit</option>
                <option value="below">Below limit</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Warning
                  <input
                    aria-label="Demo warning limit"
                    type="number"
                    className="workspace-control mt-1 w-full"
                    value={warning}
                    onChange={(e) => setWarning(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  Critical
                  <input
                    aria-label="Demo critical limit"
                    type="number"
                    className="workspace-control mt-1 w-full"
                    value={critical}
                    onChange={(e) => setCritical(e.target.value)}
                  />
                </label>
              </div>
              <Button
                variant="outline"
                disabled={!item}
                onClick={() =>
                  action({
                    type: "threshold",
                    ref: itemRef,
                    metric,
                    warning: Number(warning),
                    critical: Number(critical),
                    direction,
                  })
                }
              >
                Save demo threshold
              </Button>
            </fieldset>
            <h3 className="font-medium">Recorded simulated samples</h3>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {samples.length ? (
                samples
                  .slice()
                  .reverse()
                  .map((s) => (
                    <li key={s.id}>
                      {s.metric}:{" "}
                      {s.value.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}{" "}
                      {s.unit} · {new Date(s.at).toLocaleString()} · simulated
                    </li>
                  ))
              ) : (
                <li>No samples for this demo item yet.</li>
              )}
            </ul>
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Incidents & notifications</h2>
            <p className="text-sm text-muted-foreground">
              Generate a reading across a saved threshold to create an incident.
              Acknowledgement and resolution are separate. Notifications stay in
              this sandbox.
            </p>
            {state.incidents.length ? (
              state.incidents
                .slice()
                .reverse()
                .map((i) => (
                  <article
                    key={i.id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <h3 className="font-medium">
                      {state.items.find((s) => s.ref === i.itemRef)?.name} ·{" "}
                      {i.severity}
                    </h3>
                    <p className="text-sm">{i.message}</p>
                    <p className="text-sm">
                      Status: <strong>{i.status}</strong> · Simulated
                      notification{" "}
                      {i.notificationRecorded ? "recorded" : "disabled"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!operate || i.status !== "open"}
                        onClick={() =>
                          action({
                            type: "incident",
                            id: i.id,
                            status: "acknowledged",
                          })
                        }
                      >
                        Acknowledge demo incident
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!operate || i.status === "resolved"}
                        onClick={() =>
                          action({
                            type: "incident",
                            id: i.id,
                            status: "resolved",
                          })
                        }
                      >
                        Resolve demo incident
                      </Button>
                    </div>
                  </article>
                ))
            ) : (
              <EmptyState
                title="No demo incidents yet"
                description="Save a threshold, then generate a reading beyond it."
              />
            )}
          </section>
        </div>
      ) : tab === "network" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">FX / TSN diagnostics</h2>
            <label className="block text-sm">
              Scenario
              <select
                aria-label="Sandbox network scenario"
                className="workspace-control mt-1 w-full"
                value={state.scenario}
                onChange={(e) =>
                  action({
                    type: "scenario",
                    scenario: e.target.value as typeof state.scenario,
                  })
                }
              >
                {["normal", "late-delivery", "clock-loss", "recovery"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
            <p className="text-sm">
              {state.scenario === "clock-loss"
                ? "Simulated clocks are not locked. One-way latency is unavailable."
                : state.scenario === "late-delivery"
                  ? "The simulated connection has late deliveries and missed deadlines."
                  : state.scenario === "recovery"
                    ? "The authored recovery scenario restores simulated clock and delivery evidence."
                    : "The authored normal scenario shows synchronized clocks and timing evidence."}
            </p>
            <Button asChild variant="outline">
              <Link href={`/network?scenario=${state.scenario}&tab=timing`}>
                Open timing charts and evidence
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              These are authored scenarios, not a physical network test. The
              full diagnostics workspace provides the report format and
              selected-snapshot export.
            </p>
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Cybersecurity investigation</h2>
            {selector}
            <Button
              disabled={!engineer || !item}
              onClick={() => action({ type: "finding", ref: itemRef })}
            >
              Create simulated finding
            </Button>
            <label className="block text-sm">
              Investigation decision
              <textarea
                aria-label="Demo investigation decision"
                className="workspace-control mt-1 w-full"
                maxLength={1000}
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
              />
            </label>
            <select
              aria-label="Demo finding decision state"
              className="workspace-control w-full"
              value={findingState}
              onChange={(e) =>
                setFindingState(e.target.value as typeof findingState)
              }
            >
              <option value="investigated">Investigated</option>
              <option value="deferred">Deferred</option>
              <option value="resolved">Resolved in simulation</option>
            </select>
            {state.findings.map((f) => (
              <article key={f.id} className="space-y-2 rounded-md border p-3">
                <h3 className="font-medium">{f.title}</h3>
                <p className="text-sm">
                  {f.state} · {f.decision || "No decision yet"}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!engineer}
                  onClick={() =>
                    action({
                      type: "decision",
                      id: f.id,
                      decision,
                      state: findingState,
                    })
                  }
                >
                  Record demo decision
                </Button>
              </article>
            ))}
          </section>
        </div>
      ) : tab === "firmware" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Firmware workflow</h2>
            <p className="text-sm text-muted-foreground">
              Try metadata, queue and completion steps. No firmware is delivered
              to equipment.
            </p>
            {selector}
            <fieldset disabled={!engineer} className="space-y-3">
              <label className="block text-sm">
                Sample version
                <input
                  aria-label="Demo firmware version"
                  className="workspace-control mt-1 w-full"
                  value={firmware}
                  maxLength={64}
                  onChange={(e) => setFirmware(e.target.value)}
                />
              </label>
              <Button
                onClick={() => action({ type: "firmware", version: firmware })}
              >
                Add sample firmware metadata
              </Button>
              <Button
                variant="outline"
                disabled={!item}
                onClick={() =>
                  action({ type: "deploy", ref: itemRef, version: firmware })
                }
              >
                Queue demo update
              </Button>
            </fieldset>
            {state.deployments.map((d) => (
              <article key={d.id} className="space-y-2 rounded-md border p-3">
                <p>
                  {state.items.find((i) => i.ref === d.itemRef)?.name} ·{" "}
                  {d.version} · <strong>{d.status}</strong>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!engineer || d.status === "completed"}
                  onClick={() =>
                    action({ type: "completeDeployment", id: d.id })
                  }
                >
                  Simulate completion
                </Button>
              </article>
            ))}
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Integration settings</h2>
            <p className="text-sm">
              Demo protocol: {state.settings.protocol}. Configure a demo item’s
              connection in Inventory, then generate samples to explore
              acquisition and incidents.
            </p>
            <Button variant="outline" onClick={() => open("inventory")}>
              Open connection setup
            </Button>
            <Button asChild variant="outline">
              <Link href="/infrastructure/service-health">
                Explore simulated service failures and recovery
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Broker credentials, external subscriptions, hardware configuration
              and service restarts are not used by this sandbox.
            </p>
          </section>
        </div>
      ) : tab === "administration" ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Demo users & settings</h2>
            <p className="text-sm text-muted-foreground">
              Demo users are simulated records, not sign-in accounts.
              Administrator controls demonstrate management without creating
              credentials.
            </p>
            <fieldset disabled={!admin} className="space-y-3">
              <label className="block text-sm">
                Demo user name
                <input
                  aria-label="Demo user name"
                  className="workspace-control mt-1 w-full"
                  value={actorName}
                  maxLength={180}
                  onChange={(e) => setActorName(e.target.value)}
                />
              </label>
              <select
                aria-label="New demo user role"
                className="workspace-control w-full"
                value={actorRole}
                onChange={(e) => setActorRole(e.target.value as SandboxRole)}
              >
                {["viewer", "operator", "engineer", "admin"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <Button
                onClick={() =>
                  action({ type: "user", name: actorName, role: actorRole })
                }
              >
                Create demo user
              </Button>
              <label className="block text-sm">
                Factory name
                <input
                  key={state.settings.name}
                  aria-label="Demo factory name"
                  className="workspace-control mt-1 w-full"
                  defaultValue={state.settings.name}
                  maxLength={120}
                  onBlur={(e) => {
                    if (
                      e.target.value.trim() &&
                      e.target.value !== state.settings.name
                    )
                      action({
                        type: "settings",
                        settings: { ...state.settings, name: e.target.value },
                      });
                  }}
                />
              </label>
              <label className="block text-sm">
                Acquisition protocol
                <select
                  aria-label="Demo acquisition protocol"
                  className="workspace-control mt-1 w-full"
                  value={state.settings.protocol}
                  onChange={(e) =>
                    action({
                      type: "settings",
                      settings: {
                        ...state.settings,
                        protocol: e.target
                          .value as typeof state.settings.protocol,
                      },
                    })
                  }
                >
                  {["MQTT", "OPC UA", "Modbus"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.settings.notifications}
                  onChange={(e) =>
                    action({
                      type: "settings",
                      settings: {
                        ...state.settings,
                        notifications: e.target.checked,
                      },
                    })
                  }
                />
                Simulated incident notifications
              </label>
            </fieldset>
            <ul className="space-y-2">
              {state.users.map((u) => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                >
                  <span>{u.name}</span>
                  <select
                    aria-label={`Demo role for ${u.name}`}
                    disabled={!admin}
                    className="workspace-control"
                    value={u.role}
                    onChange={(e) =>
                      action({
                        type: "user",
                        id: u.id,
                        name: u.name,
                        role: e.target.value as SandboxRole,
                      })
                    }
                  >
                    {["viewer", "operator", "engineer", "admin"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Reports, backup & audit</h2>
            <Button
              variant="outline"
              onClick={() =>
                download(
                  [
                    "name,type,zone,mode",
                    ...state.items.map(
                      (i) =>
                        `${csvCell(i.name)},${csvCell(i.itemType)},${csvCell(i.zone ?? "")},simulated`,
                    ),
                  ].join("\r\n"),
                  "demo-inventory.csv",
                  "text/csv",
                )
              }
            >
              Export demo inventory report
            </Button>
            <Button
              variant="outline"
              disabled={!admin}
              onClick={() => download(state, "demo-workspace-backup.json")}
            >
              Export demo backup
            </Button>
            <label className="block text-sm">
              Restore demo backup
              <input
                aria-label="Restore demo backup"
                disabled={!admin}
                className="mt-1 block max-w-full text-sm"
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 4000000) {
                    toast.error("Choose a demo backup smaller than 4 MB");
                    return;
                  }
                  try {
                    restoreDemoSandbox(JSON.parse(await file.text()));
                    toast.success("Demo backup restored in this browser");
                  } catch {
                    toast.error(
                      "This file is not a valid demo workspace backup",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              This exports and restores the actual browser sandbox data. It is
              not a production database backup or recovery receipt.
            </p>
            <h3 className="font-medium">Demo activity</h3>
            <ol className="max-h-96 space-y-2 overflow-y-auto text-sm">
              {state.audit
                .slice()
                .reverse()
                .map((a) => (
                  <li key={a.id} className="rounded-md border p-2">
                    {auditLabels[a.action] ?? "Demo action"} · {a.role} ·{" "}
                    {new Date(a.at).toLocaleString()}
                  </li>
                ))}
            </ol>
          </section>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="print:hidden">
            {selector}
            <Button
              className="mt-3"
              disabled={!item}
              onClick={() => window.print()}
            >
              Print demo passport
            </Button>
          </div>
          {item && (
            <article
              id="demo-passport-print"
              className="space-y-4 rounded-lg border bg-card p-6"
            >
              <p className="text-xs uppercase tracking-wider">
                Digital product passport · simulated demonstration
              </p>
              <h1 className="text-2xl font-semibold">{item.name}</h1>
              <dl className="grid gap-3 sm:grid-cols-2">
                {Object.entries({
                  "Product type": item.itemType,
                  Manufacturer: item.manufacturer,
                  Model: item.model,
                  "Serial number": item.serial,
                  "Layout zone": item.zone ?? "Unassigned",
                  Evidence: "Authored browser simulation",
                }).map(([label, value]) => (
                  <div key={label} className="border-b pb-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">
                Voluntary prototype passport. This demonstration is not evidence
                of product conformity or a published manufacturer passport. No
                asset-specific repair or end-of-life guidance has been reviewed.
              </p>
            </article>
          )}
          <style>{`@media print {body:has(#demo-passport-print) *:not(:has(#demo-passport-print)):not(#demo-passport-print):not(#demo-passport-print *){display:none!important}body:has(#demo-passport-print) :has(#demo-passport-print){display:contents!important}#demo-passport-print{position:static;width:100%;margin:0;border:0;padding:20pt;background:white!important;color:black!important}#demo-passport-print *{color:black!important}}`}</style>
        </section>
      )}
    </div>
  );
}
