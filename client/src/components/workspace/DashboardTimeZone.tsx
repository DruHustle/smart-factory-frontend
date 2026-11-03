import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntimeCapability } from "@/components/RuntimeBoundary";
import { useFactorySelection } from "@/lib/factory-selection";
import { useWorkspaceLocation } from "@/lib/hashLocation";
import { trpc } from "@/lib/trpc";
import {
  operationScenarios,
  type OperationScenario,
} from "@shared/operation-scenarios";

/** Undefined outside the dashboard preserves each workspace's existing time policy. */
export const DashboardTimeZone = createContext<string | undefined>(undefined);
export const useDashboardTimeZone = () => useContext(DashboardTimeZone);

/** Share the selected factory's configured zone with telemetry and Overview. */
export function DashboardTimeZoneProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { id } = useFactorySelection();
  const { user } = useAuth();
  const supported = useRuntimeCapability("ot-site-timezone-v1");
  const [location] = useWorkspaceLocation();
  const requested = new URLSearchParams(location.split("?")[1] ?? "").get(
    "otScenario",
  );
  const scenario = operationScenarios.includes(requested as OperationScenario)
    ? (requested as OperationScenario)
    : "healthy";
  const operations = trpc.operations.summary.useQuery(
    {
      factoryId: user?.access?.demoOnly ? undefined : (id ?? undefined),
      scenario,
    },
    { enabled: supported && !!user, staleTime: 15000, retry: false },
  );
  return (
    <DashboardTimeZone.Provider value={operations.data?.configuration.timeZone}>
      {children}
    </DashboardTimeZone.Provider>
  );
}
