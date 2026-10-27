import { trpc } from "@/lib/trpc";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { ThemeMenu } from "@/components/workspace/ThemeMenu";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Activity,
  Cpu,
  AlertTriangle,
  BarChart3,
  Bot,
  Download,
  Factory,
  Layers,
  Users,
  Bell,
  Plug,
  ShieldCheck,
} from "lucide-react";
import { Fragment, CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { safeLocalStorage } from "@/lib/storage";
import { hasMinimumRole } from "@/lib/access";

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: Layers, label: "Assets & devices", path: "/inventory" },
];
// Keep all five uppercase destinations/section labels at the established section size.
const navigationHeadingTypography =
  "text-xs font-medium tracking-normal leading-4 uppercase";
const groups: {
  label: string;
  items: {
    icon: typeof Activity;
    label: string;
    path: string;
    minRole?: "engineer" | "admin";
  }[];
}[] = [
  {
    label: "OPERATIONS",
    items: [
      { icon: Activity, label: "Monitoring", path: "/monitoring" },
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
    label: "INSIGHTS",
    items: [{ icon: BarChart3, label: "Analytics", path: "/analytics" }],
  },
  {
    label: "WORKSPACE",
    items: [
      { icon: Bot, label: "Assistant", path: "/assistant" },
      {
        icon: Plug,
        label: "Administration",
        path: "/administration",
        minRole: "engineer",
      },
    ],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 224;
const MAX_WIDTH = 248;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = safeLocalStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = saved ? Number.parseInt(saved, 10) : DEFAULT_WIDTH;
    return Number.isFinite(parsed)
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed))
      : DEFAULT_WIDTH;
  });
  const { isLoading, user } = useAuth();

  useEffect(() => {
    safeLocalStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (isLoading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
              <Factory className="h-12 w-12 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-center text-foreground">
              Smart Factory IoT Dashboard
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Monitor and manage your industrial IoT devices with real-time
              analytics and alerts.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full"
          >
            Sign in to continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  sidebarWidth,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const documentActive = useDocumentActive();
  const inbox = trpc.notifications.summary.useQuery(undefined, {
    enabled: !!user && !user.access?.demoOnly,
    refetchInterval: documentActive ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, setOpenMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previousLocationRef = useRef(location);
  const visibleMenuItems = menuItems;
  const isMenuItemActive = (path: string) =>
    path === "/"
      ? location === "/"
      : (path === "/inventory" &&
          /^\/(devices|assets|equipment)(\/|$)/.test(location)) ||
        location === path ||
        location.startsWith(`${path}/`);
  const activeMenuItem = [
    ...visibleMenuItems,
    ...groups.flatMap((g) => g.items),
  ].find((item) => isMenuItemActive(item.path));
  const isMobile = useIsMobile();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${activeMenuItem?.label ?? "Factory workspace"} | Smart Factory IoT`;
    return () => {
      document.title = previousTitle;
    };
  }, [activeMenuItem?.label]);

  useEffect(() => {
    if (previousLocationRef.current.split("?")[0] !== location.split("?")[0]) {
      document.getElementById("dashboard-main")?.focus();
    }
    previousLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  function renderGroup(group: (typeof groups)[number]) {
    const items = group.items.filter(
      (i) =>
        (!i.minRole || hasMinimumRole(user?.role, i.minRole)) &&
        (!["/administration", "/ota"].includes(i.path) ||
          !user?.access?.demoOnly),
    );
    if (!items.length) return null;
    return (
      <li className="list-none pt-4" key={group.label}>
        <h2
          data-navigation-heading
          className={`mb-2 px-3 ${navigationHeadingTypography} text-muted-foreground ${isCollapsed ? "sr-only" : ""}`}
        >
          {group.label}
        </h2>
        <ul className="space-y-1">
          {items.map((item) => (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton
                asChild
                tooltip={item.label}
                className="h-10"
                isActive={isMenuItemActive(item.path)}
              >
                <Link
                  href={item.path}
                  aria-label={item.label}
                  aria-current={
                    isMenuItemActive(item.path) ? "page" : undefined
                  }
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </ul>
      </li>
    );
  }

  return (
    <>
      <a
        href="#dashboard-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("dashboard-main")?.focus();
        }}
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          aria-label="Primary navigation"
          collapsible="icon"
          className="border-r border-sidebar-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-sidebar-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-sidebar-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                    <Factory className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sidebar-foreground">
                    Smart Factory
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-1 py-3">
            <SidebarMenu className="px-2">
              {visibleMenuItems.map((item, index) => (
                <Fragment key={item.path}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isMenuItemActive(item.path)}
                      tooltip={item.label}
                      className="h-10"
                    >
                      <Link
                        href={item.path}
                        aria-label={item.label}
                        aria-current={
                          isMenuItemActive(item.path) ? "page" : undefined
                        }
                        onClick={() => {
                          if (isMobile) setOpenMobile(false);
                        }}
                      >
                        <item.icon className="h-4 w-4" />
                        <span
                          data-navigation-heading
                          className={navigationHeadingTypography}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Fragment>
              ))}
              {groups.map(renderGroup)}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Open account menu"
                  className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-sidebar-accent transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar className="h-9 w-9 border border-sidebar-border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/20 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-sidebar-foreground">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {!user?.access?.demoOnly && (
                  <DropdownMenuItem asChild>
                    <Link href="/account/password">Change password</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          role="separator"
          aria-label="Resize navigation"
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={isCollapsed || isMobile ? -1 : 0}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 focus:bg-primary/50 focus:outline-none transition-colors ${
            isCollapsed ? "hidden" : "hidden md:block"
          }`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          onKeyDown={(event) => {
            if (isCollapsed || isMobile) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const direction = event.key === "ArrowLeft" ? -10 : 10;
              setSidebarWidth(
                Math.min(
                  MAX_WIDTH,
                  Math.max(MIN_WIDTH, sidebarWidth + direction),
                ),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setSidebarWidth(MIN_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setSidebarWidth(MAX_WIDTH);
            }
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset
        id="dashboard-main"
        tabIndex={-1}
        className="min-w-0 max-w-full overflow-x-clip bg-background"
      >
        <header className="sticky top-0 z-40 flex h-14 min-w-0 items-center justify-between gap-2 border-b bg-background/95 px-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-label="Toggle navigation" />
            <span className="truncate text-sm font-medium">
              {activeMenuItem?.label ?? "Factory workspace"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeMenu />
            <Button asChild variant="ghost" size="icon">
              <Link
                href="/notifications"
                aria-label={`Notifications and history${inbox.data ? `, ${inbox.data.unread} unread` : inbox.error ? ", unread count unavailable" : ""}`}
              >
                <Bell className="h-5 w-5" />
                {inbox.data && inbox.data.unread > 0 && (
                  <span className="sr-only">{inbox.data.unread} unread</span>
                )}
              </Link>
            </Button>
          </div>
        </header>
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </>
  );
}
