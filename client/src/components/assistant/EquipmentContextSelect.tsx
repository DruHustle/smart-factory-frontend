import { useFactorySelection } from "@/lib/factory-selection";
import { useDemoSandbox } from "@/lib/demo-sandbox";
import { sandboxInventory } from "@shared/demo-sandbox";
import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "@/components/ui/command";
import { EquipmentSymbol } from "@/components/workspace/VisualEvidence";
import type { InventoryItem } from "@shared/inventory";
export function EquipmentContextSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (assetId: string, name: string | null) => void;
}) {
  const { id: factoryId, demo } = useFactorySelection(),
    sandbox = useDemoSandbox();
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    settled = useDebouncedValue(search);
  const assets = trpc.inventory.list.useQuery(
      {
        view: "assets",
        search: settled,
        page: 0,
        pageSize: 25,
        factoryId: factoryId && !demo ? factoryId : undefined,
      },
      { enabled: open && !(demo && factoryId), staleTime: 30000 },
    ),
    models = trpc.inventory.list.useQuery(
      {
        view: "equipment",
        search: settled,
        page: 0,
        pageSize: 25,
        factoryId: factoryId && !demo ? factoryId : undefined,
      },
      { enabled: open && !(demo && factoryId), staleTime: 30000 },
    );
  const serverItems = [
    ...new Map<string, InventoryItem>(
      [...(assets.data?.items ?? []), ...(models.data?.items ?? [])].map(
        (i) => [i.identifier, i],
      ),
    ).values(),
  ];
  const refs = new Set(
    sandbox?.factories
      .find((f) => f.id === factoryId)
      ?.draft.document.placements.map((p) => p.ref) ?? [],
  );
  const items =
    demo && factoryId
      ? sandbox
        ? sandboxInventory(sandbox).filter(
            (i) =>
              i.kind !== "device" &&
              refs.has(i.ref) &&
              `${i.name} ${i.identifier}`
                .toLowerCase()
                .includes(settled.toLowerCase()),
          )
        : []
      : serverItems;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-label="Assistant asset context"
          aria-expanded={open}
          className="h-9 min-w-0 max-w-full justify-between gap-2 px-2 text-xs"
        >
          <EquipmentSymbol type="equipment" className="size-4 text-info" />
          <span className="truncate">
            {value === "automatic" ? "Automatic equipment context" : label}
          </span>
          <ChevronsUpDown className="size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Find equipment context"
            value={search}
            onValueChange={setSearch}
            placeholder="Find an asset or equipment…"
          />
          <CommandList>
            <CommandItem
              value="automatic"
              onSelect={() => {
                onChange("automatic", null);
                setOpen(false);
              }}
            >
              <Check
                className={
                  value === "automatic" ? "size-4" : "size-4 opacity-0"
                }
              />
              Automatic equipment context
            </CommandItem>
            {items.map((item) => (
              <CommandItem
                key={item.identifier}
                value={item.identifier}
                onSelect={() => {
                  onChange(item.identifier, item.name);
                  setOpen(false);
                }}
              >
                <Check
                  className={
                    value === item.identifier ? "size-4" : "size-4 opacity-0"
                  }
                />
                <EquipmentSymbol
                  type={item.itemType}
                  className="size-4 text-info"
                />
                <span className="min-w-0">
                  <span className="block break-words">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.isDemo ? "Simulation" : "Equipment"} ·{" "}
                    {item.location ?? item.itemType}
                  </span>
                </span>
              </CommandItem>
            ))}
            {assets.isFetching || models.isFetching ? (
              <p role="status" className="p-3 text-xs text-muted-foreground">
                Loading matching equipment…
              </p>
            ) : null}
            {assets.error || models.error ? (
              <p role="alert" className="p-3 text-xs text-destructive">
                Equipment search is unavailable. Retain your context or try
                opening the selector again.
              </p>
            ) : null}
            <CommandEmpty>No matching equipment.</CommandEmpty>
          </CommandList>
          <p className="border-t p-2 text-xs text-muted-foreground">
            Up to 25 assets and 25 models per search. Refine the name to find
            another item.
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
