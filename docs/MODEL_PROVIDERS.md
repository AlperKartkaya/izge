# Agent model providers

İzge defaults to the existing local Ollama model. A single worker run selects one immutable provider and effort through `model_session`; streaming and structured calls use that same selection.

| Profile | Exact model | Data boundary | Default effort | Available effort |
| --- | --- | --- | --- | --- |
| `ollama` | `IZGE_LOCAL_LLM_MODEL` | Local Ollama | `none` | `none` |
| `onprem` | `IZGE_AGENT_ONPREM_MODEL` | Company-owned OpenAI-compatible server | `none` | `none`, `low`, `medium`, `high`, `xhigh`, `max` |
| `glm` | `glm-5.3-flash` | Z.ai cloud | `low` | `low`, `high`, `max` |
| `deepseek` | `deepseek-flash` | DeepSeek cloud | `none` | `none`, `low`, `high`, `max` |
| `codex` | `gpt-6-luna` | Local bridge to the ChatGPT Codex service | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, `max` |

Unsupported efforts fail instead of being silently changed. API keys and bridge tokens are read only from backend environment variables; catalog output never returns credentials or endpoint URLs.

## Local Codex bridge

The bridge follows `simonw/llm-openai-via-codex` at commit `ba5b0234b9850440b8a4a4eb97faa9667dbe0761`: it borrows the existing `auth_mode=chatgpt` Codex login and sends Responses API traffic to the Codex backend. Run it on the host so the application container never receives `~/.codex/auth.json`.

This is an unofficial adapter over a private ChatGPT Codex endpoint, not the public OpenAI API. The endpoint or accepted model settings can change; keep Ollama as the fallback and smoke-test Codex after upgrades.

```sh
python3 scripts/setup-codex-bridge.py
scripts/local-demo.sh
```

On this Mac, a user LaunchAgent runs on **127.0.0.1:8766**. Docker Desktop
reaches it through `host.docker.internal:8766`; no LAN binding is needed.
The installer keeps a private runtime copy/token in
`~/.local/share/izge/model-bridge/` (mode 700, files 600), updates that exact
service, and never copies OAuth credentials into containers.
Unlike upstream, it treats Codex credentials as read-only: when the access
token expires, let Codex refresh it or run `codex login`, then retry.
**The bridge is local; GPT inference is still in the cloud.**

## Private keys and deployment

Place canonical `IZGE_*` variables in repo-root `.env` for Compose, or the hosting
provider's secret-variable UI for production:

```dotenv
IZGE_AGENT_GLM_API_KEY=your-private-standard-api-key
IZGE_AGENT_DEEPSEEK_API_KEY=your-private-api-key
IZGE_AGENT_WEB_SEARCH_KEY=your-brave-key
```

`scripts/local-demo.sh` runs generic Docker Compose; API and worker share the environment.
Legacy short aliases are no longer rewritten by a control-plane helper.
The local bridge URL/token must be supplied explicitly through
`IZGE_AGENT_CODEX_BRIDGE_BASE_URL` and `IZGE_AGENT_CODEX_BRIDGE_TOKEN`.
Never copy local OAuth tokens or `~/.codex` into hosted images.
See [hosted deployment](DEPLOYMENT.md) for Render/Railway and model prerequisites.

Configure the shared company server with `IZGE_AGENT_ONPREM_BASE_URL`,
`IZGE_AGENT_ONPREM_MODEL`, and optionally `IZGE_AGENT_ONPREM_API_KEY`.
One selected backend gateway serves all employees; their browsers do not
connect to the model directly.

## Real actions and limits

The selected model creates a typed, bounded plan: capabilities/general questions
skip company retrieval; company questions read files, visible tasks and signals.
Sources are permission-checked for **every conversation reader**. Both web and
MCP require explicit per-request external-tool consent. MCP additionally requires
operator-configured workspace/user/tool allowlists and a supported input schema.
All tools are read-only; file contents cannot grant permissions.

Only actual call boundaries create UI events: planning, retrieval (real counts),
web/MCP calls, answer generation, a separately prompted reviewer, source
validation and follow-up generation. The reviewer is a real second call to the
same selected model, not a fictional separate employee. An operator can force
review or the planner can request it for complex comparisons. Completed stages
replace pending stages; the history remains available after the answer.
Displayed summaries are short work plans/results, **not raw private reasoning**.
Missing/invalid citations get one real-model repair, never fabricated references.
General capability responses need no made-up source. Capability-only questions
are classified by the real model, then answered from authoritative runtime
permissions rather than letting the model invent its own tools. This is a
policy-generated capability overview, not a simulated company analysis.

MCP config is a backend-only JSON array in `IZGE_AGENT_MCP_CONNECTORS_JSON`:
```json
[{"id":"company-docs","url":"http://company-mcp.internal/mcp","workspace_id":"YOUR_WORKSPACE","allowed_user_ids":["YOUR_USER"],"tools":[{"name":"search","description":"Read company documents","input_schema":{"type":"object","properties":{"query":{"type":"string","maxLength":300}},"required":["query"],"additionalProperties":false}}],"token_env":"COMPANY_MCP_TOKEN"}]
```
Put the token named by `token_env` in the private `.env` too; the local helper
forwards only explicitly referenced MCP tokens alongside `IZGE_AGENT_*` settings.
Never embed secrets in connector descriptions or arguments.

## Boundaries

- `onprem` accepts only loopback, private IPs, or `.local`/`.internal`/`.lan` hosts unless the explicit public-host flag is enabled.
- GLM and DeepSeek deliberately send prompts to external cloud services when selected.
- A configured profile is not proof that credentials, subscription access, or the exact model are live; run a smoke request in the target environment.
- On-premise reasoning effort is forwarded only when it is not `none`; the selected company gateway must support that OpenAI-compatible extension.
- Legacy ingestion helpers continue to use Ollama; this provider layer is for İzge agent runs.
