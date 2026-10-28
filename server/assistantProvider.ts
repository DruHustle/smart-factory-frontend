export type AssistantChatMessage = { role: "user" | "assistant"; content: string };
export type AssistantProviderName = "gemini" | "groq";
export type AssistantCompletion = { provider: AssistantProviderName; model: string; answer: string };

type ProviderConfig = {
  name: AssistantProviderName;
  baseUrl: string;
  apiKey: string;
  models: string[];
};

class ProviderRequestError extends Error {
  constructor(readonly status: number | undefined) {
    super(status ? `Provider returned HTTP ${status}` : "Provider request failed");
  }
}

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const CURRENT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];
const CURRENT_GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;

function firstSetting(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function modelCandidates(primary: string, candidates: string, fallback: string, current: string[]) {
  const values = [primary, ...candidates.split(","), fallback, ...current]
    .map((value) => value.trim())
    .filter((value) => MODEL_ID_PATTERN.test(value));
  return [...new Set(values)].slice(0, 6);
}

function providerConfig(name: AssistantProviderName): ProviderConfig {
  if (name === "gemini") {
    return {
      name,
      baseUrl: firstSetting("ASSISTANT_GEMINI_BASE_URL") || DEFAULT_GEMINI_BASE_URL,
      apiKey: firstSetting("ASSISTANT_GEMINI_API_KEY"),
      models: modelCandidates(
        firstSetting("ASSISTANT_GEMINI_MODEL") || CURRENT_GEMINI_MODELS[0],
        firstSetting("ASSISTANT_GEMINI_MODEL_CANDIDATES"),
        firstSetting("ASSISTANT_GEMINI_FALLBACK_MODEL") || CURRENT_GEMINI_MODELS[1],
        CURRENT_GEMINI_MODELS,
      ),
    };
  }

  return {
    name,
    // GROK aliases remain accepted for existing local .env.local files. New installs
    // should use the correctly named GROQ variables below.
    baseUrl: firstSetting("ASSISTANT_GROQ_BASE_URL", "ASSISTANT_GROK_AI_BASE_URL") || DEFAULT_GROQ_BASE_URL,
    apiKey: firstSetting("ASSISTANT_GROQ_API_KEY", "ASSISTANT_GROK_AI_API_KEY", "ASSISTANT_GROK_API_KEY"),
    models: modelCandidates(
      firstSetting("ASSISTANT_GROQ_MODEL", "ASSISTANT_GROK_MODEL") || CURRENT_GROQ_MODELS[0],
      firstSetting("ASSISTANT_GROQ_MODEL_CANDIDATES", "ASSISTANT_GROK_MODEL_CANDIDATES"),
      firstSetting("ASSISTANT_GROQ_FALLBACK_MODEL", "ASSISTANT_GROK_FALLBACK_MODEL") || CURRENT_GROQ_MODELS[1],
      CURRENT_GROQ_MODELS,
    ),
  };
}

function providerOrder(): AssistantProviderName[] {
  const preference = (process.env.ASSISTANT_PROVIDER || "openai_compatible").trim().toLowerCase();
  if (["disabled", "off", "none"].includes(preference)) return [];
  if (preference === "groq") return ["groq", "gemini"];
  // `openai_compatible` is retained as the recommended Gemini-first setup.
  return ["gemini", "groq"];
}

function completionsUrl(config: ProviderConfig) {
  const parsed = new URL(config.baseUrl);
  const allowedHost = config.name === "gemini"
    ? "generativelanguage.googleapis.com"
    : "api.groq.com";
  if (parsed.protocol !== "https:" || parsed.hostname !== allowedHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderRequestError(undefined);
  }
  return `${parsed.toString().replace(/\/+$/, "")}/chat/completions`;
}

function assistantText(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim().slice(0, 6000);
  if (Array.isArray(content)) {
    return content.map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")
      .join("\n").trim().slice(0, 6000);
  }
  return "";
}

async function requestModel(config: ProviderConfig, model: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, fetcher: typeof fetch) {
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
  if (config.name === "gemini") headers["x-goog-api-client"] = "smart-factory/1.0.0";

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 900, stream: false }),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
  } catch {
    throw new ProviderRequestError(undefined);
  }
  if (!response.ok) throw new ProviderRequestError(response.status);

  try {
    const answer = assistantText(await response.json());
    if (!answer) throw new ProviderRequestError(response.status);
    return answer;
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError(response.status);
  }
}

/**
 * Use Gemini first and Groq as the provider fallback. API keys remain on the
 * server, model IDs are tried in configured order, and provider error bodies
 * are deliberately never logged or returned to callers.
 */
export async function generateAssistantCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fetcher: typeof fetch = fetch,
): Promise<{ completion?: AssistantCompletion; configured: boolean }> {
  const order = providerOrder();
  if (order.length === 0) return { configured: false };

  let configured = false;
  for (const provider of order) {
    const config = providerConfig(provider);
    if (!config.apiKey) continue;
    configured = true;

    let transientModelFallbackUsed = false;
    for (const model of config.models) {
      try {
        const answer = await requestModel(config, model, messages, fetcher);
        return { completion: { provider, model, answer }, configured };
      } catch (error) {
        const status = error instanceof ProviderRequestError ? error.status : undefined;
        // Invalid or unavailable model IDs use the configured model fallback.
        // A single retry on another model can also recover model-specific 5xx
        // capacity failures; auth, quota, throttling, and network errors move
        // directly to the other provider to avoid a long series of futile calls.
        if (status === 400 || status === 404) continue;
        if (status !== undefined && status >= 500 && !transientModelFallbackUsed) {
          transientModelFallbackUsed = true;
          continue;
        }
        break;
      }
    }
  }
  return { configured };
}
