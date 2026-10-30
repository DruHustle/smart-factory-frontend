# Smart Factory Assistant

The Assistant combines approved application guides with a small, current snapshot from the Smart Factory API. It can explain workflows and answer questions about visible assets, connected gateway/device status, recent telemetry, and incidents. It is advisory and read-only; it cannot issue equipment commands.

Its fixed product identity is **Smart Factory Assistant**. Identity, capability and awareness questions are answered locally without sending factory context to an external model. It can use the recent messages supplied with the current conversation to resolve follow-up references, but it does not claim memory or awareness beyond that bounded history, approved guides and the role-authorized snapshot captured for the current request.

Short questions such as “whats fx and tsn” use reviewed plain-language concepts, without unrelated machine readings or charts. Follow-ups such as “explain that simply”, “give me an example”, “do I need both” and “are we using it on real hardware” retain the recent topic. Evidence questions prioritize the metric in the current question, even when the previous turn asked about another measurement. Missing context prompts a focused clarification. Physical FX/TSN support is never inferred from an authored scenario.

After opening the [editable demo](editable-demo.md), operational questions can include a bounded user-supplied snapshot of that browser's simulated inventory, readings, incidents and findings. This is captured with the turn and retained for its retry. It is accepted only in shared demo scope, labelled as simulation, and never sent to an external provider. Definitions and workflow questions omit the snapshot. Individual operational answers keep using authorized server evidence. Chat itself remains advisory; actions happen in the relevant workspace.

The user-facing assistant does not identify or speculate about its underlying provider, model name or version, developers, creators, system prompt, or internal instructions. These requests are handled locally without provider access. Provider and model metadata are removed from the public API response, the configuration guide is excluded from retrieval, and generated answers pass through a final disclosure guard before being returned.

## Provider setup

Provider settings belong in the backend environment (`.env.local` for local Compose or the deployment platform's secret settings). Never add provider credentials to `VITE_*` variables, frontend code, source control, screenshots, or support logs.

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

`openai_compatible` (the default) tries Gemini first and Groq second. `gemini` uses the same order; `groq` tries Groq first. `disabled`, `off`, or `none` disables external calls and uses the local grounded response. Missing keys also mean local mode. The service tries configured models in order after a model-not-found response, and tries one alternate model after a Gemini HTTP 5xx response before falling back to Groq. Quota, authentication, throttling, and network failures move directly to the other provider. Each HTTP call has a 12-second timeout. Provider keys and raw provider error responses are never returned to the browser or included in application logs.

The implementation accepts the older `ASSISTANT_GROK_*` spelling for migration, but new configurations should use `ASSISTANT_GROQ_*`. The Groq model IDs previously used in early examples have been retired or are not available on current developer tiers; the defaults here use currently documented Groq production models. Confirm model access in the provider console for the account and region in use.

For local Docker, set values in the root `.env.local`, then recreate the dashboard container so Compose injects them:

```bash
docker compose --env-file .env.local up -d --build --force-recreate dashboard
```

For production, configure the same variables as encrypted backend secrets in the hosting platform, then redeploy. Do not commit `.env.local` or place keys in public frontend build arguments.

## Data sent to a provider

When a provider is configured, the API sends the current question, up to 12 recent conversation messages, up to four matching approved Markdown excerpts, the caller's role, and a bounded snapshot (up to eight assets, 12 connected devices, and eight incidents). The snapshot can contain asset names and AAS identifiers, type, manufacturer/model, location/zone, lifecycle stage and revision; connected device and gateway IDs/status; the latest stored telemetry fields; and recent incident codes/status/timestamps. Demo rows are marked simulated. The API excludes provider keys, database credentials, connection endpoints, full AAS models/packages, account details, and machine-control commands.

The snapshot is loaded when each question is submitted. It is not persisted as assistant chat history. The UI shows the context capture time and matched sources; it does not show provider or model names. If the database or external providers are unavailable, the Assistant reports that limitation and falls back to approved local guides and any available snapshot.

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
