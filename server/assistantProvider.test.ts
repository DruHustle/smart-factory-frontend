import { afterEach, describe, expect, it, vi } from "vitest";
import { generateAssistantCompletion } from "./assistantProvider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Smart Factory assistant provider routing", () => {
  it("uses Gemini first and falls back to Groq when Gemini is unavailable", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "openai_compatible");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("ASSISTANT_GROQ_API_KEY", "groq-test-key");
    const requests: Array<{ url: string; authorization: string; model: string; redirect?: RequestRedirect }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization") ?? "",
        model: body.model,
        redirect: init?.redirect,
      });
      if (String(input).includes("generativelanguage")) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Use the live asset snapshot." } }] }), { status: 200 });
    });

    const result = await generateAssistantCompletion([{ role: "user", content: "What is online?" }], fetcher);

    expect(result.completion).toEqual({ provider: "groq", model: "openai/gpt-oss-120b", answer: "Use the live asset snapshot." });
    expect(requests.map(({ url }) => new URL(url).hostname)).toEqual(["generativelanguage.googleapis.com", "generativelanguage.googleapis.com", "api.groq.com"]);
    expect(requests.map(({ authorization }) => authorization)).toEqual(["Bearer gemini-test-key", "Bearer gemini-test-key", "Bearer groq-test-key"]);
    expect(requests.every(({ redirect }) => redirect === "error")).toBe(true);
  });

  it("tries the next configured model after a model-not-found response", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "gemini");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("ASSISTANT_GEMINI_MODEL", "retired-model");
    vi.stubEnv("ASSISTANT_GEMINI_FALLBACK_MODEL", "supported-model");
    const models: string[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      models.push(model);
      return model === "retired-model"
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "Ready." } }] }), { status: 200 });
    });

    const result = await generateAssistantCompletion([{ role: "user", content: "Help" }], fetcher);

    expect(models.slice(0, 2)).toEqual(["retired-model", "supported-model"]);
    expect(result.completion?.model).toBe("supported-model");
  });

  it("tries one Gemini fallback model after a temporary model service failure", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "gemini");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("ASSISTANT_GEMINI_MODEL", "busy-model");
    vi.stubEnv("ASSISTANT_GEMINI_MODEL_CANDIDATES", "busy-model,ready-model");
    vi.stubEnv("ASSISTANT_GEMINI_FALLBACK_MODEL", "ready-model");
    const models: string[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      models.push(model);
      return model === "busy-model"
        ? new Response("temporarily unavailable", { status: 503 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "Use this verified answer." } }] }), { status: 200 });
    });

    const result = await generateAssistantCompletion([{ role: "user", content: "Help" }], fetcher);

    expect(models).toEqual(["busy-model", "ready-model"]);
    expect(result.completion).toMatchObject({ provider: "gemini", model: "ready-model", answer: "Use this verified answer." });
  });

  it("does not make provider calls when remote answering is disabled or keys are absent", async () => {
    const fetcher = vi.fn();
    vi.stubEnv("ASSISTANT_PROVIDER", "disabled");
    expect(await generateAssistantCompletion([], fetcher)).toEqual({ configured: false });

    vi.stubEnv("ASSISTANT_PROVIDER", "openai_compatible");
    expect(await generateAssistantCompletion([], fetcher)).toEqual({ configured: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an unapproved provider endpoint without making a request", async () => {
    vi.stubEnv("ASSISTANT_PROVIDER", "gemini");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("ASSISTANT_GEMINI_BASE_URL", "https://example.invalid/collect");
    const fetcher = vi.fn();

    const result = await generateAssistantCompletion([{ role: "user", content: "Help" }], fetcher);

    expect(result.configured).toBe(true);
    expect(result.completion).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ends all provider work at a shared deadline so the local answer remains available", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ASSISTANT_PROVIDER", "gemini");
    vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("ASSISTANT_GROQ_API_KEY", "groq-test-key");
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const result = generateAssistantCompletion([{ role: "user", content: "Review the latest evidence" }], fetcher);
    await vi.advanceTimersByTimeAsync(24_001);
    expect(await result).toEqual({ configured: true });
    const requestCount = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
    expect(fetcher.mock.calls.every(([, init]) => init!.signal!.aborted)).toBe(true);
  });
});
