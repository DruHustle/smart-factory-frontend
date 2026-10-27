import { CommissioningDialog } from "./CommissioningDialog";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { canViewEngineering } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export default function DeviceActions({
  id,
  name,
}: {
  id: number;
  name: string;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [commissioning, setCommissioning] = useState(false);
  const [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [value, setValue] = useState(name),
    [error, setError] = useState("");
  const utils = trpc.useUtils();
  const update = trpc.devices.update.useMutation({
    onSuccess: () => {
      void utils.inventory.invalidate();
      void utils.devices.invalidate();
      setEdit(false);
    },
    onError: (e) => setError(e.message),
  });
  const deletion = trpc.devices.delete.useMutation({
    onSuccess: () => {
      void utils.inventory.invalidate();
      void utils.devices.invalidate();
      navigate("/inventory");
    },
    onError: (e) => setError(e.message),
  });
  if (!user?.access?.canEngineer) return null;
  return (
    <>
      <CommissioningDialog
        id={id}
        open={commissioning}
        onOpenChange={setCommissioning}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Item actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setError("");
              setCommissioning(true);
            }}
          >
            Edit commissioning
          </DropdownMenuItem>
          {user?.role === "admin" && (
            <DropdownMenuItem
              onClick={() => {
                setError("");
                setRemove(true);
              }}
            >
              Delete device record
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={edit || remove}
        onOpenChange={(v) => {
          if (!v) {
            setEdit(false);
            setRemove(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {remove ? "Delete device record" : "Edit device name"}
            </DialogTitle>
            <DialogDescription>
              {remove
                ? `Remove ${name} from the registry? Linked assets must be disconnected first. Historical readings remain. This does not send a device command.`
                : "Update the display name. Stable identity and source observations remain unchanged."}
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <label className="text-sm">
              Device name
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={255}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEdit(false);
                setRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={remove ? "destructive" : "default"}
              disabled={
                update.isPending ||
                deletion.isPending ||
                (edit && !value.trim())
              }
              onClick={() =>
                remove
                  ? deletion.mutate({ id })
                  : update.mutate({ id, name: value.trim() })
              }
            >
              {remove ? "Delete record" : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
