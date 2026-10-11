# Agent runtime/provider evidence

Retrieved **2026-10-10**. This document records external evidence, not proof that a provider account, model, or connector has been tested in IZGE. Cloud inference is not local/on-premise inference, even when a bridge runs locally.

## Exact provider contracts

### Z.ai GLM-5.3-Flash

- API model: `glm-5.3-flash`; do not replace it with FlashX or another generation. The model supports streaming, function calling and structured output, but thinking **cannot be disabled**. [Official model page](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- Standard API base: `https://api.z.ai/api/paas/v4/`; API keys belong in backend environment/secrets. [Official OpenAI-compatible client guide](https://docs.z.ai/guides/develop/openai/python)
- `POST /chat/completions`, bearer authorization, `messages`; `stream:true` produces SSE ending in `[DONE]`. Model-specific effort choices are `low`, `high`, `max` (default `max`), despite the generic reference listing other values for older models. `response_format:{"type":"json_object"}` is JSON mode, not a promise of strict JSON Schema. `tool_stream:true` enables streamed tool arguments. [API reference](https://docs.z.ai/api-reference/llm/chat-completion)
- Tool continuations using preserved thinking must return original, ordered `reasoning_content`; do not display it as user-facing reasoning. [Thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode)
- The Coding Plan restricts usage to supported tools and prohibits shared/multi-user subscriber access. Its `/api/coding/paas/v4` endpoint is therefore not a drop-in commercial shared-service entitlement. Use the standard API contract for this integration. [Coding Plan usage policy](https://docs.z.ai/devpack/usage-policy)

### DeepSeek-V4.1-Flash

- The current official API identifier is **`deepseek-flash`**, not `deepseek-4.1-flash`. It resolves to V4.1-Flash; old V4 Flash names temporarily alias it. [Release announcement](https://api-docs.deepseek.com/news/news260910/), [model table](https://api-docs.deepseek.com/quick_start/pricing/)
- OpenAI-format base `https://api.deepseek.com`, `POST /chat/completions`, bearer key. Efforts: `none`, `low`, `high`, `max`; default `high`. Compatibility aliases `minimal→low`, `medium/xhigh→high` should not be presented as distinct native effort levels. Thinking can be disabled. Streaming uses SSE ending `[DONE]`; read visible `delta.content` separately from `reasoning_content`. `response_format:{"type":"json_object"}` also needs a JSON instruction. Validate tool arguments locally. Forced/named tool choice is unsupported while thinking is enabled. [Chat API reference](https://api-docs.deepseek.com/api/create-chat-completion/)

## Requested Codex-subscription adapter: upstream, not official API contract

Inspected `simonw/llm-openai-via-codex` at **`ba5b0234b9850440b8a4a4eb97faa9667dbe0761`**:

- [`llm_openai_via_codex.py:L19-L100`](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/llm_openai_via_codex.py#L19-L100): reads `$CODEX_HOME/auth.json` (default `~/.codex`) with `auth_mode=chatgpt`; takes OAuth access token and account ID; refreshes expiring credentials and writes tokens back.
- [`L113-L193`](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/llm_openai_via_codex.py#L113-L193): refresh endpoint `https://auth.openai.com/oauth/token`; model discovery `https://chatgpt.com/backend-api/codex/models?client_version=1.0.0`. Uses bearer token plus `ChatGPT-Account-ID`. The upstream fallback model list is not availability evidence.
- [`L199-L262`](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/llm_openai_via_codex.py#L199-L262): plugin effort enum only includes `low/medium/high/xhigh`; this is narrower than newer model documentation. Do not silently map requested `none/max` to another effort.
- [`L338-L417`](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/llm_openai_via_codex.py#L338-L417): sends Responses-format requests to `/responses` with `model,input,instructions,store:false,stream:true,reasoning:{effort}`. Supports function definitions and `text.format` JSON schema. Handles `response.output_text.delta`, function-call `response.output_item.done`, and `response.completed`; does not request/process reasoning summaries.
- [Pinned license](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/LICENSE): Apache-2.0. Code licensing does **not** establish subscription account sharing, resale rights, provider SLA, or future private-endpoint compatibility. The [README](https://github.com/simonw/llm-openai-via-codex/blob/ba5b0234b9850440b8a4a4eb97faa9667dbe0761/README.md#L8-L25) is a third-party usage statement, not an OpenAI service contract.

Implementation handoff: fail explicitly on missing login/model, expired auth, or incomplete SSE; never silently select another model. Keep credentials on the local host behind an authenticated bridge rather than exposing the whole Codex directory to shared containers. Serialize any credential refresh. GPT model/effort availability must be checked against the authenticated account and an actual request; public API documentation alone cannot prove private-endpoint compatibility.

## Real activity, safe summaries, bounded delegation

- OpenAI reasoning summaries are opt-in (`reasoning.summary:"auto"`) and differ from raw reasoning tokens; support is model-dependent. The documented output is a reasoning item's `summary` array. [Official reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
- Actual agent runtimes distinguish tool calls, tool results, handoffs and text events. UI updates should come from real execution boundaries, not a timer or generic hard-coded sequence. [Official Agents SDK streaming guide](https://openai.github.io/openai-agents-python/streaming/)
- Agents-as-tools retain one manager owning the final reply; handoffs transfer conversation control. A bounded independent review is the former pattern. [Official orchestration guide](https://openai.github.io/openai-agents-python/multi_agent/). Turn limits terminate runaway loops. [Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- Suggested application policy (not an upstream mandate): show validated plans and concise **activity summaries**, never raw `reasoning_content`; emit started/completed/failed with tool name and safe result counts. Reviewer UI requires an actual separately prompted model invocation; cap depth/calls/time. No useful review means no delegation event. Capability/self-description replies should not invent corporate citations; company factual claims still need retrieved evidence.

## Optional external tools

### Brave web search

`GET https://api.search.brave.com/res/v1/web/search?q=...&count=5` with `X-Subscription-Token`; `web.results` holds `title,url,description`; optional `extra_snippets=true`. A search snippet is not evidence that the full page was read. [Official web-search reference](https://api-dashboard.search.brave.com/app/documentation/web-search)

Suggested boundary: operator-enabled, fixed provider URL, backend key, bounded query/results/time; no private company data in queries without appropriate authorization. No configured key means unavailable, not a simulated successful search.

### Company MCP: explicitly limited compatibility target

Target **MCP 2025-06-18 Streamable HTTP**, not every MCP transport/version:

1. `initialize` with supported protocol version, client capabilities and client info; verify returned version/capabilities, then `notifications/initialized`. [Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
2. POST JSON-RPC to the configured endpoint, accepting both JSON and SSE. Preserve `Mcp-Session-Id` and send negotiated `MCP-Protocol-Version` on later requests. Notifications receive 202 without body. SSE may contain unrelated notifications before the matching response; match JSON-RPC ID. [Transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
3. Discover `tools/list`, call only explicitly operator-approved names via `tools/call`; validate arguments and handle `isError`. Annotations are not a permission boundary and are untrusted unless the server is trusted. [Tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

Suggested boundary: fixed trusted endpoints and explicit read-only allowlist; no redirects, arbitrary model-provided URLs, automatic resource fetching, sampling, elicitation or server-supplied system instructions. Cap bytes/time/iterations and preserve workspace/participant access rules. Metadata saying “read-only” is insufficient on its own. OpenAI also documents narrow `allowed_tools` and approval for sensitive actions. [Official MCP security guidance](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## Verification still required

This evidence does not establish installed-account access, paid balance, cloud confidentiality terms, successful live connector execution, or production multi-user suitability. Runtime tests must distinguish real upstream calls from mocked transport/contract tests. Neither an adapter running on localhost nor `store:false` makes cloud inference on-premise.
