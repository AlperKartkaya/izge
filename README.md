# Izge

Izge is a **local-first institutional memory and decision intelligence system**.

It reconstructs what an organization decided, why it decided it, what assumptions and constraints shaped those decisions, what later contradicted them, what has drifted, and what teams should do next.

It is not:
- internal search,
- chat over files,
- generic RAG,
- a PM copilot,
- or generic AI SaaS.

## Product direction

Izge combines:
- structured memory extraction,
- explicit graph modeling,
- contradiction analysis,
- assumption drift detection,
- next-action guidance,
- proactive evaluation of newly submitted artifacts,
- signal surfaces for active contradictions, drift, and next actions.

The MVP wedge is **product and roadmap history**, while remaining capable of supporting continuity cases such as intern report handoff and repeated-work avoidance.

## Local-first meaning

For the MVP, local-first means **organization-controlled storage and inference**, not that every employee runs a desktop app. The UI can be a normal browser-based web app.

Deployment stance:
- **Local development:** your laptop runs the frontend/backend and a local Ollama/Qwen model.
- **Managed trial:** `app.izge.dev` can run on Izge-controlled EC2 with an EC2-local/private LLM gateway.
- **Customer target:** self-hosted or customer-controlled deployment at an internal/customer URL, with customer-controlled storage and local/private inference.
- **Commercial bridge:** Izge-managed single-tenant deployment may be used for pilots, but generic multi-tenant SaaS is not the core product identity.
- **Future only:** employee-local/edge models may participate later, but they are not required for MVP correctness.

## Core user roles

- **Admin** — prepares, governs, and inspects the memory.
- **Member** — contributes artifacts and reasons over the reconstructed memory.

## Core product scenarios

1. **Query-driven reasoning** — ask why a decision was made, what changed, what conflicts, and what should happen next.
2. **Proactive ingestion** — submit a new conflicting artifact and immediately detect contradiction/drift with grounded next-action guidance.
3. **Continuity** — surface prior relevant work so repeated work is avoided.

---

## Repository structure

```
├── backend/    # FastAPI + SQLite backend
├── frontend/   # React + TypeScript + Vite web app
├── website/    # Static marketing site (izge.dev)
├── deploy/     # Deploy script, Nginx & systemd configs
├── scripts/    # Operator scripts for DB, worker, Docker, LLM, backup and smoke gates
└── docs/       # Product specs, architecture, operations & implementation docs
```

---

## Operations control map

Use `docs/OPERATIONS.md` as the single operator index for runtime topology, service control, database/storage locations, backup/restore, smoke gates, and deployment improvement rules.

## Quickstart

### Prerequisites

- Python ≥ 3.11
- Node.js ≥ 18

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/python -m app.migration_tools upgrade
.venv/bin/uvicorn app.main:app --reload
```

The backend starts at `http://127.0.0.1:8000`. A default admin account is bootstrapped on first run — credentials are written to `backend/data/bootstrap_admin_credentials.json`.

Override defaults with `IZGE_DEFAULT_ADMIN_EMAIL` and `IZGE_DEFAULT_ADMIN_PASSWORD`.

### Worker daemon

Run this in a second terminal when you want queued orchestration jobs to progress continuously:

```bash
scripts/orchestration-worker.sh --worker-id local-worker --poll-interval-seconds 2 --lease-seconds 120
```

The worker consumes `orchestration_jobs` from the same SQLite database, validates bounded payloads, records structured results, and rejects any job that asks for trusted writes outside the job result.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.


### Docker Compose

For the local development runtime with visible persisted SQLite and artifact storage:

```bash
docker compose up --build
```

Then open `http://localhost:8080`. The backend remains available at `http://localhost:8000`. The local Compose profile starts three services: `backend`, `worker`, and `frontend`.

Docker Compose bind-mounts `backend/data` into the containers as `/data`, so the Docker app and the normal local backend share the same development database and artifact folders:

- SQLite database: `backend/data/izge.db`
- Uploaded files: `backend/data/storage/<artifact_id>/source.<ext>`
- Pasted text: `backend/data/pasted/<artifact_id>/pasted.txt`

That means adding an artifact through the Docker UI should update `backend/data/izge.db` and create/update files under `backend/data/storage` or `backend/data/pasted`. This is the expected development workflow. Use DB Browser for SQLite or `sqlite3 backend/data/izge.db` for read-only diagnostics, then refresh/reopen the DB Browser view after UI writes because SQLite may use WAL files (`izge.db-wal`, `izge.db-shm`) while the app is running.

Default workspace identities:

- Admin: `admin@example.com` / `change-me-admin`
- Employee 1: `employee1@example.com` / `change-me-employee1`
- Employee 2: `employee2@example.com` / `change-me-employee2`
- Employee 3: `employee3@example.com` / `change-me-employee3`

Change `IZGE_DEFAULT_ADMIN_PASSWORD` and the seeded employee credentials before any shared or production deployment.

Docker Compose attempts the local/private LLM path by default for extraction, query routing, answer synthesis, and signal explanation. To see live model-backed behavior from Docker, run an Ollama-compatible gateway on the host and make sure the configured model exists before starting Compose:

```bash
ollama pull qwen3.5:4b
ollama serve
docker compose up --build
```

Override the model or disable LLM features with environment variables when needed:

```bash
IZGE_LOCAL_LLM_MODEL=llama3.2:3b docker compose up --build
IZGE_LOCAL_LLM_ENABLED=false docker compose up --build
```

Run the migration/version checks and smoke evaluations before handing the system to a new company:

```bash
# Create/upgrade or verify the configured SQLite database schema.
scripts/db-migrate.sh
scripts/db-check.sh

# Docker-contained seed/evidence/orchestration smoke evaluation.
scripts/docker-smoke-eval.sh

# One-company synthetic workflow evaluation with realistic artifacts, permissions,
# scenario replay, rejection, and DB-backed orchestration job checks.
scripts/synthetic-company-smoke-eval.sh

# DB-backed worker daemon smoke evaluation.
scripts/worker-smoke-eval.sh
```

Back up and restore the persisted company memory data with:

```bash
scripts/docker-backup.sh
docker compose down
scripts/docker-restore.sh backups/<backup-file>.tar.gz --force
```

The backup contains SQLite, uploaded artifact storage, pasted-text storage, and bootstrap credentials. Restore is intentionally explicit and refuses to run while Compose services are active unless `IZGE_RESTORE_ALLOW_RUNNING=1` is set.

### Database and artifact storage management

The application database is SQLite:

- Local dev default: `backend/data/izge.db`
- Docker Compose dev path: `backend/data/izge.db`, mounted inside containers as `/data/izge.db`

Uploaded files are stored under `IZGE_STORAGE_ROOT/<artifact_id>/source.<ext>`; pasted text is stored under `IZGE_PASTED_TEXT_ROOT/<artifact_id>/pasted.txt`. In local dev and Docker Compose dev those roots are visible on the host at `backend/data/storage` and `backend/data/pasted`; inside Docker they map to `/data/storage` and `/data/pasted`.

Admins can inspect this through the product UI at `/admin/data` (`Data` in the nav). That page shows table row counts, Alembic revision, artifact logical locators, physical storage paths, storage existence/size, checksums, ingestion/review state, and supported metadata edits.

Supported edits should go through UI/API: artifact title, review status/notes, visibility scope, and permitted users. Raw source content is intentionally immutable for auditability; upload/paste a replacement artifact and reject or restrict the old one if document contents change. For local diagnostics only, you can inspect `backend/data/izge.db` with `sqlite3` or DB Browser for SQLite; do not raw-edit rows while the app is running because that bypasses audit, ingestion, permissions, and artifact-storage consistency.

### Marketing website

```bash
cd website
python3 -m http.server 5179
```

Then visit `http://127.0.0.1:5179`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI, SQLAlchemy, SQLite, Pydantic |
| Frontend | React 19, TypeScript, Vite, React Router |
| Marketing site | Static HTML/CSS/JS |
| Infrastructure | EC2, Nginx, systemd, Let's Encrypt |

---

## Deployment

The project ships a single deploy script that handles the full lifecycle:

```bash
deploy/redeploy-ec2.sh --host <EC2_PUBLIC_IP> -i ~/.ssh/izge.pem
```

This will:
1. Run local preflight checks (JS/HTML/CSS/Python syntax, frontend build + lint).
2. Upload the repo via rsync.
3. Install backend dependencies and restart the service.
4. Build the frontend and publish to Nginx.
5. Sync the marketing website.
6. Run remote and public smoke checks.

Add `--run-eval` to run the isolated seed evaluation after deploy.

### Live URLs

| Surface | URL |
|---|---|
| Marketing site | https://izge.dev |
| Application | https://app.izge.dev |
| API | https://app.izge.dev/api |

---

## Product readiness evaluation

Run the isolated seed evaluation before relying on a live managed trial or release candidate:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

Run the full one-company workflow scenario when checking real-world readiness:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
```

These launch temporary backends, ingest controlled corpora, run locked query classes, check contradiction/drift provenance, verify permission-limited evidence redaction, exercise bounded scenario replay, and shut down. Nonzero exit means the product confidence lane failed.

Run the worker queue smoke when validating asynchronous orchestration:

```bash
cd backend
.venv/bin/python -m manual_eval.run_worker_queue_smoke
```

---

## Documentation

Full specifications live in `docs/`. Start with `docs/README.md` for a guided index, or jump directly to:

- **Product & scope** — `VISION_AND_POSITIONING.md`, `PRD.md`, `MVP_SCOPE.md`, `MVP_IMPLEMENTATION_CONTRACT.md`
- **Architecture** — `SYSTEM_ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DECISION_GRAPH_SPEC.md`, `API_SPEC.md`, `COMPANY_PORTABLE_MEMORY_SYSTEM.md`
- **Deployment & security** — `DEPLOYMENT_MVP.md`, `SECURITY_GOVERNANCE.md`
- **UX & evaluation** — `UI_UX_SPEC.md`, `TEST_PLAN.md`, `DEMO_SCRIPT.md`
- **Demo data** — `demo/README.md`, `demo/DATA_SPEC.md`, `demo/SCENARIO_WIRING.md`

---

## Design rule

If a change makes Izge feel more like generic search, generic chat, or generic AI tooling, it is probably the wrong change.
