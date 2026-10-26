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
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
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
      <div className="max-w-full overflow-x-auto">
        <TabsList
          aria-label={label}
          className="h-auto min-h-10 justify-start gap-1 bg-transparent p-0"
        >
          {sections.map((s) => (
            <TabsTrigger
              className="min-h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-muted data-[state=active]:shadow-none"
              key={s.id}
              value={s.id}
            >
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children !== undefined && (
        <TabsContent className="mt-5 min-w-0" value={value}>
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
      className="rounded-lg border bg-card px-5 py-10 text-center"
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
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-600" : status === "error" || status === "offline" ? "bg-red-600" : status === "stale" ? "bg-amber-600" : "bg-slate-500"}`}
      />
      {status === "unknown" ? "Unknown · no current proof" : status}
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
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
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
        onClick={() => void navigator.clipboard.writeText(value)}
      >
        Copy
      </Button>
    </div>
  );
}
