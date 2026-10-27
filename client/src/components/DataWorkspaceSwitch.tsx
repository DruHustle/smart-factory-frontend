import { useAuth } from "@/contexts/AuthContext";
import { dataWorkspaceCookie } from "@shared/data-workspace";
export function DataWorkspaceSwitch() {
  const { user } = useAuth();
  const canSwitch = !!user?.access?.canSwitchData;
  return (
    <select
      aria-label="Data workspace"
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
        document.cookie = `${dataWorkspaceCookie}=${e.target.value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        window.location.assign("/#/");
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
  );
}
