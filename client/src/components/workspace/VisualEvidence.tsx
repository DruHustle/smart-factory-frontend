import { Link } from "wouter";
import {
  Box,
  Cpu,
  Factory,
  Fan,
  Wind,
  Cable,
  Gauge,
  Network,
  Radio,
  Settings,
  Thermometer,
  Waves,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useDocumentActive } from "@/hooks/useDocumentActive";

/** The same equipment vocabulary is used in inventory, observations and investigations. */
export function EquipmentSymbol({
  type = "",
  className = "size-6",
}: {
  type?: string;
  className?: string;
}) {
  const Icon = /network|route|mqtt/i.test(type)
    ? Network
    : /gateway/i.test(type)
      ? Radio
      : /temperature/i.test(type)
        ? Thermometer
        : /vibration/i.test(type)
          ? Waves
          : /pressure|compressor/i.test(type)
            ? Gauge
            : /pump/i.test(type)
              ? Fan
              : /wind/i.test(type)
                ? Wind
                : /transformer/i.test(type)
                  ? Cable
                  : /motor/i.test(type)
                    ? Settings
                    : /sensor|device|controller|actuator/i.test(type)
                      ? Cpu
                      : /equipment|3d/i.test(type)
                        ? Box
                        : Factory;
  return (
    <Icon aria-hidden className={`shrink-0 ${className}`} strokeWidth={1.6} />
  );
}

export type VisualSegment = {
  label: string;
  value: number;
  color: string;
  href?: string;
  onSelect?: () => void;
  actionLabel?: string;
  striped?: boolean;
};
/** Counts describe the complete stated API scope, never a client-side page prefix. */
export function StateDistribution({
  label,
  segments,
  noun = "sources",
}: {
  label: string;
  segments: VisualSegment[];
  noun?: string;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const patternId = `observation-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  let offset = 0;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <svg
        viewBox="0 0 200 200"
        className="mx-auto w-28 max-w-full sm:w-40"
        role="group"
        aria-label={label}
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect
              width="6"
              height="6"
              fill={
                segments.find((s) => s.striped)?.color ??
                "var(--muted-foreground)"
              }
            />
            <path d="M0 0V6" stroke="var(--card)" strokeWidth="2" />
          </pattern>
        </defs>
        <title>
          {label}: {segments.map((s) => `${s.label} ${s.value}`).join(", ")}
        </title>
        <circle
          cx="100"
          cy="100"
          r="76"
          fill="none"
          stroke="var(--border)"
          strokeWidth="20"
        />
        {segments.map((s) => {
          const length = total ? (s.value / total) * 100 : 0;
          const circle = (
            <circle
              cx="100"
              cy="100"
              r="76"
              pathLength="100"
              fill="none"
              stroke={s.striped ? `url(#${patternId})` : s.color}
              strokeWidth="20"
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
            >
              <title>
                {s.label}: {s.value}
              </title>
            </circle>
          );
          offset += length;
          return length ? (
            s.href ? (
              <a
                key={s.label}
                href={`#${s.href}`}
                aria-label={`${s.label}: ${s.value} ${noun}`}
                className="outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring hover:opacity-80"
              >
                {circle}
              </a>
            ) : (
              <g
                key={s.label}
                onClick={s.onSelect}
                className={
                  s.onSelect ? "cursor-pointer hover:opacity-80" : undefined
                }
              >
                {circle}
              </g>
            )
          ) : null;
        })}
        <text
          x="100"
          y="99"
          textAnchor="middle"
          fill="var(--foreground)"
          fontSize="32"
          fontWeight="600"
        >
          {total}
        </text>
        <text
          x="100"
          y="122"
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize="13"
        >
          {noun}
        </text>
      </svg>
      <ul className="space-y-1 text-sm" aria-label={`${label} details`}>
        {segments.map((s) => {
          const content = (
            <>
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  background: s.striped
                    ? `repeating-linear-gradient(45deg,${s.color} 0px,${s.color} 2px,var(--card) 2px,var(--card) 3px)`
                    : s.color,
                }}
              />
              <span className="min-w-0 flex-1">{s.label}</span>
              <strong className="tabular-nums">{s.value}</strong>
            </>
          );
          return (
            <li key={s.label}>
              {s.href ? (
                <Link
                  href={s.href}
                  className="flex min-h-10 items-center gap-2 rounded px-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {content}
                </Link>
              ) : s.onSelect ? (
                <button
                  aria-label={s.actionLabel}
                  onClick={s.onSelect}
                  className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {content}
                </button>
              ) : (
                <span className="flex min-h-10 items-center gap-2 px-2">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type FlowNode = {
  label: string;
  detail?: string;
  href?: string;
  type?: string;
};
/** A recorded route, with no moving packets or implicit physical connectivity. */
export function EvidencePath({
  label,
  nodes,
}: {
  label: string;
  nodes: FlowNode[];
}) {
  return (
    <figure className="rounded-md border bg-info/5 p-3" aria-label={label}>
      <figcaption className="mb-3 text-xs font-medium text-muted-foreground">
        {label}
      </figcaption>
      <ol className="flex flex-wrap items-stretch gap-y-3">
        {nodes.map((node, i) => (
          <li
            key={`${i}:${node.label}`}
            className="flex min-w-0 flex-1 basis-32 items-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className="mx-2 w-5 shrink-0 border-t-2 border-info"
              />
            )}
            {node.href ? (
              <Link
                href={node.href}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded border bg-card p-2 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                <EquipmentSymbol
                  type={node.type}
                  className="size-5 text-info"
                />
                <span className="min-w-0 break-words text-sm font-medium">
                  {node.label}
                  {node.detail && (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {node.detail}
                    </span>
                  )}
                </span>
              </Link>
            ) : (
              <span className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded border bg-card p-2">
                <EquipmentSymbol
                  type={node.type}
                  className="size-5 text-info"
                />
                <span className="min-w-0 break-words text-sm font-medium">
                  {node.label}
                  {node.detail && (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {node.detail}
                    </span>
                  )}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** A finite emphasis for an actual eligible receipt; it never loops while stale/offline. */
export function ReceiptChange({
  at,
  eligible,
  children,
}: {
  at?: number | string | null;
  eligible: boolean;
  children: ReactNode;
}) {
  const active = useDocumentActive();
  return (
    <span
      key={at ?? "no-receipt"}
      className={eligible && active ? "receipt-change" : undefined}
    >
      {children}
    </span>
  );
}
