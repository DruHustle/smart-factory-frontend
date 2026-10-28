import { useId } from "react";
import { trpc } from "@/lib/trpc";
import type { AssistantSelection } from "@shared/assistant-providers";
import { Button } from "@/components/ui/button";

export function AssistantModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: AssistantSelection;
  onChange: (selection: AssistantSelection) => void;
  disabled: boolean;
}) {
  const id = useId();
  const catalog = trpc.assistant.providers.useQuery(undefined, {
    staleTime: 60000,
    retry: false,
  });
  if (catalog.isLoading)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading AI providers…
      </p>
    );
  if (!catalog.data)
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>AI provider choices are unavailable.</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={catalog.isFetching || disabled}
          onClick={() => void catalog.refetch()}
        >
          Retry provider choices
        </Button>
      </div>
    );
  const options = catalog.data.providers;
  const provider = options.find((p) => p.id === value.provider);
  const model = value.model ?? provider?.models[0] ?? "";
  const unavailable =
    !provider || (!!model && !provider.models.includes(model));
  const control =
    "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";
  return (
    <div className="min-w-0 space-y-1" aria-label="AI selection">
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <label
          htmlFor={`${id}-provider`}
          className="min-w-0 space-y-1 text-xs font-medium"
        >
          <span>AI provider</span>
          <select
            id={`${id}-provider`}
            value={value.provider}
            disabled={disabled}
            className={control}
            onChange={(event) => {
              const next = options.find((p) => p.id === event.target.value);
              if (next)
                onChange({
                  provider: next.id,
                  ...(next.models[0] ? { model: next.models[0] } : {}),
                });
            }}
          >
            {!provider && (
              <option value={value.provider} disabled>
                Unavailable provider
              </option>
            )}
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label
          htmlFor={`${id}-model`}
          className="min-w-0 space-y-1 text-xs font-medium"
        >
          <span>AI model</span>
          <select
            id={`${id}-model`}
            value={model}
            disabled={disabled || !provider?.models.length}
            className={control}
            onChange={(event) =>
              onChange({ provider: value.provider, model: event.target.value })
            }
          >
            {!provider?.models.length && (
              <option value="">
                {value.provider === "local"
                  ? "Local knowledge"
                  : "Installation default"}
              </option>
            )}
            {unavailable && model && (
              <option value={model} disabled>
                Unavailable model
              </option>
            )}
            {provider?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      {unavailable && (
        <p role="status" className="text-xs text-destructive">
          Choose an available provider and model.
        </p>
      )}
    </div>
  );
}
