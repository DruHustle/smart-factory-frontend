import { createContext, useContext } from "react";

/** Undefined outside the dashboard preserves each workspace's existing time policy. */
export const DashboardTimeZone = createContext<string | undefined>(undefined);
export const useDashboardTimeZone = () => useContext(DashboardTimeZone);
