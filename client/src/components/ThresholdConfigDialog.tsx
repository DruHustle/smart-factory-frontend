import { canonicalUnits } from "@shared/measurements";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Thermometer,
  Droplets,
  Activity,
  Zap,
  Gauge,
  Wind,
  RefreshCw,
} from "lucide-react";

type Metric =
  | "temperature"
  | "humidity"
  | "vibration"
  | "power"
  | "pressure"
  | "rpm";

interface ThresholdConfig {
  metric: Metric;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  warningMin: number | null;
  warningMax: number | null;
  enabled: boolean;
}

const metricConfig: Record<
  Metric,
  { label: string; unit: string; icon: React.ElementType; color: string }
> = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    icon: Thermometer,
    color: "text-chart-2",
  },
  humidity: {
    label: "Humidity",
    unit: "%",
    icon: Droplets,
    color: "text-chart-1",
  },
  vibration: {
    label: "Vibration",
    unit: "mm/s",
    icon: Activity,
    color: "text-chart-4",
  },
  power: { label: "Power", unit: "W", icon: Zap, color: "text-chart-5" },
  pressure: {
    label: "Pressure",
    unit: "Pa",
    icon: Gauge,
    color: "text-chart-3",
  },
  rpm: { label: "RPM", unit: "rpm", icon: Wind, color: "text-primary" },
};

interface ThresholdConfigDialogProps {
  deviceId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ThresholdConfigDialog({
  deviceId,
  open,
  onOpenChange,
}: ThresholdConfigDialogProps) {
  const [thresholds, setThresholds] = useState<ThresholdConfig[]>([]);
  const utils = trpc.useUtils();

  const { data: existingThresholds, isLoading } =
    trpc.thresholds.getForDevice.useQuery({ deviceId }, { enabled: open });

  const { data: device } = trpc.devices.getById.useQuery(
    { id: deviceId },
    { enabled: open },
  );

  const upsertMutation = trpc.thresholds.upsertForDevice.useMutation({
    onSuccess: () => {
      toast.success("Thresholds saved successfully");
      utils.thresholds.getForDevice.invalidate({ deviceId });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to save thresholds: ${error.message}`);
    },
  });

  useEffect(() => {
    if (existingThresholds && existingThresholds.length > 0) {
      setThresholds(
        existingThresholds.map((t) => ({
          metric: t.metric as Metric,
          unit: t.unit,
          minValue: t.minValue,
          maxValue: t.maxValue,
          warningMin: t.warningMin,
          warningMax: t.warningMax,
          enabled: t.enabled,
        })),
      );
    } else {
      // Initialize with default metrics based on device type
      const defaultMetrics: Metric[] = [
        "temperature",
        "humidity",
        "vibration",
        "power",
      ];
      setThresholds(
        defaultMetrics.map((metric) => ({
          metric,
          unit: canonicalUnits[metric],
          minValue: null,
          maxValue: null,
          warningMin: null,
          warningMax: null,
          enabled: true,
        })),
      );
    }
  }, [existingThresholds]);

  const updateThreshold = (
    metric: Metric,
    field: keyof ThresholdConfig,
    value: unknown,
  ) => {
    setThresholds((prev) =>
      prev.map((t) => (t.metric === metric ? { ...t, [field]: value } : t)),
    );
  };

  const handleSave = () => {
    const thresholdsToSave = thresholds.map((t) => ({
      deviceId,
      metric: t.metric,
      unit: t.unit ?? "",
      minValue: t.minValue,
      maxValue: t.maxValue,
      warningMin: t.warningMin,
      warningMax: t.warningMax,
      enabled: t.enabled,
    }));

    upsertMutation.mutate({ deviceId, thresholds: thresholdsToSave });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Alert Thresholds</DialogTitle>
          <DialogDescription>
            Set custom alert thresholds for {device?.name ?? "this device"}.
            Alerts will be triggered when sensor values exceed these limits.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {thresholds.map((threshold) => {
              const config = metricConfig[threshold.metric];
              const Icon = config.icon;

              return (
                <Card key={threshold.metric} className="border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        {config.label}
                        <span className="text-xs text-muted-foreground font-normal">
                          ({config.unit})
                        </span>
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`${threshold.metric}-enabled`}
                          className="text-sm"
                        >
                          Enabled
                        </Label>
                        <Switch
                          id={`${threshold.metric}-enabled`}
                          checked={threshold.enabled}
                          onCheckedChange={(checked) =>
                            updateThreshold(
                              threshold.metric,
                              "enabled",
                              checked,
                            )
                          }
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent
                    className={threshold.enabled ? "" : "opacity-50"}
                  >
                    {threshold.unit !== canonicalUnits[threshold.metric] && (
                      <div className="mb-4 rounded-md border border-warning p-3 text-sm">
                        <p>
                          Existing limits have no verified unit. Review their
                          values in {canonicalUnits[threshold.metric]}; no
                          automatic conversion is applied.
                        </p>
                        <Button
                          className="mt-2"
                          variant="outline"
                          onClick={() =>
                            updateThreshold(
                              threshold.metric,
                              "unit",
                              canonicalUnits[threshold.metric],
                            )
                          }
                        >
                          Confirm {canonicalUnits[threshold.metric]} limits
                          reviewed
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-destructive">
                          Critical Limits
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label
                              htmlFor={`${threshold.metric}-min`}
                              className="text-xs text-muted-foreground"
                            >
                              Min
                            </Label>
                            <Input
                              id={`${threshold.metric}-min`}
                              type="number"
                              placeholder="Min"
                              value={threshold.minValue ?? ""}
                              onChange={(e) =>
                                updateThreshold(
                                  threshold.metric,
                                  "minValue",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null,
                                )
                              }
                              disabled={!threshold.enabled}
                              className="h-8"
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor={`${threshold.metric}-max`}
                              className="text-xs text-muted-foreground"
                            >
                              Max
                            </Label>
                            <Input
                              id={`${threshold.metric}-max`}
                              type="number"
                              placeholder="Max"
                              value={threshold.maxValue ?? ""}
                              onChange={(e) =>
                                updateThreshold(
                                  threshold.metric,
                                  "maxValue",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null,
                                )
                              }
                              disabled={!threshold.enabled}
                              className="h-8"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-warning">
                          Warning Limits
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label
                              htmlFor={`${threshold.metric}-warn-min`}
                              className="text-xs text-muted-foreground"
                            >
                              Min
                            </Label>
                            <Input
                              id={`${threshold.metric}-warn-min`}
                              type="number"
                              placeholder="Min"
                              value={threshold.warningMin ?? ""}
                              onChange={(e) =>
                                updateThreshold(
                                  threshold.metric,
                                  "warningMin",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null,
                                )
                              }
                              disabled={!threshold.enabled}
                              className="h-8"
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor={`${threshold.metric}-warn-max`}
                              className="text-xs text-muted-foreground"
                            >
                              Max
                            </Label>
                            <Input
                              id={`${threshold.metric}-warn-max`}
                              type="number"
                              placeholder="Max"
                              value={threshold.warningMax ?? ""}
                              onChange={(e) =>
                                updateThreshold(
                                  threshold.metric,
                                  "warningMax",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null,
                                )
                              }
                              disabled={!threshold.enabled}
                              className="h-8"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              upsertMutation.isPending ||
              isLoading ||
              thresholds.some((t) => t.unit !== canonicalUnits[t.metric])
            }
          >
            {upsertMutation.isPending ? "Saving..." : "Save Thresholds"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
