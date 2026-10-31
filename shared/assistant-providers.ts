import { z } from "zod";

export const assistantProviderIds = [
  "gemini",
  "groq",
  "openai",
  "anthropic",
  "compatible",
] as const;
export type AssistantProviderName = (typeof assistantProviderIds)[number];
export const assistantProviderLabels: Record<AssistantProviderName, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  compatible: "Compatible AI service",
};
export const assistantModelId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,119}$/);
export const assistantSelection = z
  .object({
    provider: z.enum(["auto", "local", ...assistantProviderIds]),
    model: assistantModelId.optional(),
  })
  .strict()
  .refine(
    (s) => !s.model || !["auto", "local"].includes(s.provider),
    "Select a provider before choosing a model",
  );
export type AssistantSelection = z.infer<typeof assistantSelection>;
export type AssistantProviderOption = {
  id: AssistantSelection["provider"];
  label: string;
  models: string[];
};
export type AssistantProviderCatalog = {
  version: 1;
  providers: AssistantProviderOption[];
};
