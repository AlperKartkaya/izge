# API_SPEC.md
## Izge API Specification

## Core principles
- Evidence-aware and permission-aware by default
- Structured outputs over freeform chat responses
- Separate admin/operational surfaces from member reasoning surfaces
- Support both reactive query flows and proactive post-ingestion signal generation

## Core endpoint coverage

### Authentication and users
- `POST /api/auth/sign-in`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:userId`

### Artifacts and ingestion
- `POST /api/artifacts/upload`
- `POST /api/artifacts/pasted-text`
- `GET /api/artifacts`
- `GET /api/artifacts/:artifactId`
- `POST /api/ingestion/run`
- `GET /api/ingestion/jobs/:jobId`

### Memory and graph
- `GET /api/memory/:memoryId`
- `GET /api/graph/summary`
- `GET /api/graph/timeline`

### Queries and results
- `POST /api/query`
- `GET /api/query/:queryId`

### Signals
- `GET /api/contradictions`
- `GET /api/assumptions/drift`
- `GET /api/next-actions`

### Audit / admin
- `GET /api/audit/events`

## Query request shape
- `query_text`
- `workspace_id`
- optional `preferred_mode`
- optional `filters`

## Query result shape
- `answer_text`
- `why_this_answer`
- `query_class`
- `supporting_memory_objects`
- `supporting_evidence`
- `contradictions`
- `assumption_drift`
- `recommended_next_actions`
- `uncertainty_notes`

## Signal result shape
Each signal item should support fields such as:
- `signal_id`
- `signal_type`
- `title`
- `summary`
- `related_topic`
- `urgency_score`
- `uncertainty_score`
- `grounded_reasoning`
- `supporting_memory_objects`
- `supporting_evidence`

## Design rule
Do not make the API feel like a generic chat endpoint with optional metadata.
The API should clearly support:
- institutional memory reconstruction,
- evidence-backed reasoning,
- proactive signal generation,
- inspectable admin and member workflows.

## Portable memory/orchestration endpoints

### Evidence substrate and readiness
- `GET /api/evidence-substrate/filesystem` — safe internal memory file-system view with artifact locators, chunk/memory/signal counts, database blueprint, and organization guide.
- `GET /api/evidence-substrate/orchestration` — bounded stage catalog, spawn policy, runtime note, trace/stage/job reflection counts.
- `GET /api/evidence-substrate/orchestration/runs` — persisted stage-run ledger, optionally filtered by `query_run_id`.
- `GET /api/evidence-substrate/readiness` — PRD/product target coverage mapped to current workspace evidence, remaining work, and evaluator gates.

### DB-backed orchestration job worker
- `GET /api/evidence-substrate/orchestration/jobs` — list safe job state; admins see workspace jobs, members see their own.
- `POST /api/evidence-substrate/orchestration/jobs` — admin-only enqueue of a bounded stage payload.
- `POST /api/evidence-substrate/orchestration/jobs/claim` — admin/worker claim with `worker_id` and lease seconds.
- `POST /api/evidence-substrate/orchestration/jobs/:jobId/complete` — admin/worker terminal completion/failure/cancellation with structured result/error metadata.

The separate daemon entrypoint is `python -m app.worker` (or `scripts/orchestration-worker.sh`). It continuously claims bounded jobs from the configured SQLite database, rejects trusted-write payloads, and records terminal structured results. Docker Compose runs this as the `worker` service.

### Bounded scenario support
- `GET /api/scenario/templates` — fixed bounded scenario lenses.
- `POST /api/scenario/impact` — typed scenario impact packet over known memory; forecasting/trusted writes disabled.
- `GET /api/scenario/runs` — persisted scenario run history.
- `GET /api/scenario/runs/:scenarioRunId` — stored scenario packet/result detail.
- `POST /api/scenario/runs/:scenarioRunId/replay` — deterministic replay against current permissions/evidence.

### Database operations
Database schema versioning is operated through CLI scripts:

```bash
scripts/db-migrate.sh
scripts/db-check.sh
scripts/db-stamp-current.sh
```

Admin data inspection is available through authenticated product UI/API:

- `GET /api/admin/database` — admin-only table row counts, Alembic revision, artifact storage paths, checksum/size/existence, and storage management notes.
- `PATCH /api/artifacts/:artifactId/metadata` — admin-only safe metadata edit for artifact title. Source bytes remain immutable; upload a replacement artifact for content changes.
