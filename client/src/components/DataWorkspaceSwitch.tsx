import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import {
  dataWorkspaceCookie,
  requestedDataWorkspace,
} from "@shared/data-workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DataWorkspaceSwitch() {
  const { user, logout } = useAuth();
  const [switching, setSwitching] = useState(false);
  const canSwitch = !!user?.access?.canSwitchData;
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Data workspace"
        disabled={switching}
        title={
          canSwitch
            ? "Switch between isolated demonstration and operational data"
            : "Live data requires an individual operational account on a private installation"
        }
        value={
          user?.access?.demoOnly
            ? "demo"
            : (user?.access?.workspaceView ?? "configured")
        }
        className="h-9 w-28 rounded-md border border-input bg-card px-2 text-xs"
        onChange={(e) => {
          if (!canSwitch) return;
          const workspace = e.target.value;
          if (workspace !== "demo" && workspace !== "live") return;
          setSwitching(true);
          document.cookie = `${dataWorkspaceCookie}=${workspace}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          if (requestedDataWorkspace(document.cookie) !== workspace) {
            setSwitching(false);
            toast.error(
              "Your browser could not save the data view. Allow cookies for this site and try again.",
            );
            return;
          }
          // Replace stale item/3D filters before one full reload. Scheduling a
          // navigation and a reload together could cancel either operation and
          // leave authentication, cached queries and the selected view at odds.
          const overview = new URL(window.location.href);
          overview.search = "";
          overview.hash = "/";
          window.history.replaceState(null, "", overview);
          window.location.reload();
        }}
      >
        {canSwitch && user?.access?.workspaceView === "configured" && (
          <option value="configured" disabled>
            Workspace data
          </option>
        )}
        <option value="demo">Demo data</option>
        <option value="live" disabled={!canSwitch}>
          Live data
        </option>
      </select>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="About demo and live data"
          >
            <Info className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Demo and live data</DialogTitle>
            <DialogDescription>
              Demo shows isolated, read-only examples. Live shows the
              operational records your individual account is allowed to access.
            </DialogDescription>
          </DialogHeader>
          {canSwitch ? (
            <p className="text-sm text-muted-foreground">
              Choose a view in the Data workspace selector. The factory overview
              reloads in that view and clears the previous view’s item selection
              and cached data. This does not change factory settings.
            </p>
          ) : (
            <>
              <p className="text-sm">
                You are signed in as{" "}
                {user?.name || user?.email || "a demo user"}. This session is
                restricted to demonstration data. Use an individual account on
                your operational installation to view live systems.
              </p>
              <Button onClick={() => void logout()}>
                Sign out and switch account
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
