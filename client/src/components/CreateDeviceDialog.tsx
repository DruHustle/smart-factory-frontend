import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const deviceSchema = z
  .object({
    type: z.enum([
      "gateway",
      "edge_device",
      "sensor",
      "actuator",
      "controller",
    ]),
    route: z.enum(["direct", "gateway", "unconfigured"]),
    gatewayId: z.string().optional(),
    freshnessSeconds: z.number().int().min(5).max(86400).optional(),
    deviceId: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/,
        "Use 1–64 letters, numbers, dots, colons, underscores or hyphens",
      ),
    name: z
      .string()
      .trim()
      .min(3, "Name must be at least 3 characters")
      .max(255),
    location: z.string().trim().max(255).optional(),
    zone: z.string().trim().max(100).optional(),
  })
  .superRefine((v, c) => {
    if (v.route === "gateway" && !v.gatewayId)
      c.addIssue({
        code: "custom",
        path: ["gatewayId"],
        message: "Select a registered parent gateway",
      });
  });

type DeviceFormValues = z.infer<typeof deviceSchema>;

interface CreateDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialType?: "gateway" | "sensor";
  onCreated?: (device: { id: number }) => void;
}

export default function CreateDeviceDialog({
  open,
  onOpenChange,
  onSuccess,
  initialType = "gateway",
  onCreated,
}: CreateDeviceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const utils = trpc.useUtils();
  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceSchema),
    defaultValues: {
      type: initialType,
      route: "unconfigured",
      deviceId: "",
      name: "",
      location: "",
      zone: "",
    },
  });

  const gateways = trpc.devices.list.useQuery(
    { type: "gateway" },
    { enabled: open },
  );
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<{ id: number } | null>(null);
  const createMutation = trpc.devices.create.useMutation({
    onSuccess: (device) => {
      void utils.inventory.invalidate();
      setCreated(device);
      setStep(4);
      toast.success("Device registered");
      utils.devices.list.invalidate();
      utils.devices.getStats.invalidate();

      onSuccess?.();
    },
    onError: (error) =>
      toast.error(`Failed to register device: ${error.message}`),
    onSettled: () => setIsSubmitting(false),
  });

  const onSubmit = (values: DeviceFormValues) => {
    if (step < 3) {
      setStep((v) => v + 1);
      return;
    }
    if (created) return;
    setIsSubmitting(true);
    createMutation.mutate(values);
  };

  const isGateway = form.watch("type") === "gateway";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Register connectivity device</DialogTitle>
          <DialogDescription>
            Choose a device kind, then configure its supported route.
            Registration creates an identity record; it does not provision
            broker credentials.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Step {step + 1} of 5 ·{" "}
              {
                [
                  "Identity",
                  "Connection",
                  "Representation",
                  "Review",
                  "Registration result",
                ][step]
              }
            </p>
            <div hidden={step !== 0} className="space-y-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Device type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (
                          value === "gateway" &&
                          form.getValues("route") === "gateway"
                        ) {
                          form.setValue("route", "unconfigured");
                          form.setValue("gatewayId", undefined);
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="gateway">Gateway</SelectItem>
                        <SelectItem value="edge_device">Edge device</SelectItem>
                        <SelectItem value="sensor">Sensor</SelectItem>
                        <SelectItem value="actuator">Actuator</SelectItem>
                        <SelectItem value="controller">Controller</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deviceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isGateway ? "Gateway ID" : "Device ID"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          isGateway ? "pi-edge-01" : "edge-device-01"
                        }
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isGateway ? "Gateway name" : "Device name"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          isGateway ? "Plant A Gateway" : "Line 1 Edge Device"
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="zone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zone</FormLabel>
                      <FormControl>
                        <Input placeholder="Plant A" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="Control cabinet 1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            {step === 1 && (
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="route"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Connection route</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="unconfigured">
                            Not configured
                          </SelectItem>
                          <SelectItem value="direct">
                            Direct MQTT over TLS
                          </SelectItem>
                          {!isGateway && (
                            <SelectItem value="gateway">Via gateway</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {form.watch("route") === "gateway" && (
                  <FormField
                    control={form.control}
                    name="gatewayId"
                    rules={{ required: true }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent gateway</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a registered gateway" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {gateways.data
                              ?.filter((g) => !g.isDemo)
                              .map((g) => (
                                <SelectItem key={g.id} value={g.deviceId}>
                                  {g.name} · {g.deviceId}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="freshnessSeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Expected maximum sample age (seconds, optional)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={5}
                          max={86400}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            )
                          }
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Commission a policy for this device. Without one,
                        current availability remains unknown.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="rounded border p-3 text-sm">
                  Use the existing telemetry envelope with this exact device ID
                  {form.watch("route") === "gateway"
                    ? " and the selected gateway ID"
                    : ", omitting gatewayId for direct MQTT"}
                  . AAS attribution is optional. Configure device-scoped TLS
                  credentials and a broker topic ACL separately. No credentials
                  or configuration are sent to equipment by this form.
                </p>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">Optional representation</h3>
                <p className="text-sm text-muted-foreground">
                  This device works independently without an AAS or 3D model.
                  Register its identity first, then link an existing AAS asset
                  or create a separately reviewed 3D representation from the
                  item workspace. A representation does not establish a physical
                  connection.
                </p>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">Review registration</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                  <dt>Name / kind</dt>
                  <dd>
                    {form.watch("name")} · {form.watch("type")}
                  </dd>
                  <dt>Stable identity</dt>
                  <dd className="break-all">{form.watch("deviceId")}</dd>
                  <dt>Route</dt>
                  <dd>
                    {form.watch("route")}
                    {form.watch("gatewayId")
                      ? ` via ${form.watch("gatewayId")}`
                      : ""}
                  </dd>
                  <dt>Freshness</dt>
                  <dd>
                    {form.watch("freshnessSeconds")
                      ? `${form.watch("freshnessSeconds")} seconds`
                      : "Not commissioned; current availability unknown"}
                  </dd>
                  <dt>Representation</dt>
                  <dd>
                    Independent device. No AAS or 3D representation is created
                    automatically.
                  </dd>
                </dl>
              </div>
            )}
            {step === 4 && created && (
              <div
                role="status"
                className="space-y-3 rounded-md border border-info/40 bg-info/5 p-4"
              >
                <h3 className="font-medium">
                  Identity registered · observations not yet verified
                </h3>
                <p className="text-sm">
                  The software route was saved. Configure device-scoped broker
                  credentials and topic ACLs separately, publish and verify any
                  required gateway profile, then inspect the first eligible
                  acquisition. Saving this form did not contact equipment or
                  confirm a physical connection.
                </p>
              </div>
            )}
            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {created ? "Done" : "Cancel"}
              </Button>
              {step > 0 && step < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setStep((v) => v - 1)}
                >
                  Back
                </Button>
              )}
              {step < 3 ? (
                <Button
                  type="button"
                  onClick={async () => {
                    const keys =
                      step === 0
                        ? ["name", "deviceId", "type"]
                        : step === 1
                          ? ["route", "gatewayId", "freshnessSeconds"]
                          : [];
                    if (await form.trigger(keys as (keyof DeviceFormValues)[]))
                      setStep((v) => v + 1);
                  }}
                >
                  Next: {["connection", "representation", "review"][step]}
                </Button>
              ) : step === 3 ? (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? "Registering…"
                    : isGateway
                      ? "Register Gateway"
                      : "Register Device"}
                </Button>
              ) : created ? (
                <Button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onCreated?.(created);
                  }}
                >
                  Open item workspace
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
