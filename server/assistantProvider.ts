import {
  assistantProviderIds,
  assistantProviderLabels,
  assistantModelId,
  type AssistantProviderName,
  type AssistantSelection,
  type AssistantProviderCatalog,
} from "../shared/assistant-providers";
export type { AssistantProviderName } from "../shared/assistant-providers";
export type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
};
export type AssistantCompletion = {
  provider: AssistantProviderName;
  model: string;
  answer: string;
};

type ProviderConfig = {
  name: AssistantProviderName;
  baseUrl: string;
  apiKey: string;
  models: string[];
  protocol?: "chat" | "responses" | "anthropic";
};

class ProviderRequestError extends Error {
  constructor(readonly status: number | undefined) {
    super(
      status ? `Provider returned HTTP ${status}` : "Provider request failed",
    );
  }
}

const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const CURRENT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];
const CURRENT_GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

function firstSetting(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function modelCandidates(
  primary: string,
  candidates: string,
  fallback: string,
  current: string[],
) {
  const values = [primary, ...candidates.split(","), fallback, ...current]
    .map((value) => value.trim())
    .filter((value) => assistantModelId.safeParse(value).success);
  return [...new Set(values)].slice(0, 6);
}

function providerConfig(name: AssistantProviderName): ProviderConfig {
  if (name === "openai" || name === "anthropic" || name === "compatible") {
    const prefix = `ASSISTANT_${name.toUpperCase()}`;
    return {
      name,
      baseUrl:
        firstSetting(`${prefix}_BASE_URL`) ||
        (name === "openai"
          ? "https://api.openai.com/v1"
          : name === "anthropic"
            ? "https://api.anthropic.com/v1"
            : ""),
      apiKey: firstSetting(`${prefix}_API_KEY`),
      models: modelCandidates(
        firstSetting(`${prefix}_MODEL`),
        firstSetting(`${prefix}_MODEL_CANDIDATES`),
        firstSetting(`${prefix}_FALLBACK_MODEL`),
        [],
      ),
      protocol:
        name === "anthropic"
          ? "anthropic"
          : name === "openai" ||
              firstSetting("ASSISTANT_COMPATIBLE_PROTOCOL") === "responses"
            ? "responses"
            : "chat",
    };
  }
  if (name === "gemini") {
    return {
      name,
      baseUrl:
        firstSetting("ASSISTANT_GEMINI_BASE_URL") || DEFAULT_GEMINI_BASE_URL,
      apiKey: firstSetting("ASSISTANT_GEMINI_API_KEY"),
      models: modelCandidates(
        firstSetting("ASSISTANT_GEMINI_MODEL") || CURRENT_GEMINI_MODELS[0],
        firstSetting("ASSISTANT_GEMINI_MODEL_CANDIDATES"),
        firstSetting("ASSISTANT_GEMINI_FALLBACK_MODEL") ||
          CURRENT_GEMINI_MODELS[1],
        CURRENT_GEMINI_MODELS,
      ),
    };
  }

  return {
    name,
    // GROK aliases remain accepted for existing local .env.local files. New installs
    // should use the correctly named GROQ variables below.
    baseUrl:
      firstSetting("ASSISTANT_GROQ_BASE_URL", "ASSISTANT_GROK_AI_BASE_URL") ||
      DEFAULT_GROQ_BASE_URL,
    apiKey: firstSetting(
      "ASSISTANT_GROQ_API_KEY",
      "ASSISTANT_GROK_AI_API_KEY",
      "ASSISTANT_GROK_API_KEY",
    ),
    models: modelCandidates(
      firstSetting("ASSISTANT_GROQ_MODEL", "ASSISTANT_GROK_MODEL") ||
        CURRENT_GROQ_MODELS[0],
      firstSetting(
        "ASSISTANT_GROQ_MODEL_CANDIDATES",
        "ASSISTANT_GROK_MODEL_CANDIDATES",
      ),
      firstSetting(
        "ASSISTANT_GROQ_FALLBACK_MODEL",
        "ASSISTANT_GROK_FALLBACK_MODEL",
      ) || CURRENT_GROQ_MODELS[1],
      CURRENT_GROQ_MODELS,
    ),
  };
}

function providerOrder(): AssistantProviderName[] {
  const preference = (process.env.ASSISTANT_PROVIDER || "openai_compatible")
    .trim()
    .toLowerCase();
  if (["disabled", "off", "none"].includes(preference)) return [];
  const configuredOrder = firstSetting("ASSISTANT_PROVIDER_ORDER");
  if (configuredOrder)
    return [
      ...new Set(
        configuredOrder
          .split(",")
          .map((name) => name.trim())
          .filter((name): name is AssistantProviderName =>
            assistantProviderIds.some((id) => id === name),
          ),
      ),
    ];
  if (preference === "groq") return ["groq", "gemini"];
  // `openai_compatible` is retained as the recommended Gemini-first setup.
  if (["gemini", "openai_compatible", "auto"].includes(preference))
    return ["gemini", "groq"];
  return assistantProviderIds.some((id) => id === preference)
    ? [preference as AssistantProviderName]
    : [];
}

function completionsUrl(config: ProviderConfig) {
  const parsed = new URL(config.baseUrl);
  const origins: Partial<Record<AssistantProviderName, string>> = {
    gemini: "https://generativelanguage.googleapis.com",
    groq: "https://api.groq.com",
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
  };
  const custom = config.name === "compatible";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const allowedProtocol =
    parsed.protocol === "https:" ||
    (custom &&
      local &&
      parsed.protocol === "http:" &&
      firstSetting("ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP") === "true");
  if (
    !allowedProtocol ||
    parsed.origin !==
      (custom
        ? firstSetting("ASSISTANT_COMPATIBLE_APPROVED_ORIGIN")
        : origins[config.name]) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ProviderRequestError(undefined);
  }
  return `${parsed.toString().replace(/\/+$/, "")}/${config.protocol === "anthropic" ? "messages" : config.protocol === "responses" ? "responses" : "chat/completions"}`;
}

function assistantText(body: unknown, protocol: ProviderConfig["protocol"]) {
  if (!body || typeof body !== "object") return "";
  if (protocol === "anthropic") {
    const content = (body as { content?: unknown }).content;
    return Array.isArray(content)
      ? content
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n")
          .trim()
          .slice(0, 6000)
      : "";
  }
  if (protocol === "responses") {
    const output = (body as { output?: unknown }).output;
    return Array.isArray(output)
      ? output
          .filter(
            (p) =>
              p?.type === "message" &&
              p.role === "assistant" &&
              Array.isArray(p.content),
          )
          .flatMap((p) => p.content)
          .filter(
            (p) => p?.type === "output_text" && typeof p.text === "string",
          )
          .map((p) => p.text)
          .join("\n")
          .trim()
          .slice(0, 6000)
      : "";
  }
  const choices = (
    body as { choices?: Array<{ message?: { content?: unknown } }> }
  ).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim().slice(0, 6000);
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("\n")
      .trim()
      .slice(0, 6000);
  }
  return "";
}

function providerReady(config: ProviderConfig) {
  if (!config.models.length) return false;
  try {
    const url = new URL(completionsUrl(config));
    return (
      !!config.apiKey ||
      (config.name === "compatible" &&
        url.protocol === "http:" &&
        firstSetting("ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP") === "true")
    );
  } catch {
    return false;
  }
}

/** Only approved names and models leave the server; credentials and endpoints do not. */
export function assistantProviderCatalog(
  remoteAllowed = true,
): AssistantProviderCatalog {
  return {
    version: 1,
    providers: [
      { id: "auto", label: "Installation default", models: [] },
      { id: "local", label: "Local knowledge", models: [] },
      ...(remoteAllowed && providerOrder().length
        ? assistantProviderIds
            .map(providerConfig)
            .filter(providerReady)
            .map((config) => ({
              id: config.name,
              label: assistantProviderLabels[config.name],
              models: config.models,
            }))
        : []),
    ],
  };
}

export function validateAssistantSelection(
  selection: AssistantSelection | undefined,
  remoteAllowed = true,
) {
  if (!selection) return;
  const provider = assistantProviderCatalog(remoteAllowed).providers.find(
    (p) => p.id === selection.provider,
  );
  if (
    !provider ||
    (selection.model && !provider.models.includes(selection.model))
  )
    throw new Error(
      "The selected AI provider or model is no longer available. Choose an enabled option.",
    );
}

async function boundedResponse(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderRequestError(response.status);
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) throw new ProviderRequestError(response.status);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function requestModel(
  config: ProviderConfig,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetcher: typeof fetch,
  deadline: AbortSignal,
) {
  let url: string;
  try {
    url = completionsUrl(config);
  } catch {
    throw new ProviderRequestError(undefined);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  if (config.name === "gemini")
    headers["x-goog-api-client"] = "smart-factory/1.0.0";
  if (config.protocol === "anthropic")
    headers["anthropic-version"] =
      firstSetting("ASSISTANT_ANTHROPIC_VERSION") || "2023-06-01";
  if (
    config.protocol === "anthropic" &&
    firstSetting("ASSISTANT_ANTHROPIC_WORKSPACE_ID")
  )
    headers["anthropic-workspace-id"] = firstSetting(
      "ASSISTANT_ANTHROPIC_WORKSPACE_ID",
    );
  if (!config.apiKey) delete headers.Authorization;
  const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n"),
    conversation = messages.filter((m) => m.role !== "system");
  const payload =
    config.protocol === "responses"
      ? {
          model,
          instructions: system,
          input: conversation,
          max_output_tokens: 900,
          store: false,
          stream: false,
        }
      : config.protocol === "anthropic"
        ? {
            model,
            system,
            messages: conversation,
            max_tokens: 900,
            stream: false,
          }
        : {
            model,
            messages,
            ...(config.name === "compatible" ? {} : { temperature: 0.2 }),
            [config.name === "compatible" &&
            firstSetting("ASSISTANT_COMPATIBLE_TOKEN_PARAMETER") ===
              "max_completion_tokens"
              ? "max_completion_tokens"
              : "max_tokens"]: 900,
            stream: false,
          };

  let response: Response;
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(12_000)]);
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
      redirect: "error",
    });
  } catch {
    throw new ProviderRequestError(undefined);
  }
  if (!response.ok) throw new ProviderRequestError(response.status);

  try {
    const answer = assistantText(
      await boundedResponse(response, signal),
      config.protocol,
    );
    if (!answer) throw new ProviderRequestError(response.status);
    return answer;
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError(response.status);
  }
}

/**
 * Route an approved provider/model choice through its wire adapter. The legacy
 * installation default retains Gemini/Groq fallback. Explicit model choices
 * stay pinned; keys and raw provider errors never leave this module.
 */
export async function generateAssistantCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetcher: typeof fetch = fetch,
  selection?: AssistantSelection,
  requestSignal?: AbortSignal,
): Promise<{ completion?: AssistantCompletion; configured: boolean }> {
  requestSignal?.throwIfAborted();
  validateAssistantSelection(selection);
  if (selection?.provider === "local") return { configured: false };
  const explicit = selection && selection.provider !== "auto";
  const order = explicit
    ? [selection.provider as AssistantProviderName]
    : providerOrder();
  if (order.length === 0) return { configured: false };

  let configured = false;
  // All provider/model fallbacks share one budget. A series of slow errors must
  // reach the grounded local answer before the API proxy abandons the request.
  const deadline = new AbortController();
  const signal = requestSignal
    ? AbortSignal.any([deadline.signal, requestSignal])
    : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), 24_000);
  try {
    for (const provider of order) {
      requestSignal?.throwIfAborted();
      if (signal.aborted) break;
      const config = providerConfig(provider);
      if (
        !config.apiKey &&
        !(config.name === "compatible" && providerReady(config))
      )
        continue;
      configured = true;

      let transientModelFallbackUsed = false;
      for (const model of selection?.model
        ? [selection.model]
        : config.models) {
        requestSignal?.throwIfAborted();
        if (signal.aborted) break;
        try {
          const answer = await requestModel(
            config,
            model,
            messages,
            fetcher,
            signal,
          );
          requestSignal?.throwIfAborted();
          return { completion: { provider, model, answer }, configured };
        } catch (error) {
          // User cancellation is not provider failure. Never start another
          // model or fabricate a completed local answer after the caller left.
          requestSignal?.throwIfAborted();
          const status =
            error instanceof ProviderRequestError ? error.status : undefined;
          // Invalid or unavailable model IDs use the configured model fallback.
          // A single retry on another model can also recover model-specific 5xx
          // capacity failures; auth, quota, throttling, and network errors move
          // directly to the other provider to avoid a long series of futile calls.
          if (status === 400 || status === 404) continue;
          if (
            status !== undefined &&
            status >= 500 &&
            !transientModelFallbackUsed
          ) {
            transientModelFallbackUsed = true;
            continue;
          }
          break;
        }
      }
    }
    return { configured };
  } finally {
    clearTimeout(timer);
  }
}
