# Izge Backend

Minimal FastAPI + SQLite backend foundation for the locked Izge MVP.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python -m app.migration_tools upgrade
.venv/bin/uvicorn app.main:app --reload
```

Run the DB-backed orchestration worker in another terminal when queued stage jobs should progress without manual claim/complete API calls:

```bash
../scripts/orchestration-worker.sh --worker-id local-worker --poll-interval-seconds 2 --lease-seconds 120
```

## Default seeded admin

- email: `admin@example.com`
- password: `change-me-admin` by default, or generated on first run and written to `data/bootstrap_admin_credentials.json` when `IZGE_DEFAULT_ADMIN_PASSWORD` is empty

Override these with `IZGE_DEFAULT_ADMIN_EMAIL` and `IZGE_DEFAULT_ADMIN_PASSWORD` if needed.

## Database migration/version tooling

The app uses Alembic-backed schema versioning. Startup runs the safe upgrade/stamp path automatically, and operators can run the tooling directly:

```bash
# From the repo root
scripts/db-migrate.sh
scripts/db-check.sh
scripts/db-stamp-current.sh  # for verified pre-Alembic databases
```

Fresh databases run the baseline migration. Existing pre-Alembic SQLite databases are non-destructively checked/repaired for additive legacy columns, then stamped at the current head. Future schema changes should add explicit Alembic revisions under `backend/migrations/versions/`.

## Demo-readiness evaluation

Run the isolated seed evaluation before a live MVP demo:

```bash
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

The command launches a temporary local backend on an ephemeral port, uses
temporary SQLite and local storage paths, ingests the product/roadmap seed
corpus, runs the four locked query classes, checks contradiction/drift
provenance, verifies permission-limited evidence redaction, and then stops the
temporary backend. A nonzero exit means the demo confidence lane failed.

Run the one-company synthetic workflow evaluation for full end-to-end readiness (Northstar Payroll corpus, restricted evidence, prompt-injection scenario, scenario replay, rejection, temporal graph, and DB-backed orchestration jobs):

```bash
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
```

Run the worker daemon smoke evaluation to prove a separate process consumes DB jobs:

```bash
.venv/bin/python -m manual_eval.run_worker_queue_smoke
```

If you already have a backend running and want to evaluate that instance directly:

```bash
IZGE_EVAL_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m manual_eval.run_seed_eval
IZGE_EVAL_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m manual_eval.run_synthetic_company_workflow
```

## Local LLM integration boundaries

Izge keeps deterministic graph logic as the authority for memory objects,
signal classification, persistence, permissions, and evidence links. Local LLM
use is opt-in and scoped to bounded assistance:

- `IZGE_LOCAL_LLM_ENABLED=true` upgrades artifact memory extraction through the
  configured Ollama-compatible gateway, with heuristic fallback.
- `IZGE_LLM_SIGNAL_EXPLANATION_ENABLED=true` lets the same company-controlled
  local gateway improve persisted signal summaries, grounded reasoning, and
  recommended-action wording. It does not create signals, graph edges, memory
  objects, urgency scores, or evidence links.
- `IZGE_LLM_QUERY_ROUTING_ENABLED=true` lets the local gateway classify a
  natural-language question into one of the four fixed MVP reasoning modes
  before deterministic graph execution. It does not answer the query or retrieve
  evidence.
- `IZGE_LLM_ANSWER_SYNTHESIS_ENABLED=true` lets the local gateway rewrite the
  final answer from the deterministic result packet. Returned citations are
  filtered to the already-selected evidence and memory IDs.

Default local gateway settings:

```bash
IZGE_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434
IZGE_LOCAL_LLM_MODEL=qwen3.5:4b
IZGE_LOCAL_LLM_TIMEOUT_SECONDS=60
```
