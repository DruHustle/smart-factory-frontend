import { sourceUnits, type Metric } from "@shared/measurements";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { edgeTagMappingsSchema } from "@shared/edge-configuration";
type Mapping = Record<string, unknown>;
function parse(value: string): Mapping[] {
  try {
    const j = JSON.parse(value || "[]");
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
const selectClass =
  "mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm";
export function MetricMappingEditor({
  value,
  onChange,
  protocol,
}: {
  value: string;
  onChange: (v: string) => void;
  protocol: string;
}) {
  const rows = parse(value);
  const valid = edgeTagMappingsSchema.safeParse(rows);
  function change(i: number, key: string, v: unknown) {
    const next = rows.map((row, n) => (n === i ? { ...row, [key]: v } : row));
    onChange(JSON.stringify(next));
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Telemetry field mappings</legend>
      {rows.map((r, i) => (
        <div className="grid gap-3 rounded border p-3 sm:grid-cols-2" key={i}>
          <label className="text-xs">
            Metric
            <select
              aria-label={`Mapping ${i + 1} metric`}
              className={selectClass}
              value={String(r.metric ?? "temperature")}
              onChange={(e) => change(i, "metric", e.target.value)}
            >
              {[
                "temperature",
                "humidity",
                "vibration",
                "power",
                "pressure",
                "rpm",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Source field / tag
            <Input
              aria-label={`Mapping ${i + 1} source`}
              value={String(r.source ?? r.name ?? "")}
              onChange={(e) => change(i, "source", e.target.value)}
              maxLength={128}
            />
          </label>
          <label className="text-xs">
            Engineering unit
            <select aria-label={`Mapping ${i+1} unit`} className={selectClass} value={String(r.unit??"")} onChange={e=>change(i,"unit",e.target.value)}><option value="">Unknown / unclassified</option>{sourceUnits[(r.metric??"temperature") as Metric]?.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select>
          </label>
          {protocol === "opcua" && (
            <label className="text-xs">
              OPC UA node ID
              <Input
                value={String(r.nodeId ?? "")}
                onChange={(e) => change(i, "nodeId", e.target.value)}
                maxLength={512}
              />
            </label>
          )}
          {protocol.startsWith("modbus") && (
            <>
              <label className="text-xs">
                Register address
                <Input
                  type="number"
                  min={0}
                  max={65535}
                  value={Number(r.address ?? 0)}
                  onChange={(e) => change(i, "address", Number(e.target.value))}
                />
              </label>
              <label className="text-xs">
                Register type
                <select
                  className={selectClass}
                  value={String(r.registerType ?? "holding_register")}
                  onChange={(e) => change(i, "registerType", e.target.value)}
                >
                  <option value="holding_register">Holding</option>
                  <option value="input_register">Input</option>
                </select>
              </label>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange(JSON.stringify(rows.filter((_, n) => n !== i)))
            }
          >
            Remove mapping {i + 1}
          </Button>
        </div>
      ))}
      {!valid.success && (
        <p role="alert" className="text-sm text-destructive">
          {valid.error.issues.map((e) => e.message).join("; ")}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={rows.length >= 100}
        onClick={() =>
          onChange(
            JSON.stringify([
              ...rows,
              { metric: "temperature", source: "temperature", unit: "Cel" },
            ]),
          )
        }
      >
        Add metric mapping
      </Button>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Advanced mapping JSON
        </summary>
        <Textarea
          aria-label="Advanced mapping JSON"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 min-h-28 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Protocol-specific scale, offset and register settings are preserved
          and validated by the service.
        </p>
      </details>
    </fieldset>
  );
}
export function EquipmentBindingEditor({
  value,
  onChange,
  components,
}: {
  value: string;
  onChange: (s: string) => void;
  components: { templateComponentId: string; name: string }[];
}) {
  const rows = parse(value);
  const metrics = {
    temperature: ["temperature", "Cel"],
    pressure: ["pressure", "bar"],
    rpm: ["rotational_speed", "1/min"],
    vibration: ["vibration_velocity", "mm/s"],
  } as const;
  function change(i: number, v: Mapping) {
    onChange(
      JSON.stringify(rows.map((r, n) => (n === i ? { ...r, ...v } : r))),
    );
  }
  return (
    <fieldset className="space-y-3 sm:col-span-2">
      <legend className="text-sm font-medium">
        Source metrics → installed components
      </legend>
      <p className="text-xs text-muted-foreground">
        Choose explicit targets and verify source units. Mappings do not
        identify equipment automatically.
      </p>
      {rows.map((r, i) => (
        <div className="grid gap-3 rounded border p-3 sm:grid-cols-2" key={i}>
          <label className="text-xs">
            Source metric
            <select
              className={selectClass}
              value={String(r.sourceKey)}
              onChange={(e) => {
                const key = e.target.value as keyof typeof metrics;
                change(i, {
                  sourceKey: key,
                  meaning: metrics[key][0],
                  unit: metrics[key][1],
                  sourceUnit: metrics[key][1],
                });
              }}
            >
              {Object.keys(metrics).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Target component
            <select
              required
              className={selectClass}
              value={String(r.templateComponentId ?? "")}
              onChange={(e) =>
                change(i, { templateComponentId: e.target.value })
              }
            >
              <option value="">Select a component</option>
              {components.map((c) => (
                <option
                  key={c.templateComponentId}
                  value={c.templateComponentId}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Source unit
            <select
              className={selectClass}
              value={String(r.sourceUnit ?? r.unit)}
              onChange={(e) => change(i, { sourceUnit: e.target.value })}
            >
              {[
                String(r.unit),
                ...(r.sourceKey === "pressure" ? ["Pa"] : []),
              ].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Expected sample interval (ms)
            <Input
              required
              type="number"
              min={100}
              max={86400000}
              value={Number(r.expectedIntervalMs ?? 5000)}
              onChange={(e) =>
                change(i, { expectedIntervalMs: Number(e.target.value) })
              }
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              onChange(JSON.stringify(rows.filter((_, n) => n !== i)))
            }
          >
            Remove metric
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rows.length >= 4}
        onClick={() => {
          const key = (Object.keys(metrics) as (keyof typeof metrics)[]).find(
            (k) => !rows.some((r) => r.sourceKey === k),
          );
          if (key)
            onChange(
              JSON.stringify([
                ...rows,
                {
                  sourceKey: key,
                  meaning: metrics[key][0],
                  unit: metrics[key][1],
                  sourceUnit: metrics[key][1],
                  expectedIntervalMs: 5000,
                  templateComponentId: "",
                },
              ]),
            );
        }}
      >
        Add source metric
      </Button>
      <details>
        <summary className="cursor-pointer text-xs">
          Advanced binding JSON
        </summary>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Advanced equipment bindings"
          className="font-mono text-xs"
        />
      </details>
    </fieldset>
  );
}
