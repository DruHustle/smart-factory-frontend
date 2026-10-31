import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assistantProviderIds,
  assistantSelection,
} from "../shared/assistant-providers";
import {
  assistantProviderCatalog,
  generateAssistantCompletion,
  validateAssistantSelection,
} from "./assistantProvider";

const messages = [
  { role: "system" as const, content: "Use authorized evidence." },
  { role: "user" as const, content: "Inspect the pump." },
];
const chatResponse = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "Verified guidance." } }],
    }),
  );
beforeEach(() => {
  vi.stubEnv("ASSISTANT_PROVIDER", "openai_compatible");
  vi.stubEnv("ASSISTANT_PROVIDER_ORDER", "");
  for (const name of assistantProviderIds) {
    const prefix = `ASSISTANT_${name.toUpperCase()}`;
    for (const suffix of [
      "API_KEY",
      "MODEL",
      "MODEL_CANDIDATES",
      "FALLBACK_MODEL",
      "BASE_URL",
    ])
      vi.stubEnv(`${prefix}_${suffix}`, "");
  }
  vi.stubEnv("ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP", "false");
  vi.stubEnv("ASSISTANT_COMPATIBLE_APPROVED_ORIGIN", "");
  vi.stubEnv("ASSISTANT_COMPATIBLE_PROTOCOL", "chat");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("lists configured services and approved models without exposing keys or endpoints", () => {
  vi.stubEnv("ASSISTANT_OPENAI_API_KEY", "private-test-key");
  vi.stubEnv("ASSISTANT_OPENAI_MODEL", "approved-model");
  vi.stubEnv(
    "ASSISTANT_OPENAI_MODEL_CANDIDATES",
    "approved-model,second-model",
  );
  const catalog = assistantProviderCatalog();
  expect(catalog.providers.find((p) => p.id === "openai")).toMatchObject({
    label: "OpenAI",
    models: ["approved-model", "second-model"],
  });
  expect(catalog.providers.some((p) => p.id === "anthropic")).toBe(false);
  expect(JSON.stringify(catalog)).not.toMatch(
    /private-test-key|api\.openai\.com|apiKey|baseUrl/,
  );
  expect(assistantProviderCatalog(false).providers.map((p) => p.id)).toEqual([
    "auto",
    "local",
  ]);
});

it("uses the OpenAI Responses adapter and returns only assistant output text", async () => {
  vi.stubEnv("ASSISTANT_OPENAI_API_KEY", "openai-test-key");
  vi.stubEnv("ASSISTANT_OPENAI_MODEL", "approved-model");
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          output: [
            { type: "reasoning", summary: [{ text: "Internal reasoning" }] },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Verified answer." }],
            },
          ],
        }),
      ),
  );
  const result = await generateAssistantCompletion(messages, fetcher, {
    provider: "openai",
    model: "approved-model",
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.openai.com/v1/responses");
  expect(new Headers(init!.headers).get("Authorization")).toBe(
    "Bearer openai-test-key",
  );
  expect(JSON.parse(String(init!.body))).toEqual({
    model: "approved-model",
    instructions: messages[0].content,
    input: [messages[1]],
    max_output_tokens: 900,
    store: false,
    stream: false,
  });
  expect(result.completion).toEqual({
    provider: "openai",
    model: "approved-model",
    answer: "Verified answer.",
  });
});

it("uses the Anthropic Messages adapter with system instructions separate from conversation", async () => {
  vi.stubEnv("ASSISTANT_ANTHROPIC_API_KEY", "anthropic-test-key");
  vi.stubEnv("ASSISTANT_ANTHROPIC_MODEL", "approved-claude-model");
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "Internal reasoning" },
            { type: "text", text: "Verified guidance." },
          ],
        }),
      ),
  );
  const result = await generateAssistantCompletion(messages, fetcher, {
    provider: "anthropic",
    model: "approved-claude-model",
  });
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(new Headers(init!.headers).get("anthropic-version")).toBe(
    "2023-06-01",
  );
  expect(JSON.parse(String(init!.body))).toEqual({
    model: "approved-claude-model",
    system: messages[0].content,
    messages: [messages[1]],
    max_tokens: 900,
    stream: false,
  });
  expect(result.completion).toMatchObject({
    provider: "anthropic",
    answer: "Verified guidance.",
  });
});

it("supports an explicitly approved loopback-compatible service and colon model IDs", async () => {
  vi.stubEnv("ASSISTANT_PROVIDER", "compatible");
  vi.stubEnv("ASSISTANT_COMPATIBLE_BASE_URL", "http://127.0.0.1:11434/v1");
  vi.stubEnv("ASSISTANT_COMPATIBLE_APPROVED_ORIGIN", "http://127.0.0.1:11434");
  vi.stubEnv("ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP", "true");
  vi.stubEnv("ASSISTANT_COMPATIBLE_MODEL", "local-model:latest");
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => chatResponse(),
  );
  const result = await generateAssistantCompletion(messages, fetcher, {
    provider: "compatible",
    model: "local-model:latest",
  });
  expect(fetcher.mock.calls[0][0]).toBe(
    "http://127.0.0.1:11434/v1/chat/completions",
  );
  expect(
    new Headers(fetcher.mock.calls[0][1]!.headers).has("Authorization"),
  ).toBe(false);
  expect(result.completion).toMatchObject({
    provider: "compatible",
    model: "local-model:latest",
  });
});

it("refuses arbitrary endpoints, redirects and unapproved models before transport", async () => {
  vi.stubEnv("ASSISTANT_PROVIDER", "compatible");
  vi.stubEnv("ASSISTANT_COMPATIBLE_API_KEY", "private-test-key");
  vi.stubEnv("ASSISTANT_COMPATIBLE_MODEL", "approved-model");
  vi.stubEnv(
    "ASSISTANT_COMPATIBLE_APPROVED_ORIGIN",
    "https://approved.example.test",
  );
  const fetcher = vi.fn();
  for (const url of [
    "https://other.example.test/v1",
    "https://user:secret@approved.example.test/v1",
    "https://approved.example.test/v1?key=value",
    "http://169.254.169.254/v1",
  ]) {
    vi.stubEnv("ASSISTANT_COMPATIBLE_BASE_URL", url);
    expect(
      assistantProviderCatalog().providers.some((p) => p.id === "compatible"),
    ).toBe(false);
    await expect(
      generateAssistantCompletion(messages, fetcher, {
        provider: "compatible",
        model: "approved-model",
      }),
    ).rejects.toThrow("no longer available");
  }
  vi.stubEnv(
    "ASSISTANT_COMPATIBLE_BASE_URL",
    "https://approved.example.test/v1",
  );
  await expect(
    generateAssistantCompletion(messages, fetcher, {
      provider: "compatible",
      model: "unapproved-model",
    }),
  ).rejects.toThrow("no longer available");
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    assistantSelection.safeParse({
      provider: "compatible",
      model: "approved-model",
      endpoint: "https://other.example.test",
    }).success,
  ).toBe(false);
  expect(
    assistantSelection.safeParse({ provider: "auto", model: "approved-model" })
      .success,
  ).toBe(false);
});

it("honors an explicit model without silently changing models or providers", async () => {
  vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
  vi.stubEnv("ASSISTANT_GROQ_API_KEY", "groq-test-key");
  vi.stubEnv("ASSISTANT_GEMINI_MODEL", "selected-model");
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("unavailable", { status: 503 }),
  );
  expect(
    await generateAssistantCompletion(messages, fetcher, {
      provider: "gemini",
      model: "selected-model",
    }),
  ).toEqual({ configured: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body)).model).toBe(
    "selected-model",
  );
  expect(fetcher.mock.calls[0][1]!.redirect).toBe("error");
});

it.each(["chat", "responses"])(
  "supports an approved compatible %s gateway",
  async (protocol) => {
    vi.stubEnv(
      "ASSISTANT_COMPATIBLE_BASE_URL",
      "https://approved.example.test/v1",
    );
    vi.stubEnv(
      "ASSISTANT_COMPATIBLE_APPROVED_ORIGIN",
      "https://approved.example.test",
    );
    vi.stubEnv("ASSISTANT_COMPATIBLE_API_KEY", "gateway-test-key");
    vi.stubEnv("ASSISTANT_COMPATIBLE_MODEL", "approved-model");
    vi.stubEnv("ASSISTANT_COMPATIBLE_PROTOCOL", protocol);
    vi.stubEnv("ASSISTANT_COMPATIBLE_TOKEN_PARAMETER", "max_completion_tokens");
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        protocol === "chat"
          ? chatResponse()
          : new Response(
              JSON.stringify({
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [
                      { type: "output_text", text: "Verified guidance." },
                    ],
                  },
                ],
              }),
            ),
    );
    expect(
      (
        await generateAssistantCompletion(messages, fetcher, {
          provider: "compatible",
          model: "approved-model",
        })
      ).completion?.answer,
    ).toBe("Verified guidance.");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://approved.example.test/v1/${protocol === "chat" ? "chat/completions" : "responses"}`,
    );
    expect(JSON.parse(String(init!.body))).toHaveProperty(
      protocol === "chat" ? "max_completion_tokens" : "max_output_tokens",
      900,
    );
  },
);

it("uses the installation fallback order only for automatic selection", async () => {
  vi.stubEnv("ASSISTANT_PROVIDER_ORDER", "openai,anthropic");
  vi.stubEnv("ASSISTANT_OPENAI_API_KEY", "openai-test-key");
  vi.stubEnv("ASSISTANT_OPENAI_MODEL", "approved-model");
  vi.stubEnv("ASSISTANT_ANTHROPIC_API_KEY", "anthropic-test-key");
  vi.stubEnv("ASSISTANT_ANTHROPIC_MODEL", "approved-claude-model");
  const fetcher = vi.fn(
    async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes("api.openai.com")
        ? new Response("throttled", { status: 429 })
        : new Response(
            JSON.stringify({
              content: [{ type: "text", text: "Verified guidance." }],
            }),
          ),
  );
  expect(
    (await generateAssistantCompletion(messages, fetcher, { provider: "auto" }))
      .completion?.provider,
  ).toBe("anthropic");
  expect(
    fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname),
  ).toEqual(["api.openai.com", "api.anthropic.com"]);
  expect(
    fetcher.mock.calls.map(([, init]) =>
      new Headers(init!.headers).get("Authorization"),
    ),
  ).toEqual(["Bearer openai-test-key", "Bearer anthropic-test-key"]);
});

it("never calls external services in local mode or when globally disabled", async () => {
  vi.stubEnv("ASSISTANT_GEMINI_API_KEY", "gemini-test-key");
  const fetcher = vi.fn();
  expect(
    await generateAssistantCompletion(messages, fetcher, { provider: "local" }),
  ).toEqual({ configured: false });
  vi.stubEnv("ASSISTANT_PROVIDER", "disabled");
  vi.stubEnv("ASSISTANT_PROVIDER_ORDER", "gemini,groq");
  expect(await generateAssistantCompletion(messages, fetcher)).toEqual({
    configured: false,
  });
  expect(() =>
    validateAssistantSelection({ provider: "gemini" }, false),
  ).toThrow("no longer available");
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds oversized provider bodies and cancels stalled response streams at the shared deadline", async () => {
  vi.stubEnv("ASSISTANT_PROVIDER", "openai");
  vi.stubEnv("ASSISTANT_OPENAI_API_KEY", "private-test-key");
  vi.stubEnv("ASSISTANT_OPENAI_MODEL", "approved-model");
  const oversized = vi.fn(async () => new Response("x".repeat(300000)));
  expect(await generateAssistantCompletion(messages, oversized)).toEqual({
    configured: true,
  });
  vi.useFakeTimers();
  const cancel = vi.fn();
  const stalled = vi.fn(
    async () => new Response(new ReadableStream({ cancel })),
  );
  const result = generateAssistantCompletion(messages, stalled);
  await vi.advanceTimersByTimeAsync(24001);
  expect(await result).toEqual({ configured: true });
  expect(cancel).toHaveBeenCalled();
});
