# Company-portable memory system refactor

This document captures the implementation contract for turning Izge into a company-portable memory system that can run on any customer-controlled machine while preserving the PRD promises: evidence-backed answers, contradiction/drift detection, explicit memory organization, and governed AI assistance.

## Target end state

Izge should be deployable for any company as a self-contained workspace with:

1. **Evidence substrate / fast retrieval foundation** — every uploaded or pasted artifact becomes a checksum-backed source root, ordered chunks, full-text retrieval rows, and permission/review-filtered evidence packets.
2. **Temporal knowledge graph** — extracted decisions, assumptions, constraints, outcomes, and commitments become claim occurrences that can be active, contested, stale, superseded, or first-seen across time.
3. **Typed context assembly** — query-time context is assembled from typed memory objects, graph neighbors, selected evidence, omitted-evidence reasons, and uncertainty notes instead of handing raw documents to an LLM.
4. **Bounded internal orchestration** — an orchestrator may divide work into specialist stages, but each stage receives a typed context packet and returns cited output that passes deterministic provenance gates.
5. **Product UI/storytelling** — the app shows the memory file-system, graph, orchestration, evidence, and scenario impact surfaces directly instead of asking viewers to infer them from backend internals.
6. **Bounded scenario support** — scenario questions identify which known assumptions, commitments, constraints, decisions, and outcomes need review; they do not fabricate forecasts.
7. **Portable runtime** — Docker Compose starts the backend, frontend, SQLite database, persisted artifact storage, and reverse proxy on a clean machine.

## Database organization guide

Use the database like an internal agentic file-system, not a generic document bucket.

### 1. Workspace boundary

- Run one isolated workspace per company or pilot.
- Keep SQLite plus artifact storage in a customer-controlled volume.
- For production scale, promote the same tables into a company-isolated schema or database; do not mix companies in one ungoverned namespace.

### 2. Source artifact roots

Tables: `artifacts`, `artifact_permissions`

Rules:

- Store raw artifacts first, before extraction or LLM work.
- Preserve `checksum_sha256`, `source_type`, `mime_type`, visibility, review status, uploader, and timestamps.
- Treat `artifact://<artifact_id>/source` as the safe logical locator shown to users.
- Do not expose host filesystem paths in the UI or query context.

### 3. Evidence chunk leaves

Tables: `artifact_chunks`, `artifact_chunks_fts`

Rules:

- Chunks are the retrieval leaves under each artifact root.
- Keep chunk order and metadata such as `char_start`, `char_end`, `logical_locator`, neighboring chunk IDs, and coverage status.
- Retrieval may use FTS, but selected chunks still need permission/review filtering before reasoning.

### 4. Typed memory objects

Tables: `decisions`, `assumptions`, `constraints`, `outcomes`, `commitments`

Rules:

- Every memory object must carry source artifact and source chunk pointers.
- Memory rows are the reasoning substrate for lineage, contradiction, drift, and next-action guidance.
- Confidence is metadata, not evidence; cite source spans and chunks when presenting output.

### 5. Temporal knowledge graph

Tables: `graph_nodes`, `graph_edges`

Rules:

- Graph nodes wrap typed memory objects.
- Edges must have evidence and confidence.
- Temporal read models should group claim occurrences by family and show status changes over time.
- Future graph evolution should add explicit claim-family and claim-occurrence tables only after the current read model is proven useful.

### 6. Signals, traces, and governance

Tables: `signals`, `query_runs`, `query_trace_steps`, `orchestration_stage_runs`, `orchestration_jobs`, `scenario_runs`, `audit_events`

Rules:

- Signals are durable proactive findings from evidence-backed memory, not generic alerts.
- Query traces must show route decision, bounded orchestration, typed context assembly, provenance verification, evidence selection, answer composition, and uncertainty.
- Orchestration stage runs persist the replayable stage ledger for each bounded query execution without exposing raw source paths or hidden artifact content.
- Orchestration jobs provide a portable DB-backed worker queue: create a bounded payload, let the worker daemon claim it with a lease, complete/fail/cancel it with structured result metadata, and expose safe job state through `/api/evidence-substrate/orchestration/jobs`.
- Scenario runs persist bounded impact packets for deterministic replay.
- Audit events prove who uploaded, reviewed, queried, and changed governance state.

## Bounded orchestration contract

The orchestrator LLM may divide work into stages, but it must never receive unrestricted authority.

Recommended stage sequence:

1. **Orchestrator plan** — classify intent into lineage, contradiction, assumption drift, next action, memory organization, or bounded scenario support.
2. **Evidence indexer** — gather visible artifacts/chunks and explain omitted evidence.
3. **Memory extractor** — extract typed memory objects with source pointers.
4. **Graph linker** — create graph nodes/edges only with evidence.
5. **Contradiction interrogator** — compare explicit conflicting memory pairs.
6. **Assumption drift interrogator** — compare assumptions against later evidence and signals.
7. **Guidance planner** — compose next actions from contradictions, stale assumptions, and commitments.
8. **Worker queue dispatcher** — persist bounded asynchronous stage tasks in `orchestration_jobs` so the local/deployed worker daemon can claim, lease, complete, fail, and replay work without bypassing the typed context packet boundary.
9. **Provenance verifier** — reject unsupported stage output before it reaches the user.

Every sub-agent/stage packet should include:

- `workspace_id`
- `task_kind`
- `allowed_memory_types`
- `selected_artifact_ids`
- `selected_chunk_ids`
- `selected_memory_ids`
- `omitted_reasons`
- `permission_scope`
- `review_scope`
- `output_schema`
- `max_items`
- `uncertainty_policy`

The current query runtime now persists this as a `context_packet.v1` trace payload with a paired `provenance_verifier.v1` result. That keeps future sub-agents bounded to selected evidence instead of granting broad database authority.

Each query also writes `orchestration_stage_runs` rows for the bounded stages. Those rows hold packet IDs, stage status, authority level, verifier status, and safe output summaries so the Orchestrate page can replay what happened without granting direct source-file access.

Asynchronous worker-backed work starts in `orchestration_jobs`: `/api/evidence-substrate/orchestration/jobs` enqueues bounded payloads, `python -m app.worker` or the Docker `worker` service claims a lease, validates the payload, and records terminal output. The queue is intentionally DB-backed first so it works on the same customer-controlled SQLite volume as the rest of the app; more distributed worker topologies can be attached later without changing the evidence/provenance contract.

Startup now runs Alembic-backed migration/version tooling. Fresh databases run the baseline revision; verified pre-Alembic SQLite databases are non-destructively repaired for legacy additive columns, stamped at head, and then checked by the portable-memory schema guard. Future schema changes should add explicit revisions under `backend/migrations/versions/` and be verified with `scripts/db-migrate.sh` plus `scripts/db-check.sh`.

Every stage response should include:

- structured findings,
- cited artifact/chunk/memory IDs,
- confidence and uncertainty,
- rejected/omitted candidates,
- deterministic gate result.

## AI evidence discipline

AI wording is allowed only after deterministic context assembly. The answer must:

- state which evidence was selected,
- cite artifact/chunk/memory references,
- state uncertainty when evidence is missing,
- avoid unsupported forecasting,
- leave trace rows that show the stages used,
- never convert an LLM statement into trusted memory without a source artifact.

## Docker runtime

Start the portable app with:

```bash
docker compose up --build
```

Then open:

- Frontend: `http://localhost:8080`
- Backend health: `http://127.0.0.1:8000/health` (bound to loopback for local diagnostics)
- Health through frontend proxy: `http://localhost:8080/health`
- API through frontend proxy: `http://localhost:8080/api/...`

For local development, Docker Compose bind-mounts `backend/data` into the containers as `/data`. That visible host directory stores:

- `backend/data/izge.db` (`/data/izge.db` in containers)
- `backend/data/storage/` (`/data/storage/` in containers)
- `backend/data/pasted/` (`/data/pasted/` in containers)
- `backend/data/bootstrap_admin_credentials.json` (`/data/bootstrap_admin_credentials.json` in containers)

Docker Compose seeds the workspace identities used by the product sign-in screen (`admin@example.com`, `employee1@example.com`, `employee2@example.com`, and `employee3@example.com`) and persists the SQLite database plus artifact storage in `backend/data`. Rotate these credentials before a shared or production deployment.

### Company operator commands

Use these commands when moving the same company memory system across machines or before risky maintenance:

```bash
# Prove/upgrade the configured database schema with Alembic tooling.
scripts/db-migrate.sh
scripts/db-check.sh

# Prove the backend image can run the full seed/evidence/orchestration eval.
scripts/docker-smoke-eval.sh

# Prove the one-company synthetic workflow: Northstar Payroll corpus, permissions,
# prompt injection, scenario replay, rejection, temporal graph, and DB-backed jobs.
scripts/synthetic-company-smoke-eval.sh

# Prove the same eval with local/private Ollama routing plus backend LLM smoke.
scripts/ollama-smoke-eval.sh

# Export SQLite, uploaded artifacts, pasted text, and bootstrap credentials.
scripts/docker-backup.sh

# Restore only after stopping the app; --force is required by design.
docker compose down
scripts/docker-restore.sh backups/<backup-file>.tar.gz --force
```

Restore refuses to run while Compose services are active unless `IZGE_RESTORE_ALLOW_RUNNING=1` is set. Backups are written under `backups/`, which is intentionally ignored by git because the archive can contain company data and credentials.

Docker Compose points the backend and worker at a host Ollama-compatible gateway and enables the bounded LLM features by default:

```yaml
IZGE_LOCAL_LLM_ENABLED: "true"
IZGE_LOCAL_LLM_BASE_URL: http://host.docker.internal:11434
IZGE_LOCAL_LLM_MODEL: qwen3.5:4b
IZGE_LLM_QUERY_ROUTING_ENABLED: "true"
IZGE_LLM_ANSWER_SYNTHESIS_ENABLED: "true"
IZGE_LLM_SIGNAL_EXPLANATION_ENABLED: "true"
```

Run `ollama pull qwen3.5:4b` before `docker compose up --build`, or override `IZGE_LOCAL_LLM_MODEL` to a model that already exists on the host gateway. Deterministic fallback remains the safety path if the gateway is unavailable or a model returns invalid structured output.

## UI surfaces added by this refactor

- **Operations** — admin-only control room for database/storage integrity, artifact coverage, memory freshness, worker queue state, LLM gateway status, trace/replay counts, and operator next actions.
- **Memory FS** — shows artifacts, safe logical locators, chunk/memory/signal counts, trust boundaries, database organization, and step-by-step company setup guidance.
- **Graph** — includes a temporal knowledge graph panel showing persisted claim families, claim occurrences, validity windows, and temporal edge count.
- **Orchestrate** — shows bounded stage catalog, spawn policy, current runtime boundary, trace reflection counts, stage packet IDs, bounded scenario impact lookup, scenario run history, and replay verdicts.
- **Readiness** — maps the website/PRD promises to current product proof, scores target coverage, shows workspace counts, and ranks remaining implementation gaps.
- **Query traces** — include typed context assembly and bounded orchestration trace steps.

## Bounded scenario templates

Scenario support is now a template-guided impact lookup. It classifies the scenario into one of these bounded lenses, then returns only evidence-backed memory objects and review questions:

- **Launch acceleration or delay** — launch, rollout, onboarding, activation, adoption, and enterprise-pipeline changes.
- **Pricing or packaging change** — pricing, packaging, monetization, plan, tier, discount, and revenue changes.
- **Platform migration or architecture shift** — migration, infrastructure, database, backend, vendor, and integration changes.
- **Compliance, security, or audit requirement** — security approval, compliance, privacy, legal, audit, and regulatory-risk changes.
- **Org, ownership, or staffing change** — owner, team, reorg, support, staffing, process, and handoff changes.

The scenario UI reads template prompts from `/api/scenario/templates` so the visible company lenses stay aligned with the backend catalog. Every scenario response includes a `scenario_context_packet.v1` with:

- packet id derived from scenario hash, input snapshot, classifier version, template-catalog version, structured deterministic ranking recipe, selected memory IDs, candidate snapshot hash, and budget limit;
- primary template plus candidate template lenses when a scenario spans multiple domains;
- selected memory refs, permission-filtered candidate memory snapshot refs, selected evidence refs, selected artifact IDs, omission reasons, and evidence budget;
- a deterministic-selection replay contract that disallows forecasting and trusted writes.

Scenario impact calls now persist `scenario_runs` rows. Operators can inspect `/api/scenario/runs`, open a stored run, and replay it through `/api/scenario/runs/{scenario_run_id}/replay`; the replay compares the stored packet/template/input/candidate hashes and selected memory set against current evidence and permissions.

## Evaluation coverage

The isolated seed evaluation remains the fast portability/readiness gate:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

The one-company full workflow gate is:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
```

It ingests the Northstar Payroll synthetic company corpus, creates one restricted confidential memo, verifies query classes and meaningful evidence-backed answers, exercises the DB-backed orchestration job queue, checks scenario replay and prompt-injection boundaries, verifies member redaction, rejects a reversal artifact, and confirms the temporal graph/query surfaces exclude rejected evidence.

The Docker equivalent for the seed lane is:

```bash
scripts/docker-smoke-eval.sh
```

The Ollama-backed equivalent is:

```bash
scripts/ollama-smoke-eval.sh
```

That script first verifies the configured model exists in Ollama, then runs the isolated seed evaluation with query routing and backend LLM smoke enabled through the local/private gateway. It defaults answer synthesis off so the portable smoke remains fast on small local models; set `IZGE_LLM_ANSWER_SYNTHESIS_ENABLED=true` for a deeper wording-generation run. It fails if the gateway is unavailable, the model is missing, LLM smoke fails, or the query trace cannot prove the AI-assisted boundary.

In addition to the original lineage, contradiction, drift, next-action, proactive-signal, review-governance, and permission-redaction checks, the eval now verifies:

- memory file-system roots, database blueprint, organization guide, safe logical locators, downstream counts, and absence of raw source paths;
- temporal knowledge graph persisted families, occurrences, validity windows, claim-family keys, evidence-backed links, projection sync summaries, and absence of raw source paths;
- bounded orchestration traces, typed context packet traces, bounded parallel stage-packet traces, provenance-verification traces, persisted stage-run ledgers, DB-backed orchestration jobs, truthful stage statuses, spawn policy, and scoped reflection counts;
- target readiness coverage across evidence substrate, temporal KG, typed context, bounded orchestration, evidence-backed intelligence, private AI discipline, UI storytelling, bounded scenarios, and Docker portability;
- bounded scenario support with all template probes, catalog endpoint alignment, typed scenario context packets, persisted scenario runs, replay comparisons, deterministic replay identity, evidence-backed impacted memory, and explicit “not unsupported forecasting” uncertainty;
- member redaction across memory file-system, temporal graph, scenario impact, scenario run/replay history, orchestration aggregate endpoints, and target readiness;
- optional local/private LLM status, smoke, trace boundary, and fallback checks.

## Target readiness score

`/api/evidence-substrate/readiness` is the visible “how close are we?” contract. It is intentionally read-only and derived from current workspace evidence plus explicit target-area definitions.

The response includes:

- `target_score` — average readiness across implemented, partial, and planned areas;
- `areas[]` — each website/PRD promise, current product reflection, proof routes, UI surfaces, proof signals, remaining work, and risk notes;
- `current_workspace_snapshot` — safe counts for artifacts, chunks, memory objects, graph edges, claim families, claim occurrences, signals, query traces, stage packet traces, stage runs, scenario runs, scenario templates, and local/private AI feature flags/status;
- `next_best_passes` — the implementation order that keeps evidence substrate and provenance gates ahead of multi-agent runtime expansion.

This endpoint now treats the local bounded parallel stage-packet runtime, DB-backed worker daemon, temporal claim projection, migration-version tooling, and scenario replay history as implemented capabilities. It still ranks CI automation, more customer-corpus answer-quality evaluators beyond Northstar Payroll, worker observability/retry/dead-letter hardening, and production deployment hardening as remaining work.

## Future implementation plan

### Phase 1 — retrieval substrate hardening

- Add explicit chunk-neighbor traversal for context windows.
- Extend the typed `context_assembly` packet with token estimates and retrieval latency once the first latency budget is defined.
- Add tests that verify rejected/restricted artifacts cannot enter memory FS, temporal graph, scenario impact, or query traces.

### Phase 2 — temporal KG persistence

- Keep `claim_families` and `claim_occurrences` as a persisted projection over source memory rows.
- Extend status-transition analytics beyond first-seen, active, contested, stale, and superseded.
- Add graph timeline filters by claim family, artifact, owner, date, and status.

### Phase 3 — typed context packets

- Introduce a shared `ContextPacket` schema used by query, scenario, and future orchestration stages.
- Add packet size budgets, omission reasons, and verifier checks.
- Make answer composition consume packet JSON rather than ad hoc payloads.

### Phase 4 — bounded sub-agent runtime

- Continue executing independent read-only stages through the bounded local parallel stage-packet pool.
- Extend the DB-backed worker daemon with metrics, bounded retry/backoff, dead-letter handling, and safe multi-worker deployment only after preserving typed context packets and deterministic verifier behavior.
- Let the orchestrator compare stage outputs, but keep provenance verifier deterministic.
- Add replay mode for audits and operator rehearsals.

### Phase 5 — company deployment hardening

- Add scheduled/off-host backup guidance on top of the manual Docker backup/restore commands.
- Maintain explicit Alembic revisions and migration smoke checks before changing, renaming, or dropping table shapes.
- Add HTTPS and auth hardening for customer-controlled deployments.
- Add CI automation around the documented migration, Docker, synthetic-company, and Ollama smoke evals.
- Add CI/runner support for `scripts/ollama-smoke-eval.sh` where a local/private model is available.

### Phase 6 — scenario support expansion

- Expand scenario packet run replay into longitudinal diff dashboards.
- Keep outputs bounded to impacted memory and review questions unless trusted evidence supports stronger recommendations.
- Add evaluator fixtures for unsupported-forecast refusal behavior.
