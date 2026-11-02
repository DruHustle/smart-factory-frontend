import { useAuth } from "@/contexts/AuthContext";
import { useRuntimeCapability } from "@/components/RuntimeBoundary";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { analysisRange } from "@/lib/analysis-range";
import { trpc } from "@/lib/trpc";
import { operationScenarios, type OperationScenario } from "@shared/operations";
import { OperationsPanel, ScenarioEvidencePanel } from "./OperationsPanel";
import { Button } from "@/components/ui/button";

/** One URL identifies a recorded scenario throughout the investigation. */
export function OperationsWorkspace({
  factoryId,
  compact,
  scenarioOnly = false,
  window: selectedWindow,
  contextAsset,
}: {
  factoryId?: string;
  compact?: boolean;
  scenarioOnly?: boolean;
  window?: { startTime: number; endTime: number };
  contextAsset?: { ref: string; name: string };
}) {
  const { user } = useAuth(),
    supported = useRuntimeCapability("ot-operations-v1");
  const [location, navigate] = useWorkspaceLocation();
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const value = params.get("otScenario");
  const scenario = operationScenarios.includes(value as OperationScenario)
    ? (value as OperationScenario)
    : "healthy";
  const demo = !!user?.access?.demoOnly;
  const range = analysisRange(params, Date.now(), "1h");
  const window =
    selectedWindow ??
    (range.custom
      ? { startTime: range.startTime, endTime: range.endTime }
      : undefined);
  const invalid =
    !!window &&
    (!Number.isFinite(window.startTime) ||
      !Number.isFinite(window.endTime) ||
      window.startTime <= 0 ||
      window.endTime <= window.startTime ||
      window.endTime - window.startTime > 7 * 86400000);
  const enabled = supported && demo && scenarioOnly && !!value && !invalid;
  const query = trpc.operations.summary.useQuery(
    { scenario, ...window },
    { enabled, retry: false, staleTime: 60000 },
  );
  if (scenarioOnly && (!demo || !value)) return null;
  if (!supported)
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">
        Operations and handover are unavailable on this API version.
      </p>
    );
  if (value && !operationScenarios.includes(value as OperationScenario))
    return (
      <p role="alert" className="rounded-lg border p-3 text-sm">
        This recorded scenario is unavailable. Select a scenario in Overview.
      </p>
    );
  if (invalid)
    return (
      <p role="status" className="rounded-lg border p-3 text-sm">
        Production and utility analysis requires a complete window of up to
        seven days. The observation charts retain their separate range.
      </p>
    );
  if (scenarioOnly) {
    if (query.error)
      return (
        <div role="alert" className="rounded-lg border p-3 text-sm">
          Scenario evidence is unavailable.{" "}
          <Button variant="link" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      );
    if (!query.data?.evidence)
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the selected recorded scenario…
        </p>
      );
    return (
      <ScenarioEvidencePanel
        evidence={query.data.evidence}
        startTime={query.data.analysis.startTime}
        endTime={query.data.analysis.endTime}
      />
    );
  }
  return (
    <OperationsPanel
      factoryId={demo ? undefined : factoryId}
      compact={compact}
      scenario={scenario}
      {...window}
      contextAsset={contextAsset}
      onScenarioChange={(next) => {
        const query = new URLSearchParams(params);
        query.set("otScenario", next);
        navigate(location.split("?")[0] + "?" + query);
      }}
    />
  );
}
