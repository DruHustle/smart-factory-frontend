import { test, expect, type Page, type Route } from "@playwright/test";

test.skip(
  process.env.WORKSPACE_E2E !== "true",
  "Uses isolated individual-account fixtures",
);

async function login(page: Page) {
  await page.goto("/#/login");
  await page.getByLabel("Email").fill("security-viewer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-security-only-2026!");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
function respond(route: Route, json: unknown) {
  return route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(
      new URL(route.request().url()).searchParams.has("batch")
        ? [{ result: { data: { json } } }]
        : { result: { data: { json } } },
    ),
  });
}

for (const width of [390, 1440])
  test(`provider and model choices are captured per question at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    // These UI adapter fixtures never contact a paid AI service or send factory data.
    await page.route("**/api/trpc/assistant.providers*", (route) =>
      respond(route, {
        version: 1,
        providers: [
          { id: "auto", label: "Installation default", models: [] },
          { id: "local", label: "Local knowledge", models: [] },
          {
            id: "openai",
            label: "OpenAI",
            models: ["approved-model-a", "approved-model-b"],
          },
          {
            id: "anthropic",
            label: "Anthropic Claude",
            models: ["approved-claude-model"],
          },
        ],
      }),
    );
    const requests: Array<{ provider: string; model?: string }> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/trpc/assistant.ask*", async (route) => {
      const raw = route.request().postDataJSON();
      const request = raw.json ?? raw["0"].json;
      requests.push(request.selection);
      if (requests.length === 1) await gate;
      if (requests.length === 3) return route.abort("failed");
      await respond(route, {
        answer: "Synthetic adapter response for the selected model.",
        sources: [],
        contextAt: "2026-10-28T12:00:00Z",
        execution: {
          provider: request.selection.provider,
          model: request.selection.model,
        },
      });
    });
    await page.goto("/#/assistant");
    const provider = page.getByLabel("AI provider", { exact: true }),
      model = page.getByLabel("AI model", { exact: true });
    await provider.selectOption("openai");
    await model.selectOption("approved-model-b");
    await page
      .getByLabel("Ask the Smart Factory Assistant")
      .fill("How do I review source freshness?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    try {
      await expect(provider).toBeDisabled();
      await expect(model).toBeDisabled();
      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0]).toEqual({
        provider: "openai",
        model: "approved-model-b",
      });
    } finally {
      release();
    }
    await expect(page.getByTestId("assistant-execution").last()).toHaveText(
      "OpenAI · approved-model-b",
    );
    await provider.selectOption("anthropic");
    await expect(model).toHaveValue("approved-claude-model");
    await page
      .getByLabel("Ask the Smart Factory Assistant")
      .fill("Explain a source observation.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByTestId("assistant-execution").last()).toHaveText(
      "Anthropic Claude · approved-claude-model",
    );
    expect(requests[1]).toEqual({
      provider: "anthropic",
      model: "approved-claude-model",
    });
    await page
      .getByLabel("Ask the Smart Factory Assistant")
      .fill("Review the recorded source again.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const retry = page.getByRole("button", { name: "Retry this question", exact: true });
    await expect(retry).toBeVisible();
    await provider.selectOption("openai");
    await model.selectOption("approved-model-a");
    await retry.click();
    await expect(page.getByTestId("assistant-execution").last()).toHaveText(
      "OpenAI · approved-model-a",
    );
    expect(requests[3]).toEqual({
      provider: "openai",
      model: "approved-model-a",
    });
    await page.goto("/#/inventory");
    await expect(
      page.getByRole("heading", { name: "Assets & devices", exact: true }),
    ).toBeVisible();
    await page.goto("/#/assistant");
    await expect(provider).toHaveValue("openai");
    await expect(model).toHaveValue("approved-model-a");
    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(provider).toHaveValue("openai");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/repository-review/ai-selection-${width}.png`,
    });
  });

test("the real API honors local mode and rejects unavailable or arbitrary provider inputs", async ({
  page,
}) => {
  await login(page);
  await page.goto("/#/assistant");
  await page.getByLabel("AI provider", { exact: true }).selectOption("local");
  await page
    .getByLabel("Ask the Smart Factory Assistant")
    .fill("How do I review source freshness?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("assistant-execution").last()).toHaveText(
    "Local knowledge",
  );
  for (const selection of [
    { provider: "openai", model: "unapproved-model" },
    { provider: "auto", model: "unapproved-model" },
    { provider: "compatible", endpoint: "https://unapproved.example.test" },
  ]) {
    const response = await page.request.post("/api/trpc/assistant.ask", {
      data: { json: { question: "Review source freshness", selection } },
    });
    expect(response.status()).toBe(400);
  }
});
