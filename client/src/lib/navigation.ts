import {
  LayoutDashboard,
  Layers,
  Activity,
  AlertTriangle,
  Download,
  ShieldCheck,
  BarChart3,
  Bot,
  Factory,
  Plug,
  Workflow,
  ChartNoAxesCombined,
  PanelsTopLeft,
  Server,
  HeartPulse,
  Network,
  LayoutTemplate,
  type LucideIcon,
} from "lucide-react";

/** Every destination and group owns an outline icon; rendering never supplies a fallback. */
export type NavigationDestination = {
  icon: LucideIcon;
  label: string;
  path: string;
  minRole?: "engineer" | "admin";
};
export type NavigationGroup = {
  icon: LucideIcon;
  label: string;
  items: NavigationDestination[];
};
export const primaryDestinations: NavigationDestination[] = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: Layers, label: "Assets & devices", path: "/inventory" },
];
export const navigationGroups: NavigationGroup[] = [
  {
    icon: Workflow,
    label: "Operations",
    items: [
      { icon: Activity, label: "Monitoring", path: "/monitoring" },
      { icon: Network, label: "FX & TSN", path: "/network" },
      { icon: AlertTriangle, label: "Alerts", path: "/alerts" },
      {
        icon: Download,
        label: "Firmware & updates",
        path: "/ota",
        minRole: "engineer",
      },
      { icon: ShieldCheck, label: "Cybersecurity", path: "/cybersecurity" },
    ],
  },
  {
    icon: ChartNoAxesCombined,
    label: "Insights",
    items: [{ icon: BarChart3, label: "Analytics", path: "/analytics" }],
  },
  {
    icon: Server,
    label: "Infrastructure",
    items: [
      {
        icon: HeartPulse,
        label: "Service health",
        path: "/infrastructure/service-health",
        minRole: "admin",
      },
    ],
  },
  {
    icon: PanelsTopLeft,
    label: "Tools & settings",
    items: [
      { icon: Bot, label: "Assistant", path: "/assistant" },
      { icon: LayoutTemplate, label: "Factory layouts", path: "/layouts" },
      { icon: Factory, label: "Editable demo", path: "/sandbox" },
      { icon: Factory, label: "Demo guide", path: "/demo" },
      {
        icon: Plug,
        label: "Administration",
        path: "/administration",
        minRole: "engineer",
      },
    ],
  },
];
