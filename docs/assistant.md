# Smart Factory Assistant

The Assistant combines approved application guides with a small, current snapshot from the Smart Factory API. It can explain workflows and answer questions about visible assets, connected gateway/device status, recent telemetry, and incidents. It is advisory and read-only; it cannot issue equipment commands.

Its fixed product identity is **Smart Factory Assistant**. Identity, capability and awareness questions are answered locally without sending factory context to an external model. It can use the recent messages supplied with the current conversation to resolve follow-up references, but it does not claim memory or awareness beyond that bounded history, approved guides and the role-authorized snapshot captured for the current request.

Short questions such as “whats fx and tsn” use reviewed plain-language concepts, without unrelated machine readings or charts. Follow-ups such as “explain that simply”, “give me an example”, “do I need both” and “are we using it on real hardware” retain the recent topic. Evidence questions prioritize the metric in the current question, even when the previous turn asked about another measurement. Missing context prompts a focused clarification. Physical FX/TSN support is never inferred from an authored scenario.

After opening the [editable demo](editable-demo.md), operational questions can include a bounded user-supplied snapshot of that browser's simulated inventory, readings, incidents and findings. This is captured with the turn and retained for its retry. It is accepted only in shared demo scope, labelled as simulation, and never sent to an external provider. Definitions and workflow questions omit the snapshot. Individual operational answers keep using authorized server evidence. Chat itself remains advisory; actions happen in the relevant workspace.

The Assistant keeps its product identity in conversation. The **AI provider** and **AI model** controls separately show the services and model IDs enabled for the installation. Each answer identifies its actual execution route, including local knowledge when a remote service is unavailable. Credentials, endpoint configuration, raw provider errors and hidden instructions are never returned to the browser. This configuration guide remains excluded from answer retrieval.

## Choose a provider and model

Open **Tools & settings → Assistant**, choose **AI provider**, then **AI model**. The choice is retained while navigating inside the signed-in session and applies to subsequent questions. A new conversation keeps the choice; sign-out and identity, role or factory changes clear the conversation session. Controls are disabled while an answer is pending. Retry uses the currently selected service and model while retaining the original question, history, equipment and captured simulation context.

Only configured services and approved model IDs are listed. An explicitly selected model is pinned: failure never silently sends the question to another provider or model. A grounded local answer remains available and is labelled **Local knowledge**. **Installation default** uses the operator's configured fallback order. Shared demo accounts and individual accounts viewing the Demo workspace always remain local and cannot select external services. Reviewed definitions, identity replies and short conversational responses may be answered locally even when a remote model is selected; the execution label reports the route actually used.

The `assistant-provider-selection-v1` runtime capability is optional. A compatible older API keeps the Assistant available with its installation default, while the chooser is hidden and no selection fields or catalog requests are sent. Explicit selections use a separate `assistant.askSelected` endpoint so a rollback during an open conversation produces a visible retryable error instead of ignoring the chosen model. The user can explicitly select **Installation default** and retry. This does not add a required capability to the qualified rollback release.

This connector handles model-provider APIs. It does not expose Smart Factory tools to external MCP clients or grant equipment-control access.

## Provider setup

Provider settings belong in the API environment (`.env.local` for local Node development, or the VM API's existing private environment file). Never add provider credentials to `VITE_*` variables, frontend code, source control, screenshots, or support logs.

```dotenv
ASSISTANT_PROVIDER=openai_compatible
ASSISTANT_INCLUDE_LIVE_CONTEXT=true

ASSISTANT_GEMINI_MODEL=gemini-3.8-flash
ASSISTANT_GEMINI_FALLBACK_MODEL=gemini-2.5-flash
ASSISTANT_GEMINI_MODEL_CANDIDATES=gemini-3.8-flash,gemini-2.5-flash
ASSISTANT_GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
ASSISTANT_GEMINI_API_KEY=

ASSISTANT_GROQ_MODEL=openai/gpt-oss-120b
ASSISTANT_GROQ_FALLBACK_MODEL=openai/gpt-oss-20b
ASSISTANT_GROQ_MODEL_CANDIDATES=openai/gpt-oss-120b,openai/gpt-oss-20b
ASSISTANT_GROQ_BASE_URL=https://api.groq.com/openai/v1
ASSISTANT_GROQ_API_KEY=
```

The legacy `openai_compatible` default retains Gemini-first/Groq-second routing. `gemini` uses the same order; `groq` reverses it. New defaults can use `openai`, `anthropic` or `compatible`. `ASSISTANT_PROVIDER_ORDER` optionally supplies a comma-separated fallback order for **Installation default**. `disabled`, `off`, or `none` always disables remote calls, even when that order is set. Unknown provider names fail closed. Automatic mode may try the next configured model after a model-not-found response or one temporary HTTP 5xx failure; authentication, quota, throttling and network errors move to the next configured service. Explicit model selections do not use those fallbacks. Calls have a 12-second timeout and share a 24-second total budget. Response bodies are bounded to 256 KiB and answer text to 6,000 characters.

### Additional AI services

Add the appropriate server-side key and at least one model ID available to that account. `*_MODEL_CANDIDATES` is the comma-separated allowlist shown in the model picker; `*_MODEL` is its first choice. No model names for these additional providers are guessed or enabled automatically.

| Provider | Environment prefix | Wire API | Default base URL |
| --- | --- | --- | --- |
| OpenAI | `ASSISTANT_OPENAI_` | Responses | `https://api.openai.com/v1` |
| Anthropic Claude | `ASSISTANT_ANTHROPIC_` | Messages | `https://api.anthropic.com/v1` |
| Compatible gateway or local model server | `ASSISTANT_COMPATIBLE_` | Chat Completions, or Responses when configured | Explicit configuration required |

```dotenv
ASSISTANT_PROVIDER_ORDER=
ASSISTANT_OPENAI_API_KEY=
ASSISTANT_OPENAI_MODEL=
ASSISTANT_OPENAI_MODEL_CANDIDATES=
ASSISTANT_ANTHROPIC_API_KEY=
ASSISTANT_ANTHROPIC_MODEL=
ASSISTANT_ANTHROPIC_MODEL_CANDIDATES=
ASSISTANT_ANTHROPIC_VERSION=2023-06-01
ASSISTANT_ANTHROPIC_WORKSPACE_ID=
ASSISTANT_COMPATIBLE_BASE_URL=
ASSISTANT_COMPATIBLE_APPROVED_ORIGIN=
ASSISTANT_COMPATIBLE_API_KEY=
ASSISTANT_COMPATIBLE_MODEL=
ASSISTANT_COMPATIBLE_MODEL_CANDIDATES=
ASSISTANT_COMPATIBLE_PROTOCOL=chat
ASSISTANT_COMPATIBLE_TOKEN_PARAMETER=max_tokens
ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP=false
```

For a compatible HTTPS service, set its exact origin separately (for example `https://ai-gateway.example`) and its base URL (for example `https://ai-gateway.example/v1`). A server-side API key is required. Redirects and credentials, query strings or fragments in endpoint URLs are rejected. `ASSISTANT_COMPATIBLE_PROTOCOL=responses` selects a Responses-compatible gateway; chat gateways that require the newer token parameter can use `ASSISTANT_COMPATIBLE_TOKEN_PARAMETER=max_completion_tokens`.

For an explicitly installed local Ollama-compatible service, an example base URL is `http://127.0.0.1:11434/v1`, with approved origin `http://127.0.0.1:11434` and `ASSISTANT_COMPATIBLE_ALLOW_LOCAL_HTTP=true`. Only loopback HTTP is accepted, and that mode does not require a provider key. The service must be reachable from the API process: loopback inside a container addresses that container. Remote network services use HTTPS and an approved origin.

Anthropic keys that are not scoped to one workspace also require `ASSISTANT_ANTHROPIC_WORKSPACE_ID`. Model availability and credentials must be verified with the selected service account. The automated adapter tests use synthetic responses; they do not certify production provider accounts or incur paid model requests.

The implementation accepts the older `ASSISTANT_GROK_*` spelling for migration, but new configurations should use `ASSISTANT_GROQ_*`. This release retains the existing Gemini/Groq default model lists. Confirm model access in the provider console for the account and region in use, and set the model and fallback settings when that account requires different IDs.

For local development, set values in the root `.env.local`, stop the current development process, and restart it so the API reloads its configuration:

```bash
pnpm dev
```

For production, configure the same variables in the existing owner-controlled API environment and follow the [VM API-first release procedure](../deploy/oracle/README.md). Do not commit environment files or place keys in public frontend build arguments.

## Data sent to a provider

When a provider is configured, the API sends the current question, up to 12 recent conversation messages, up to four matching approved Markdown excerpts, the caller's role, and a bounded snapshot (up to eight assets, 12 connected devices, and eight incidents). The snapshot can contain asset names and AAS identifiers, type, manufacturer/model, location/zone, lifecycle stage and revision; connected device and gateway IDs/status; the latest stored telemetry fields; and recent incident codes/status/timestamps. Demo rows are marked simulated. The API excludes provider keys, database credentials, connection endpoints, full AAS models/packages, account details, and machine-control commands.

The snapshot is loaded when each question is submitted. It is not persisted as assistant chat history. The UI shows the context capture time, matched sources and actual execution route. If the database or selected external provider is unavailable, the Assistant reports that limitation and falls back to approved local guides and any available snapshot.

External providers process prompts under their own service terms and retention settings. Before enabling this feature with production assets, assess the data fields above against the organization's confidentiality, residency, and AI-provider policies. Set `ASSISTANT_PROVIDER=disabled` to prevent external transmission. Set `ASSISTANT_INCLUDE_LIVE_CONTEXT=false` to omit the database snapshot while retaining guide-based answers.

## Retrieval and answer boundaries

The source allowlist lives in `server/assistantKnowledge.ts`; only listed focused Markdown guides are searchable. README files are deliberately excluded. Keep the allowlist synchronized with the documentation copies in `Dockerfile`. Sections are ranked against the question and only the top matches are sent to the model. Runtime data comes from the API database; it is not invented demo data generated by the model. The assistant prompt requires it to identify simulated records and report when current information is unavailable. Answers should start with a direct response, use plain language, and give numbered steps for how-to questions.

Treat generated guidance as advisory. Confirm maintenance and safety procedures against approved site documentation and equipment manuals. Machine control and emergency-stop functions remain outside this Assistant.

## Provider references

- [Google Gemini OpenAI-compatible API](https://ai.google.dev/gemini-api/docs/openai)
- [Google Gemini model list](https://ai.google.dev/gemini-api/docs/models)
- [Groq OpenAI-compatible API](https://console.groq.com/docs/openai)
- [Groq production models](https://console.groq.com/docs/models)
- [Groq model deprecations](https://console.groq.com/docs/deprecations)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Anthropic Messages and authentication](https://platform.claude.com/docs/en/api/overview)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
