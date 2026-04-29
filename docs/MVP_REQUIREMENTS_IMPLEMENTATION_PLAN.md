# MVP Requirements Implementation Plan

Status date: 2026-04-29
Source of truth: `docs/REQUIREMENTS.md`

This plan tracks what remains to make Izge satisfy the MVP requirements as a coherent institutional-memory and decision-intelligence product. It intentionally avoids broad SaaS, generic RAG, PM-copilot, and future scenario-planning scope.

## Current coverage snapshot

| Area | Current state | MVP gap / risk |
| --- | --- | --- |
| Workspace, roles, permissions | Single bootstrapped workspace, Admin/Member roles, artifact permissions, restricted-output filtering, admin user controls. | Literal multi-workspace creation is not a productized flow; acceptable for single-workspace MVP only if documented as bootstrapped workspace. |
| Artifact intake | Upload, pasted text, local storage, PDF/text/Markdown parsing, member contribution path, ingestion status. | Presentation files are supported only if converted/text-extractable; member contribution could use clearer guided copy. |
| Structured memory | Extracts Decisions, Assumptions, Constraints, Outcomes, Commitments with evidence spans, timestamps, confidence, topic keys, chunk provenance. | Extraction quality needs more seed coverage and LLM fallback observability before relying on varied real documents. |
| Graph and relationships | Typed links, graph summary/timeline/neighborhood, contradiction/supersession/drift support. | Relationship quality is deterministic and demo-scale; needs stronger regression tests before broader artifact sets. |
| Query reasoning | Four locked modes, deterministic evidence selection, optional local LLM routing/synthesis, query trace, permission/review filtering. | Query UX should make LLM-vs-deterministic boundary easier to inspect from the result page. |
| Proactive ingestion intelligence | New artifact triggers contradiction, drift, supersession, continuity, next-action signals; persisted signals have detail pages. | Needs review queue/readiness now added; still needs more demo scripts around conflicting artifact submission. |
| Signals and overview | Dashboard/graph/signals surfaces, persisted signal detail, urgency/uncertainty, intelligence path. | Workspace readiness should remain explicit and avoid analytics-dashboard drift. |
| Admin operations | Users, permissions, artifact review status, review queue, audit events. | Admin audit/readiness views should be kept concise; no enterprise settings bloat. |
| Trust/governance | Restricted evidence and rejected artifacts are excluded from trusted reasoning; review status appears in evidence/memory surfaces. | Need more explicit docs/tests around review status semantics and local inference boundary. |
| LLM integration | Local Ollama-style gateway, extraction, routing, answer synthesis, signal explanation flags, structured validation, deterministic fallback. | Needs health/readiness visibility, live smoke path, and documented MVP acceptance criteria. |
| Deployment stance | Local dev uses local Qwen/Ollama; jury demo uses `app.izge.dev` on EC2 with EC2-local/private LLM; customer target is self-hosted/customer-controlled; managed single-tenant is pilot bridge. | Need automated EC2 LLM readiness checks and deploy-time smoke evidence before jury demo. |
| Demo readiness | Canonical demo prompt, seed eval, dashboard path, signal drill-down. | Need one scripted end-to-end demo runbook and/or fixture reset command that a jury flow can rely on. |

## Implementation plan to close MVP requirements

### Phase 1 — Productize workspace readiness and governance

Goal: make Admins feel the workspace is operationally real and trustworthy.

1. Keep the review queue visible on Dashboard/Admin and ensure it blocks demo readiness only for Admins.
2. Add concise review-status semantics to docs: `submitted`, `needs_review`, `reviewed`, `rejected`.
3. Add regression coverage that rejected artifacts remain stored but do not appear in query support, signal lists, graph summary, or LLM prompts.
4. Add a small admin audit/readiness checklist that links to artifacts, ingestion, signals, and audit events without becoming an enterprise settings console.

Acceptance checks:
- Admin can see which artifacts need review.
- Admin can mark evidence reviewed/rejected.
- Rejected evidence is excluded from trusted intelligence.
- Member never sees hidden/rejected-derived support as a source of truth.

### Phase 2 — Harden the local LLM MVP boundary

Goal: use local LLMs more without turning Izge into generic AI chat or unvalidated RAG.

1. Add a backend local-LLM health endpoint that reports configured model, feature flags, gateway reachability, and last failure mode without exposing prompts or sensitive content.
2. Add a small UI status card for Admins showing whether LLM extraction/routing/synthesis/signal explanation are disabled, active, or falling back.
3. Ensure every LLM call records an inspectable boundary in trace/payload/audit metadata: role, model, status, fallback reason.
4. Confirm all prompts are permission-aware and review-aware before context compaction.
5. Add a tiny structured-prompt smoke test that can run when a local model is available and cleanly skips when unavailable.
6. Keep deterministic extraction/reasoning as the authority: LLM output may propose extraction candidates or wording, not final unvalidated product truth.
7. Wire EC2 deploy verification so `app.izge.dev` proves its local/private LLM gateway is reachable before jury use.

Acceptance checks:
- MVP works with all LLM flags disabled.
- MVP improves with local LLM enabled.
- LLM failures do not break ingestion, query, signal persistence, or demo flow.
- UI makes the inference boundary explicit enough for jury/customer trust.

### Phase 3 — Strengthen member contribution and continuity demo

Goal: make Scenario C credible: prior work prevents repeated work.

1. Add member-facing copy that frames uploads as logs/reports/notes contributing to institutional memory.
2. Make prior relevant work more visible immediately after submission/ingestion, not only inside artifact detail.
3. Add a demo fixture that submits an overlapping report and proves Izge surfaces prior work and recommended reuse/update action.
4. Ensure continuity signals link to both the new artifact and prior artifact evidence with review status.

Acceptance checks:
- Member can contribute an artifact without admin-only concepts dominating the UI.
- Ingesting overlapping work surfaces prior context.
- The user can drill from continuity signal to prior evidence and memory objects.

### Phase 4 — Complete result-page and signal-page inspectability

Goal: make query and signal pages feel like the core intelligence surface.

1. Add clearer result-page sections for evidence chain, memory objects, contradictions, drift, related persisted signals, and LLM/deterministic trace boundary.
2. Add source-artifact links from evidence cards where safe.
3. Add compact ranking-basis displays for contradiction/drift/next-action items.
4. Keep answer wording structured; avoid chatbot transcript patterns.

Acceptance checks:
- A viewer can explain why the answer was produced without reading code.
- Every major claim has evidence or an uncertainty note.
- LLM assistance is visible as wording/routing help, not hidden authority.

### Phase 5 — Demo path and operational reset

Goal: one canonical demo can be repeated reliably.

1. Maintain a seeded evaluation fixture for Scenario A/B/C.
2. Add a scripted demo runbook that starts from source artifacts, runs ingestion, shows proactive signals, asks the canonical question, and drills into evidence.
3. Add a safe local reset/seed command or documented procedure for demo rehearsal.
4. Update `docs/DEMO_SCRIPT.md`, `docs/demo/SCENARIO_WIRING.md`, and manual eval expectations after each demo-affecting change.

Acceptance checks:
- A reviewer can run the demo from docs without hidden tribal knowledge.
- Query-driven, proactive-ingestion, and continuity demos all work end to end.
- Manual eval remains green after seed reset.

### Phase 6 — Reliability, accessibility, and release hardening

Goal: make the MVP stable enough for pre-incubation/jury use.

1. Add unit tests around key deterministic functions: topic overlap, contradiction ranking, drift status, review filtering, LLM JSON extraction.
2. Add graceful loading/error states for ingestion and local LLM fallback.
3. Audit keyboard accessibility and contrast for core pages.
4. Run frontend lint/build, backend build, compile checks, isolated seed eval, and optional local-LLM smoke before every demo milestone.
5. Keep dependencies minimal and avoid premature infra migrations.

Acceptance checks:
- Build and eval pass from a clean checkout.
- Common failure modes become visible status, not silent broken workflows.
- UI remains dark, serious, evidence-first, and product-specific.

## Requirement groups that should be considered fulfilled when the above is complete

- FR-1 to FR-20: workspace, roles, access, artifact intake, ingestion status, review state.
- FR-21 to FR-34: structured memory extraction and graph/relationship modeling.
- FR-35 to FR-48: locked query modes and proactive artifact intelligence.
- FR-49 to FR-63: signal surfaces and inspectable result presentation.
- FR-64 to FR-75: admin visibility, audit, continuity, and anti-duplication.
- LLM-MVP-1 to LLM-MVP-12: company-controlled local LLM integration with deterministic authority and fallback.
- NFR-1 to NFR-46: category integrity, trust, locality, performance, maintainability, accessibility, and demo readiness.

## Explicit non-goals for this MVP closure plan

- No generic chat over files.
- No external hosted AI dependency.
- No future scenario-planning module.
- No distributed employee-edge inference as an MVP requirement.
- No enterprise settings/admin-console sprawl.
- No broad integrations beyond local artifacts and MVP-supported source types.
