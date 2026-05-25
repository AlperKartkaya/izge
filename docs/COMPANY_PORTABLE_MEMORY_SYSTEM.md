# Company-portable memory system refactor

This document captures the implementation contract for turning Izge from a single demo into a company-portable memory system that can run on any customer-controlled machine while preserving the PRD promises: evidence-backed answers, contradiction/drift detection, explicit memory organization, and governed AI assistance.

## Target end state

Izge should be deployable for any company as a self-contained workspace with:

1. **Evidence substrate / fast retrieval foundation** — every uploaded or pasted artifact becomes a checksum-backed source root, ordered chunks, full-text retrieval rows, and permission/review-filtered evidence packets.
2. **Temporal knowledge graph** — extracted decisions, assumptions, constraints, outcomes, and commitments become claim occurrences that can be active, contested, stale, superseded, or first-seen across time.
3. **Typed context assembly** — query-time context is assembled from typed memory objects, graph neighbors, selected evidence, omitted-evidence reasons, and uncertainty notes instead of handing raw documents to an LLM.
4. **Bounded internal orchestration** — an orchestrator may divide work into specialist stages, but each stage receives a typed context packet and returns cited output that passes deterministic provenance gates.
5. **Demo UI/storytelling** — the app shows the memory file-system, graph, orchestration, evidence, and scenario impact surfaces directly instead of asking viewers to infer them from backend internals.
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

Tables: `signals`, `query_runs`, `query_trace_steps`, `orchestration_stage_runs`, `audit_events`

Rules:

- Signals are durable proactive findings from evidence-backed memory, not generic alerts.
- Query traces must show route decision, bounded orchestration, typed context assembly, provenance verification, evidence selection, answer composition, and uncertainty.
- Orchestration stage runs persist the replayable stage ledger for each bounded query execution without exposing raw source paths or hidden artifact content.
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
8. **Provenance verifier** — reject unsupported stage output before it reaches the user.

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

Startup bootstrap now creates the additive demo tables/columns and fails loudly if the critical portable-memory schema is incomplete (`artifacts`, `query_runs`, `query_trace_steps`, and `orchestration_stage_runs`). That protects existing company databases from silently missing the stage ledger; destructive or shape-changing migrations still need explicit versioned migration tooling.

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

The Docker volume `izge_data` stores:

- `/data/izge.db`
- `/data/storage/`
- `/data/pasted/`
- `/data/bootstrap_admin_credentials.json`

Because `IZGE_DEFAULT_ADMIN_PASSWORD` is empty in `docker-compose.yml`, the backend generates a bootstrap admin password and writes it to the persisted credentials file on first run.

### Company operator commands

Use these commands when moving the same company memory system across machines or before risky maintenance:

```bash
# Prove the backend image can run the full seed/evidence/orchestration eval.
scripts/docker-smoke-eval.sh

# Export SQLite, uploaded artifacts, pasted text, and bootstrap credentials.
scripts/docker-backup.sh

# Restore only after stopping the app; --force is required by design.
docker compose down
scripts/docker-restore.sh backups/<backup-file>.tar.gz --force
```

Restore refuses to run while Compose services are active unless `IZGE_RESTORE_ALLOW_RUNNING=1` is set. Backups are written under `backups/`, which is intentionally ignored by git because the archive can contain company data and credentials.

If using a local/private LLM on the host machine, point the backend at it with:

```yaml
IZGE_LOCAL_LLM_BASE_URL: http://host.docker.internal:11434
```

LLM features remain opt-in through the existing `IZGE_LOCAL_LLM_ENABLED`, routing, signal explanation, and answer synthesis flags.

## UI surfaces added by this refactor

- **Memory FS** — shows artifacts, safe logical locators, chunk/memory/signal counts, trust boundaries, database organization, and step-by-step company setup guidance.
- **Graph** — includes a temporal knowledge graph panel showing claim occurrences and temporal edge count.
- **Orchestrate** — shows bounded stage catalog, spawn policy, current runtime boundary, trace reflection counts, and bounded scenario impact lookup.
- **Query traces** — include typed context assembly and bounded orchestration trace steps.

## Bounded scenario templates

Scenario support is now a template-guided impact lookup. It classifies the scenario into one of these bounded lenses, then returns only evidence-backed memory objects and review questions:

- **Launch acceleration or delay** — launch, rollout, onboarding, activation, adoption, and enterprise-pipeline changes.
- **Pricing or packaging change** — pricing, packaging, monetization, plan, tier, discount, and revenue changes.
- **Platform migration or architecture shift** — migration, infrastructure, database, backend, vendor, and integration changes.
- **Compliance, security, or audit requirement** — security approval, compliance, privacy, legal, audit, and regulatory-risk changes.
- **Org, ownership, or staffing change** — owner, team, reorg, support, staffing, process, and handoff changes.

The demo UI reads template prompts from `/api/scenario/templates` so the visible company lenses stay aligned with the backend catalog. Every scenario response includes a `scenario_context_packet.v1` with:

- packet id derived from scenario hash, input snapshot, classifier version, template-catalog version, structured deterministic ranking recipe, selected memory IDs, candidate snapshot hash, and budget limit;
- primary template plus candidate template lenses when a scenario spans multiple domains;
- selected memory refs, permission-filtered candidate memory snapshot refs, selected evidence refs, selected artifact IDs, omission reasons, and evidence budget;
- a deterministic-selection replay contract that disallows forecasting and trusted writes.

## Evaluation coverage

The isolated seed evaluation is the current portability/readiness gate:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

The Docker equivalent is:

```bash
scripts/docker-smoke-eval.sh
```

In addition to the original lineage, contradiction, drift, next-action, proactive-signal, review-governance, and permission-redaction checks, the eval now verifies:

- memory file-system roots, database blueprint, organization guide, safe logical locators, downstream counts, and absence of raw source paths;
- temporal knowledge graph occurrences, claim-family keys, evidence-backed links, and absence of raw source paths;
- bounded orchestration traces, typed context packet traces, provenance-verification traces, persisted stage-run ledgers, truthful stage statuses, spawn policy, and scoped reflection counts;
- bounded scenario support with all template probes, catalog endpoint alignment, typed scenario context packets, deterministic replay identity, evidence-backed impacted memory, and explicit “not unsupported forecasting” uncertainty;
- member redaction across memory file-system, temporal graph, scenario impact, and orchestration aggregate endpoints.

## Future implementation plan

### Phase 1 — retrieval substrate hardening

- Add explicit chunk-neighbor traversal for context windows.
- Extend the typed `context_assembly` packet with token estimates and retrieval latency once the first latency budget is defined.
- Add tests that verify rejected/restricted artifacts cannot enter memory FS, temporal graph, scenario impact, or query traces.

### Phase 2 — temporal KG persistence

- Add `claim_families` and `claim_occurrences` tables once the read model stabilizes.
- Persist status transitions such as first-seen, active, contested, stale, superseded.
- Add graph timeline filters by claim family, artifact, owner, date, and status.

### Phase 3 — typed context packets

- Introduce a shared `ContextPacket` schema used by query, scenario, and future orchestration stages.
- Add packet size budgets, omission reasons, and verifier checks.
- Make answer composition consume packet JSON rather than ad hoc payloads.

### Phase 4 — real bounded sub-agent runtime

- Execute stages concurrently only when their inputs are independent.
- Store stage runs and stage outputs in durable tables.
- Let the orchestrator compare stage outputs, but keep provenance verifier deterministic.
- Add replay mode for demos and audits.

### Phase 5 — company deployment hardening

- Add scheduled/off-host backup guidance on top of the manual Docker backup/restore commands.
- Promote startup schema readiness checks into explicit versioned migrations before changing, renaming, or dropping table shapes.
- Add HTTPS and auth hardening for customer-controlled deployments.
- Add CI automation around the documented Docker smoke eval.

### Phase 6 — scenario support expansion

- Persist scenario packet runs so deterministic-selection summaries can be compared across time and replayed under current permissions.
- Keep outputs bounded to impacted memory and review questions unless trusted evidence supports stronger recommendations.
- Add evaluator fixtures for unsupported-forecast refusal behavior.
