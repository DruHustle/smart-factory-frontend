import { primaryDestinations, navigationGroups } from "@/lib/navigation";
import { NavigationLabel } from "./workspace/NavigationLabel";
import { DataWorkspaceSwitch } from "./DataWorkspaceSwitch";
import { trpc } from "@/lib/trpc";
import { useDocumentActive } from "@/hooks/useDocumentActive";
import { ThemeMenu } from "@/components/workspace/ThemeMenu";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { LogOut, PanelLeft, Factory, Bell, ChevronDown } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { safeLocalStorage } from "@/lib/storage";
import { hasMinimumRole } from "@/lib/access";

const menuItems = primaryDestinations;
const groups = navigationGroups;

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const SIDEBAR_COLLAPSED_GROUPS_KEY = "sidebar-collapsed-groups";
const DEFAULT_WIDTH = 232;
const MIN_WIDTH = 220;
const MAX_WIDTH = 240;

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
              Smart Factory Dashboard
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
    enabled: !!user,
    refetchInterval: documentActive ? 30000 : false,
    refetchIntervalInBackground: false,
  });
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  // Desktop collapse must never hide the expanded mobile drawer labels.
  const isCollapsed = !isMobile && state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previousLocationRef = useRef(location);
  const mobileDestinationSelected = useRef(false);
  const visibleMenuItems = menuItems;
  const isMenuItemActive = (path: string) =>
    path === "/"
      ? location === "/"
      : (path === "/inventory" &&
          /^\/(devices|assets|equipment|models)(\/|$)/.test(location)) ||
        location === path ||
        location.startsWith(`${path}/`);
  const activeMenuItem = [
    ...visibleMenuItems,
    ...groups.flatMap((g) => g.items),
  ].find((item) => isMenuItemActive(item.path));
  const pageTitle = location === "/notifications" ? "Notifications"
    : location === "/account/password" ? "Change password"
    : activeMenuItem?.label ?? "Factory workspace";
  const activeGroup = groups.find((group) =>
    group.items.some((item) => isMenuItemActive(item.path)),
  )?.label;
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        safeLocalStorage.getItem(SIDEBAR_COLLAPSED_GROUPS_KEY) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved.filter(
            (label): label is string =>
              typeof label === "string" &&
              groups.some((group) => group.label === label),
          )
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    safeLocalStorage.setItem(
      SIDEBAR_COLLAPSED_GROUPS_KEY,
      JSON.stringify(collapsedGroups),
    );
  }, [collapsedGroups]);

  // Reveal the current destination on direct entry and route changes. A user can
  // still close its group until the next navigation.
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsedGroups((current) =>
      current.includes(activeGroup)
        ? current.filter((label) => label !== activeGroup)
        : current,
    );
  }, [activeGroup, location]);

  function selectDestination() {
    if (!isMobile) return;
    mobileDestinationSelected.current = true;
    setOpenMobile(false);
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${pageTitle} | Smart Factory`;
    return () => {
      document.title = previousTitle;
    };
  }, [pageTitle]);

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
        (i.path !== "/demo" || user?.access?.demoOnly) &&
        (user?.access?.demoOnly ||
          !i.minRole ||
          hasMinimumRole(user?.role, i.minRole)),
    );
    if (!items.length) return null;
    const isOpen = !collapsedGroups.includes(group.label);
    return (
      <li className="list-none pt-3" key={group.label}>
        <Collapsible
          open={isOpen}
          onOpenChange={(open) =>
            setCollapsedGroups((current) =>
              open
                ? current.filter((label) => label !== group.label)
                : [...current, group.label],
            )
          }
        >
          <h2 className="mb-1">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                title={isCollapsed ? group.label : undefined}
                aria-label={group.label}
                className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <NavigationLabel
                  icon={group.icon}
                  label={group.label}
                  heading
                  collapsed={isCollapsed}
                />
                {!isCollapsed && (
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "" : "-rotate-90"}`}
                  />
                )}
              </button>
            </CollapsibleTrigger>
          </h2>
          <CollapsibleContent asChild>
            <ul className="space-y-1 pl-3 group-data-[collapsible=icon]:pl-0">
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
                      onClick={selectDestination}
                    >
                      <NavigationLabel
                        icon={item.icon}
                        label={item.label}
                        collapsed={isCollapsed}
                      />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
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
          role="navigation"
          collapsible="icon"
          className="border-r border-sidebar-border"
          disableTransition={isResizing}
          onMobileCloseAutoFocus={(event) => {
            if (!mobileDestinationSelected.current) return;
            mobileDestinationSelected.current = false;
            event.preventDefault();
            document.getElementById("dashboard-main")?.focus();
          }}
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
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
              {visibleMenuItems.map((item) => (
                <SidebarMenuItem key={item.path}>
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
                      onClick={selectDestination}
                    >
                      <NavigationLabel
                        icon={item.icon}
                        label={item.label}
                        heading
                        collapsed={isCollapsed}
                      />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
        <header className="sticky top-0 z-40 flex h-16 min-w-0 items-center justify-between gap-2 border-b bg-background/95 px-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-label="Toggle navigation" />
            <span className="truncate text-sm font-medium">
              {pageTitle}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DataWorkspaceSwitch />
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
        <div className="workspace-content min-w-0 flex-1 p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </>
  );
}
