import type { LucideIcon } from "lucide-react";
/** Shared by headings and destinations, including the collapsed and mobile surfaces. */
export function NavigationLabel({
  icon: Icon,
  label,
  heading = false,
  collapsed = false,
}: {
  icon: LucideIcon;
  label: string;
  heading?: boolean;
  collapsed?: boolean;
}) {
  return (
    <span
      data-navigation-layout
      className={`grid w-full min-w-0 items-center text-xs font-medium leading-4 tracking-normal ${collapsed ? "grid-cols-[16px]" : "grid-cols-[16px_minmax(0,1fr)] gap-[11px]"}`}
    >
      <Icon
        aria-hidden="true"
        data-navigation-icon
        size={16}
        strokeWidth={1.75}
        className="size-4 shrink-0"
      />
      <span
        data-navigation-label
        data-navigation-heading={heading || undefined}
        className={`${heading ? "uppercase" : ""} ${collapsed ? "sr-only" : "truncate"}`}
      >
        {label}
      </span>
    </span>
  );
}
