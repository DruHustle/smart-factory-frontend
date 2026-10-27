import { toast } from "sonner";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="workspace-page-header flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-sm text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="text-[26px] leading-tight font-[730] tracking-[-0.025em] break-words">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}
export function SectionNav({
  label,
  sections,
  value,
  onChange,
  children,
}: {
  label: string;
  sections: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  children?: ReactNode;
}) {
  if (!sections.length) return <>{children}</>;
  return (
    <Tabs value={value} onValueChange={onChange} className="min-w-0">
      <select
        aria-label={label}
        className="workspace-control font-medium lg:hidden"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.label}
          </option>
        ))}
      </select>
      <div className="hidden max-w-full overflow-x-auto lg:block">
        <TabsList
          aria-label={label}
          className="h-auto min-h-10 justify-start gap-4 rounded-none border-b bg-transparent p-0"
        >
          {sections.map((s) => (
            <TabsTrigger
              className="min-h-10 rounded-none border-b-2 border-transparent px-1 text-[13px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
              key={s.id}
              value={s.id}
            >
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children !== undefined && (
        <TabsContent
          className="mt-4 min-w-0"
          value={value}
          aria-label={sections.find((section) => section.id === value)?.label}
        >
          {children}
        </TabsContent>
      )}
    </Tabs>
  );
}
export function EmptyState({
  title,
  description,
  action,
  error = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className="rounded-lg border bg-card px-5 py-7 text-center"
    >
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 text-xs font-medium capitalize">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-600" : status === "error" || status === "offline" ? "bg-red-600" : status === "stale" ? "bg-amber-600" : "bg-slate-500"}`}
      />
      {status === "live" ? "Receiving" : status}
    </Badge>
  );
}
export function SampleTime({
  value,
  historical = false,
}: {
  value?: string | number | null;
  historical?: boolean;
}) {
  if (value == null)
    return <span className="text-muted-foreground">No observations</span>;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return <span>Unknown time</span>;
  const age = Math.max(0, Date.now() - d.getTime());
  const relative =
    age < 60000
      ? "just now"
      : age < 3600000
        ? `${Math.floor(age / 60000)} min ago`
        : age < 86400000
          ? `${Math.floor(age / 3600000)} hr ago`
          : `${Math.floor(age / 86400000)} days ago`;
  const full = d.toLocaleString(undefined, { timeZoneName: "long" });
  return (
    <time
      dateTime={d.toISOString()}
      title={full}
      aria-label={`${historical ? "Historical sample, " : ""}${full}`}
    >
      {historical ? "Historical · " : ""}
      {relative}
    </time>
  );
}
export function FilterToolbar({ children }: { children: ReactNode }) {
  return (
    <div
      role="search"
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 [&>label]:flex [&>label]:min-w-0 [&>label]:flex-col [&>label]:gap-1.5 [&>label]:text-xs"
    >
      {children}
    </div>
  );
}
export function CopyIdentifier({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 break-all text-xs text-muted-foreground">
        {value}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Copy full identifier"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success("Identifier copied");
          } catch {
            toast.error(
              "Clipboard unavailable. Select and copy the complete identifier.",
            );
          }
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function SummaryMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[28px] leading-tight font-semibold tabular-nums">
        {value ?? "—"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function Measurement({
  value,
  unit,
  unavailable = false,
}: {
  value?: number | null;
  unit?: string | null;
  unavailable?: boolean;
}) {
  if (unavailable || value == null || !Number.isFinite(value))
    return <span className="text-muted-foreground">Unavailable</span>;
  return (
    <span className="whitespace-nowrap font-medium tabular-nums">
      {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value,
      )}{" "}
      <span className="text-xs font-normal text-muted-foreground">
        {unit || "unit unverified"}
      </span>
    </span>
  );
}
