import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Settings2,
  ClipboardList,
  Activity,
  Plus,
  X,
} from "lucide-react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { Button } from "@/components/ui/button";
import { itemHref } from "@shared/inventory";
import { assistantInvestigationHref } from "@shared/assistant-investigation";
import {
  operationsConfiguration,
  operationScenarios,
  operationScenarioLabels,
  productionPeriod,
  type OperationScenario,
  type OperationsSummary,
  type OperationsConfiguration,
  type ProductionPeriod,
  type ScenarioEvidence,
} from "@shared/operations";

const decimal = (value: number | null, digits = 1) =>
  value == null
    ? "Unavailable"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const percent = (value: number | null) =>
  value == null ? "Unavailable" : `${decimal(value * 100)}%`;
const date = (value: number | string, timeZone: string) =>
  new Date(value).toLocaleString(undefined, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
const utcInput = (value: number) => new Date(value).toISOString().slice(0, 16);
const fromUtcInput = (value: string) => Date.parse(`${value}Z`);
const emptyNumber = (value: string) => (value.trim() ? Number(value) : null);

export function ScenarioEvidencePanel({
  evidence,
  startTime,
  endTime,
}: {
  evidence: ScenarioEvidence;
  startTime: number;
  endTime: number;
}) {
  const [signal, setSignal] = useState<
    "pressureBar" | "vibrationMmS" | "outputPerMinute"
  >("pressureBar");
  const definitions = {
    pressureBar: { name: "Pressure", unit: "bar", limit: 5.5 },
    vibrationMmS: { name: "Vibration", unit: "mm/s", limit: 4.5 },
    outputPerMinute: { name: "Output rate", unit: "units/min", limit: 10 },
  };
  const selected = definitions[signal];
  const context = `otScenario=${evidence.scenario}&from=${encodeURIComponent(new Date(startTime).toISOString())}&to=${encodeURIComponent(new Date(endTime).toISOString())}`;
  return (
    <div
      className="space-y-3 rounded-lg border border-info/30 bg-info/5 p-3"
      data-testid="ot-scenario-evidence"
    >
      <div>
        <p className="text-xs font-medium text-info">
          Recorded simulation · separate from baseline telemetry
        </p>
        <h3 className="mt-1 font-semibold">{evidence.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {evidence.explanation}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Operating state</dt>
          <dd className="capitalize">{evidence.operatingState}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Asset condition</dt>
          <dd className="capitalize">{evidence.condition}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Gateway connection</dt>
          <dd className="capitalize">{evidence.connectivity}</dd>
        </div>
      </dl>
      <label className="flex flex-wrap items-center gap-2 text-xs">
        Scenario signal
        <select
          aria-label="Scenario signal"
          className="workspace-control max-w-56"
          value={signal}
          onChange={(e) => setSignal(e.target.value as typeof signal)}
        >
          {Object.entries(definitions).map(([key, def]) => (
            <option value={key} key={key}>
              {def.name} ({def.unit})
            </option>
          ))}
        </select>
      </label>
      <div
        className="h-44 min-w-0"
        role="img"
        aria-label={`${selected.name} scenario trend in ${selected.unit}; missing readings remain gaps`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={evidence.signals}
            margin={{ top: 15, right: 8, left: 0, bottom: 5 }}
          >
            <XAxis
              dataKey="at"
              type="number"
              domain={[startTime, endTime]}
              tickFormatter={(v) => new Date(v).toISOString().slice(11, 16)}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              width={40}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => decimal(Number(value), 1)}
              domain={[
                0,
                (dataMax: number) =>
                  Math.ceil(Math.max(dataMax, selected.limit) * 11) / 10,
              ]}
            />
            <Tooltip
              labelFormatter={(v) => new Date(Number(v)).toISOString()}
              formatter={(value: unknown) => [
                `${value ?? "Unavailable"} ${selected.unit}`,
                selected.name,
              ]}
            />
            <ReferenceLine
              xAxisId={0}
              yAxisId={0}
              y={selected.limit}
              stroke="var(--color-warning)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
            <Line
              type="stepAfter"
              dataKey={signal}
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        UTC time · {selected.unit} · dashed line:{" "}
        {signal === "outputPerMinute"
          ? "configured demo ideal rate"
          : "configured demo warning limit"}{" "}
        {selected.limit} {selected.unit}
      </p>
      {evidence.hypothesis && (
        <p className="text-sm">
          <strong>Hypothesis:</strong> {evidence.hypothesis}
        </p>
      )}
      <p className="text-sm">
        <strong>Next investigation:</strong> {evidence.nextStep}
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        {evidence.assetRef && (
          <Link
            className="text-primary underline"
            href={`${itemHref(evidence.assetRef)}?${context}`}
          >
            Open related equipment
          </Link>
        )}
        {evidence.gatewayRef && (
          <Link
            className="text-primary underline"
            href={`${itemHref(evidence.gatewayRef, "connected")}?${context}`}
          >
            Inspect gateway
          </Link>
        )}
        {endTime - startTime <= 86400000 ? (
          <Link
            className="text-primary underline"
            href={assistantInvestigationHref({
              scenario: evidence.scenario,
              scope: "simulated",
              startTime,
              endTime,
            })}
          >
            Ask about this scenario
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">
            Choose a window of at most 24 hours to ask about this scenario.
          </span>
        )}
      </div>
    </div>
  );
}

function SettingsForm({
  data,
  factoryId,
  onSaved,
}: {
  data: OperationsSummary;
  factoryId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<OperationsConfiguration>(
    data.configuration,
  );
  const save = trpc.operations.configure.useMutation({
    onSuccess: async () => {
      toast.success("Shift and production settings saved");
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = operationsConfiguration.safeParse(draft);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0].message);
          return;
        }
        save.mutate({
          factoryId,
          expectedVersion: data.version,
          configuration: parsed.data,
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Define one production boundary and its local shift starts. A shift ends
        when the next configured shift starts.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Production boundary
          <input
            className="workspace-control"
            value={draft.boundaryLabel}
            maxLength={120}
            required
            onChange={(e) =>
              setDraft({ ...draft, boundaryLabel: e.target.value })
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          Site timezone
          <input
            className="workspace-control"
            value={draft.timeZone}
            placeholder="Africa/Harare"
            maxLength={80}
            required
            onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Output unit
          <input
            className="workspace-control"
            value={draft.countUnit}
            maxLength={24}
            required
            onChange={(e) => setDraft({ ...draft, countUnit: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Currency
          <input
            className="workspace-control"
            value={draft.currency}
            maxLength={3}
            pattern="[A-Z]{3}"
            required
            onChange={(e) =>
              setDraft({ ...draft, currency: e.target.value.toUpperCase() })
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          Default ideal cycle (seconds per unit)
          <input
            className="workspace-control"
            type="number"
            step="any"
            min="0.001"
            value={draft.idealCycleSeconds ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                idealCycleSeconds: emptyNumber(e.target.value),
              })
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          Energy meter boundary
          <input
            className="workspace-control"
            value={draft.energyMeterBoundary}
            maxLength={120}
            placeholder="Same boundary required for kWh per good unit"
            onChange={(e) =>
              setDraft({ ...draft, energyMeterBoundary: e.target.value })
            }
          />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          Shift starts in site time
        </legend>
        {draft.shifts.map((shift, index) => (
          <div key={shift.id} className="flex flex-wrap items-end gap-2">
            <label className="min-w-36 flex-1 text-xs">
              Shift name
              <input
                className="workspace-control mt-1"
                value={shift.name}
                maxLength={60}
                required
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    shifts: draft.shifts.map((s, i) =>
                      i === index ? { ...s, name: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <label className="text-xs">
              Starts
              <input
                className="workspace-control mt-1"
                type="time"
                required
                value={`${String(Math.floor(shift.startMinute / 60)).padStart(2, "0")}:${String(shift.startMinute % 60).padStart(2, "0")}`}
                onChange={(e) => {
                  const [hour, min] = e.target.value.split(":").map(Number);
                  if (Number.isFinite(hour + min))
                    setDraft({
                      ...draft,
                      shifts: draft.shifts.map((s, i) =>
                        i === index
                          ? { ...s, startMinute: hour * 60 + min }
                          : s,
                      ),
                    });
                }}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={draft.shifts.length <= 1}
              aria-label={`Remove ${shift.name}`}
              onClick={() =>
                setDraft({
                  ...draft,
                  shifts: draft.shifts.filter((_, i) => i !== index),
                })
              }
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.shifts.length >= 8}
          onClick={() => {
            const id = Array.from(
              { length: 9 },
              (_, i) => `shift-${i + 1}`,
            ).find((id) => !draft.shifts.some((s) => s.id === id))!;
            setDraft({
              ...draft,
              shifts: [
                ...draft.shifts,
                { id, name: "New shift", startMinute: 0 },
              ],
            });
          }}
        >
          <Plus className="mr-1 size-3" />
          Add shift
        </Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Repeated daylight-saving times use their first occurrence. Missing local
        times advance by the clock-change gap. Period calculations use actual
        elapsed time.
      </p>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save operations settings"}
      </Button>
    </form>
  );
}

function ProductionForm({
  data,
  factoryId,
  onSaved,
}: {
  data: OperationsSummary;
  factoryId?: string;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<ProductionPeriod>(() => ({
    startTime: Math.max(
      data.shift.startTime,
      ...data.records.map((r) => r.endTime),
    ),
    endTime: Math.min(Date.now(), data.shift.endTime),
    product: "",
    totalCount: null,
    goodCount: null,
    idealCycleSeconds: data.configuration.idealCycleSeconds,
    meterStartKwh: null,
    meterEndKwh: null,
    meterBoundary: data.configuration.energyMeterBoundary,
    complete: false,
    evidence: "",
    downtime: [],
  }));
  const save = trpc.operations.recordProduction.useMutation({
    onSuccess: async () => {
      toast.success("Manual production evidence recorded");
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  const submit = () => {
    const parsed = productionPeriod.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    save.mutate({
      factoryId,
      expectedVersion: data.version,
      period: parsed.data,
    });
  };
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h4 className="font-medium">Record a production period</h4>
      <p className="text-sm text-muted-foreground">
        Manual evidence for {data.configuration.boundaryLabel}. Enter counts for
        this interval, not cumulative counter values. Separate products and
        counter resets into separate periods.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Period start (UTC)
          <input
            className="workspace-control"
            type="datetime-local"
            required
            value={utcInput(draft.startTime)}
            onChange={(e) => {
              const v = fromUtcInput(e.target.value);
              if (Number.isFinite(v)) setDraft({ ...draft, startTime: v });
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Period end (UTC)
          <input
            className="workspace-control"
            type="datetime-local"
            required
            value={utcInput(draft.endTime)}
            onChange={(e) => {
              const v = fromUtcInput(e.target.value);
              if (Number.isFinite(v)) setDraft({ ...draft, endTime: v });
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Product / batch
          <input
            className="workspace-control"
            value={draft.product}
            required
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, product: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Ideal cycle (seconds per unit)
          <input
            className="workspace-control"
            type="number"
            step="any"
            min="0.001"
            value={draft.idealCycleSeconds ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                idealCycleSeconds: emptyNumber(e.target.value),
              })
            }
          />
        </label>
        {(
          ["totalCount", "goodCount", "meterStartKwh", "meterEndKwh"] as const
        ).map((key) => (
          <label key={key} className="grid gap-1 text-sm">
            {
              {
                totalCount: "Total units produced",
                goodCount: "Good units produced",
                meterStartKwh: "Meter at start (kWh)",
                meterEndKwh: "Meter at end (kWh)",
              }[key]
            }
            <input
              className="workspace-control"
              type="number"
              min="0"
              step={key.includes("Count") ? "1" : "any"}
              value={draft[key] ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, [key]: emptyNumber(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Meter boundary: {draft.meterBoundary || "Not configured"}. Leave unknown
        readings blank. A decreasing meter reading is retained as reset evidence
        and excludes consumption calculations.
      </p>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Recorded stops</legend>
        {draft.downtime.map((stop, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
          >
            <label className="grid gap-1 text-xs">
              Stop start (UTC)
              <input
                className="workspace-control"
                type="datetime-local"
                required
                value={utcInput(stop.startTime)}
                onChange={(e) => {
                  const value = fromUtcInput(e.target.value);
                  if (Number.isFinite(value))
                    setDraft({
                      ...draft,
                      downtime: draft.downtime.map((s, i) =>
                        i === index ? { ...s, startTime: value } : s,
                      ),
                    });
                }}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Stop end (UTC)
              <input
                className="workspace-control"
                type="datetime-local"
                required
                value={utcInput(stop.endTime)}
                onChange={(e) => {
                  const value = fromUtcInput(e.target.value);
                  if (Number.isFinite(value))
                    setDraft({
                      ...draft,
                      downtime: draft.downtime.map((s, i) =>
                        i === index ? { ...s, endTime: value } : s,
                      ),
                    });
                }}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Reason
              <input
                className="workspace-control"
                value={stop.reason}
                required
                maxLength={120}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    downtime: draft.downtime.map((s, i) =>
                      i === index ? { ...s, reason: e.target.value } : s,
                    ),
                  })
                }
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={stop.planned}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      downtime: draft.downtime.map((s, i) =>
                        i === index ? { ...s, planned: e.target.checked } : s,
                      ),
                    })
                  }
                />
                Planned shutdown
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    downtime: draft.downtime.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.downtime.length >= 100}
          onClick={() =>
            setDraft({
              ...draft,
              downtime: [
                ...draft.downtime,
                {
                  startTime: draft.startTime,
                  endTime: draft.endTime,
                  reason: "",
                  planned: false,
                },
              ],
            })
          }
        >
          <Plus className="mr-1 size-3" />
          Add stop
        </Button>
      </fieldset>
      <label className="grid gap-1 text-sm">
        Evidence / source record
        <textarea
          className="workspace-control min-h-20"
          required
          maxLength={2000}
          value={draft.evidence}
          onChange={(e) => setDraft({ ...draft, evidence: e.target.value })}
          placeholder="Shift log, batch sheet or measurement record used for these inputs"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          checked={draft.complete}
          onChange={(e) => setDraft({ ...draft, complete: e.target.checked })}
        />
        The state and count records cover the complete entered period.
      </label>
      <Button disabled={save.isPending} type="submit">
        {save.isPending ? "Recording…" : "Record production evidence"}
      </Button>
    </form>
  );
}

function HandoverForm({
  data,
  factoryId,
  contextAsset,
  onSaved,
}: {
  data: OperationsSummary;
  factoryId?: string;
  contextAsset?: { ref: string; name: string };
  onSaved: () => Promise<unknown>;
}) {
  const [text, setText] = useState(""),
    [nextStep, setNextStep] = useState(""),
    [incident, setIncident] = useState("");
  const save = trpc.operations.addHandover.useMutation({
    onSuccess: async () => {
      setText("");
      setNextStep("");
      toast.success("Shift handover recorded");
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });
  const incidents = [
    ...new Map(data.outstanding.map((a) => [a.incidentId, a])).values(),
  ];
  return (
    <form
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          factoryId,
          expectedVersion: data.version,
          at: data.shift.startTime,
          text,
          nextStep,
          assetRefs: contextAsset ? [contextAsset.ref] : [],
          incidentIds: incident ? [Number(incident)] : [],
        });
      }}
    >
      <h4 className="font-medium">Add to {data.shift.name}</h4>
      {contextAsset && (
        <p className="text-sm text-muted-foreground">
          Related equipment: {contextAsset.name}
        </p>
      )}
      <label className="grid gap-1 text-sm">
        What happened / current limitations
        <textarea
          className="workspace-control min-h-20"
          required
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Next investigation step
        <textarea
          className="workspace-control min-h-16"
          required
          maxLength={1000}
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
        />
      </label>
      {incidents.length > 0 && (
        <label className="grid gap-1 text-sm">
          Related incident
          <select
            className="workspace-control"
            value={incident}
            onChange={(e) => setIncident(e.target.value)}
          >
            <option value="">No incident link</option>
            {incidents.map((a) => (
              <option key={a.incidentId} value={a.incidentId}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        className="justify-self-start"
        type="submit"
        disabled={save.isPending}
      >
        {save.isPending ? "Recording…" : "Record handover"}
      </Button>
    </form>
  );
}

export function OperationsPanel({
  factoryId,
  compact = false,
  scenario: controlledScenario,
  onScenarioChange,
  startTime,
  endTime,
  contextAsset,
}: {
  factoryId?: string;
  compact?: boolean;
  scenario?: OperationScenario;
  onScenarioChange?: (scenario: OperationScenario) => void;
  startTime?: number;
  endTime?: number;
  contextAsset?: { ref: string; name: string };
}) {
  const { user } = useAuth(),
    active = useDocumentActive();
  const [localScenario, setLocalScenario] =
      useState<OperationScenario>("healthy"),
    [at, setAt] = useState<number | undefined>(),
    [tab, setTab] = useState<"summary" | "records" | "handover" | "settings">(
      "summary",
    );
  const scenario = controlledScenario ?? localScenario;
  const query = trpc.operations.summary.useQuery(
    {
      factoryId,
      at,
      scenario,
      ...(startTime != null &&
      endTime != null &&
      endTime - startTime <= 7 * 86400000
        ? { startTime, endTime }
        : {}),
    },
    { staleTime: 15000, refetchInterval: active ? 60000 : false, retry: false },
  );
  const data = query.data,
    refresh = async () => query.refetch();
  if (query.error)
    return (
      <section
        className="rounded-lg border p-4"
        aria-label="Operations and handover"
      >
        <h2 className="font-semibold">Operations and handover</h2>
        <p className="my-2 text-sm" role="alert">
          {query.error.message}
        </p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          Retry
        </Button>
      </section>
    );
  if (!data)
    return (
      <section
        className="rounded-lg border p-4"
        aria-label="Operations and handover"
      >
        <p role="status" className="text-sm text-muted-foreground">
          Loading shift and production evidence…
        </p>
      </section>
    );
  const canEngineer = !!user?.access?.canEngineer && !data.demo,
    canOperate = !!user?.access?.canOperate && !data.demo;
  const analysis = data.analysis;
  const entries = [
    {
      label: "OEE",
      value: percent(analysis.oee),
      detail: "Availability × performance × quality",
    },
    {
      label: "Recorded unplanned downtime",
      value:
        analysis.unplannedDowntimeSeconds == null
          ? "Unavailable"
          : `${decimal(analysis.unplannedDowntimeSeconds / 60)} min`,
      detail: "Union of recorded stops; planned shutdowns excluded",
    },
    {
      label: `Energy / good ${data.configuration.countUnit === "units" ? "unit" : data.configuration.countUnit}`,
      value:
        analysis.energyPerGoodUnit == null
          ? "Unavailable"
          : `${decimal(analysis.energyPerGoodUnit, 3)} kWh`,
      detail: "Aligned production and meter boundary",
    },
    {
      label: "Recorded coverage",
      value: `${decimal(analysis.coveragePercent)}%`,
      detail: data.demo
        ? "Simulated period coverage"
        : "Coverage of manually recorded periods",
    },
  ];
  return (
    <section
      className="min-w-0 space-y-4 rounded-xl border bg-card p-3 sm:p-4"
      data-testid="ot-operations"
      aria-label="Operations and handover"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Activity className="size-4" />
            Operations and handover
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.scope.label} ·{" "}
            {data.demo ? "Simulated" : "Manual production evidence"} ·{" "}
            {data.shift.timeZone}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={query.isFetching}
          aria-label="Refresh operations"
        >
          <RefreshCw
            className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
          />
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Clock3 className="size-4" />
        <span>
          {data.shift.name}: {date(data.shift.startTime, data.shift.timeZone)} –{" "}
          {date(data.shift.endTime, data.shift.timeZone)}
        </span>
        {!data.demo && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Previous shift"
              onClick={() => setAt(data.shift.startTime - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAt(undefined)}>
              Current shift
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next shift"
              disabled={data.shift.endTime > Date.now()}
              onClick={() => setAt(data.shift.endTime)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {data.demo && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Recorded scenario
          <select
            className="workspace-control max-w-72"
            value={scenario}
            onChange={(e) => {
              const next = e.target.value as OperationScenario;
              setLocalScenario(next);
              onScenarioChange?.(next);
            }}
            aria-label="OT scenario"
          >
            {operationScenarios.map((key) => (
              <option key={key} value={key}>
                {operationScenarioLabels[key]}
              </option>
            ))}
          </select>
        </label>
      )}
      {!data.configured && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs sm:p-3 sm:text-sm">
          <div className="flex items-center justify-between gap-2 sm:block">
            <strong>Production boundary and shifts are not configured.</strong>
            {canEngineer && (
              <Button
                className="min-h-11 shrink-0 sm:hidden"
                size="sm"
                variant="outline"
                aria-label="Configure operations"
                onClick={() => setTab("settings")}
              >
                Configure
              </Button>
            )}
          </div>
          <details className="sm:hidden">
            <summary className="min-h-11 cursor-pointer py-3">
              Setup details
            </summary>
            <p className="pb-1 text-muted-foreground">
              Set the site timezone, shift starts and measurement boundary
              before recording production or handover. UTC defaults are
              provisional.
            </p>
          </details>
          <p className="mt-1 hidden text-muted-foreground sm:block">
            Set the site timezone, shift starts and measurement boundary before
            recording production or handover. UTC defaults are provisional.
          </p>
          {canEngineer && (
            <Button
              className="mt-2 hidden sm:inline-flex"
              size="sm"
              variant="outline"
              onClick={() => setTab("settings")}
            >
              Configure operations
            </Button>
          )}
        </div>
      )}
      <nav className="flex flex-wrap gap-1" aria-label="Operations sections">
        {(
          [
            {
              id: "summary",
              label:
                data.demo || (startTime != null && endTime != null)
                  ? "Period summary"
                  : "Shift summary",
              icon: Activity,
            },
            { id: "records", label: "Inputs and losses", icon: ClipboardList },
            { id: "handover", label: "Handover", icon: Clock3 },
            ...(canEngineer
              ? [{ id: "settings", label: "Settings", icon: Settings2 }]
              : []),
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id as typeof tab)}
          >
            <item.icon className="mr-1 size-3.5" />
            {item.label}
          </Button>
        ))}
      </nav>
      {tab === "summary" && (
        <>
          <p className="text-xs text-muted-foreground">
            Analysis window: {date(analysis.startTime, data.shift.timeZone)} –{" "}
            {date(analysis.endTime, data.shift.timeZone)}
          </p>
          <div className="operations-metrics grid gap-2 min-[360px]:grid-cols-2 xl:grid-cols-4">
            {entries.map((entry) => (
              <button
                key={entry.label}
                className="min-w-0 rounded-lg border p-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:p-3"
                onClick={() => setTab("records")}
              >
                <span className="block text-xs text-muted-foreground">
                  {entry.label}
                </span>
                <strong className="my-1 block text-lg sm:text-xl">
                  {entry.value}
                </strong>
                <span className="block text-[11px] leading-4 text-muted-foreground sm:text-xs">
                  {entry.detail}
                </span>
              </button>
            ))}
          </div>
          {analysis.reasons.length > 0 && (
            <details className="text-xs text-muted-foreground" open={!compact}>
              <summary className="cursor-pointer">
                Calculation limits ({analysis.reasons.length})
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {analysis.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
          {data.evidence && (
            <ScenarioEvidencePanel
              evidence={data.evidence}
              startTime={analysis.startTime}
              endTime={analysis.endTime}
            />
          )}
          {!data.evidence && (
            <p className="text-sm text-muted-foreground">
              {data.notes.length} handover notes in this or the previous shift ·{" "}
              {data.outstanding.length}
              {data.outstanding.length === 20 ? "+" : ""} outstanding actions
              now.{" "}
              <button
                className="text-primary underline"
                onClick={() => setTab("handover")}
              >
                Review handover
              </button>
            </p>
          )}
        </>
      )}
      {tab === "records" && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Availability", percent(analysis.availability)],
              ["Performance", percent(analysis.performance)],
              ["Quality", percent(analysis.quality)],
              [
                "Recorded total / good output",
                `${decimal(analysis.totalCount, 0)} / ${decimal(analysis.goodCount, 0)}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Availability = operating / planned production time. Performance =
            sum of each product’s ideal cycle × total count / operating time.
            Quality = good / total count. Rates are fractions; product mix is
            calculated from its periods. Overlapping stops are counted once;
            planned shutdown takes precedence and overlapping unplanned reasons
            use the earliest onset.
          </p>
          {analysis.reasons.map((reason) => (
            <p className="text-xs text-muted-foreground" key={reason}>
              {reason}
            </p>
          ))}
          {analysis.downtimeReasons.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Downtime reasons by duration
              </h3>
              {analysis.downtimeReasons.map((reason) => (
                <div
                  key={reason.reason}
                  className="rounded-md border p-2 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span>{reason.reason}</span>
                    <strong className="shrink-0">
                      {decimal(reason.seconds / 60)} min
                    </strong>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${(reason.seconds / (analysis.unplannedDowntimeSeconds || 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {reason.occurrences} recorded events · input records{" "}
                    {reason.recordIds.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Recorded input periods</h3>
            {!data.records.length && (
              <p className="text-sm text-muted-foreground">
                No production evidence is recorded for this window.
              </p>
            )}
            {data.records.map((record) => (
              <details
                key={record.id}
                className="rounded-lg border p-3"
                id={`production-record-${record.id}`}
              >
                <summary className="cursor-pointer text-sm">
                  <strong>{record.product}</strong> ·{" "}
                  {date(record.startTime, data.shift.timeZone)} –{" "}
                  {date(record.endTime, data.shift.timeZone)} ·{" "}
                  {record.provenance}
                </summary>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>
                    Boundary: {record.boundaryLabel} ·{" "}
                    {record.complete
                      ? "Complete period"
                      : "Incomplete evidence"}{" "}
                    · recorded by {record.author}
                  </p>
                  <p>
                    Total: {decimal(record.totalCount, 0)} · good:{" "}
                    {decimal(record.goodCount, 0)} · ideal cycle:{" "}
                    {decimal(record.idealCycleSeconds, 3)} s
                  </p>
                  <p>
                    Meter: {decimal(record.meterStartKwh, 3)} →{" "}
                    {decimal(record.meterEndKwh, 3)} kWh ·{" "}
                    {record.meterBoundary || "No meter boundary"}
                  </p>
                  <p>{record.evidence}</p>
                  {record.downtime.map((stop, i) => (
                    <p key={i}>
                      {stop.planned ? "Planned" : "Unplanned"}: {stop.reason} ·{" "}
                      {date(stop.startTime, data.shift.timeZone)} –{" "}
                      {date(stop.endTime, data.shift.timeZone)}
                    </p>
                  ))}
                </div>
              </details>
            ))}
          </div>
          {data.configured && canEngineer && (
            <ProductionForm
              key={`${data.scope.id}:${data.shift.key}:${data.records.length}`}
              data={data}
              factoryId={factoryId}
              onSaved={refresh}
            />
          )}
        </div>
      )}
      {tab === "handover" && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            This shift and previous-shift notes
          </h3>
          {!data.notes.length && (
            <p className="text-sm text-muted-foreground">
              No handover notes have been recorded for these shifts.
            </p>
          )}
          {data.notes.map((note) => (
            <article
              key={note.id}
              className="space-y-2 rounded-lg border p-3 text-sm"
            >
              <p className="text-xs text-muted-foreground">
                {note.shiftName} · {date(note.shiftStartTime, note.timeZone)} ·{" "}
                {note.timeZone} · {note.author} ·{" "}
                {date(note.createdAt, data.shift.timeZone)}
              </p>
              <p className="whitespace-pre-wrap">{note.text}</p>
              <p>
                <strong>Next step:</strong> {note.nextStep}
              </p>
              <div className="flex flex-wrap gap-3">
                {note.assetRefs.map((ref) => (
                  <Link
                    className="text-primary underline"
                    key={ref}
                    href={
                      data.evidence
                        ? `${itemHref(ref)}?${new URLSearchParams({
                            otScenario: data.evidence.scenario,
                            from: new Date(analysis.startTime).toISOString(),
                            to: new Date(analysis.endTime).toISOString(),
                          })}`
                        : itemHref(
                            ref,
                            "overview",
                            factoryId ? `/?factory=${factoryId}` : "/",
                          )
                    }
                  >
                    Related equipment
                  </Link>
                ))}
                {note.incidentIds.map((id) => (
                  <Link
                    className="text-primary underline"
                    key={id}
                    href={`/alerts?selected=${id}`}
                  >
                    Incident #{id}
                  </Link>
                ))}
              </div>
            </article>
          ))}
          {data.notesHasMore && (
            <p className="text-xs text-muted-foreground">
              Showing the latest 50 notes for these shifts. Earlier notes remain
              stored.
            </p>
          )}
          <h3 className="pt-2 text-sm font-medium">Outstanding actions now</h3>
          {data.outstanding.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No outstanding incident actions in this scope.
            </p>
          ) : (
            data.outstanding.map((action) => (
              <Link
                key={action.id}
                className="block rounded-lg border p-3 text-sm hover:bg-muted/40"
                href={`/alerts?selected=${action.incidentId}`}
              >
                <strong>{action.title}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {action.owner || "Unassigned"} ·{" "}
                  {action.status.replaceAll("_", " ")} ·{" "}
                  {action.dueDate ? `Due ${action.dueDate}` : "No due date"}
                </span>
              </Link>
            ))
          )}
          {data.configured && canOperate && (
            <HandoverForm
              key={`${data.scope.id}:${data.shift.key}`}
              data={data}
              factoryId={factoryId}
              contextAsset={contextAsset}
              onSaved={refresh}
            />
          )}
        </div>
      )}
      {tab === "settings" && canEngineer && (
        <SettingsForm
          key={`${data.scope.id}:${data.version}`}
          data={data}
          factoryId={factoryId}
          onSaved={refresh}
        />
      )}
    </section>
  );
}
