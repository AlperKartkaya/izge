# Agent runtime release verification — 2026-10-11

## Delivered

- Runtime-derived steps replace the fixed status sequence. Stage updates replace
  their pending versions; completed work has expandable history.
- A real selected-model planner distinguishes capabilities, general and company
  questions. Capability descriptions come from authoritative runtime permissions
  (TR/EN), not a model inventing its own tools. General/company responses,
  planning, review and follow-up generation use real configured model calls.
- Company retrieval checks every conversation reader; source revocation hides
  derived answers, stages and follow-ups. Citation errors get one real-model
  repair, never fabricated references.
- Public search and operator-allowlisted read-only MCP require per-request consent.
  Model output cannot select arbitrary endpoints or grant permissions. Reviewer
  delegation is a real separate call to the same selected model.
- Ollama, company OpenAI-compatible gateway, GLM, DeepSeek and Codex profiles;
  model/effort settings are snapshotted at enqueue. Browser never receives keys.
- Codex bridge is a persistent loopback macOS LaunchAgent. OAuth stays on host,
  read-only. Responses JSON mode is locally schema-validated: the private endpoint
  rejected unrestricted MCP argument objects in strict JSON Schema mode.

## Evidence

- Backend: **110 tests passed**; frontend: **30 tests passed**, lint/build passed.
- Changed backend services/routes Pyright: **0 errors, 0 warnings**.
- Python scripts compile; both compose configurations and shell syntax validate;
  `git diff --check` passes. Existing bundle-size and datetime deprecation warnings
  remain; no new dependencies were introduced.
- Separate disposable data copy on `8291`: real Ollama and GPT-6 Luna/low
  capability questions and Atlas billing comparisons passed. Actual company
  stages included eight files, a separate reviewer, citations and three follow-ups.
  Atlas result distinguished **36,000 TL + VAT pending approval** from finalized
  receivables. Latest capability policy route was re-tested using the real Ollama
  planner/follow-ups and correctly stated that invoice issuance is unavailable.
- Browser QA: TR/EN model catalog refresh, persisted model/effort selections,
  consent controls, cloud boundary notice, actual completed-step summaries,
  source cards, previews and follow-ups passed.
- Coolify service `rqzkyybf7nkmlb77yxic6ron` deployed current images;
  backend, colleague, frontend and unchanged website are healthy. Product
  `8080/health`, website `8081` and Coolify `8000` return HTTP 200.
- Real GPT-6 Luna and Ollama calls from the deployed product container succeeded.
  Final product browser smoke verified model selection and Team Chat rendering.
- Migration: `aa3e6b192d41` → `bb4f7d203e52`. Counts preserved:
  **10 artifacts, 8 users, 4 tasks, 4 automations**. No QA conversations/uploads
  copied into the presentation DB. Website source untouched; nothing committed.
- Online SQLite/files backup: `backups/pre-agent-runtime-20261011/data.tar.gz`.
  Private detailed evidence: `~/.local/share/izge/agent-qa/` and Coolify runtime.

## Explicit limits

No GLM/DeepSeek keys or live company MCP/Brave credentials were present in the
checked env locations. Their integrations are implemented, but external live
access is **not verified**. MCP transport/permission/schema tests use a real local
HTTP server, not a live customer server. On-prem gateway configuration has no
actual company endpoint to smoke-test yet.

The Codex bridge runs locally, **GPT inference remains cloud-based**; it is an
unofficial private-endpoint adapter, not a public OpenAI API entitlement. This
Mac must remain awake with Docker/Ollama running; it is not a 24/7 production
server. File changes, email sending, mailbox access and ticket closure are not
agent tools in this release. Historical failed/generic-stage runs are retained,
not rewritten to pretend they succeeded. Model analyses still require review.
