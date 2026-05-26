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
- **Jury demo:** `app.izge.dev` runs on Izge-controlled EC2 with an EC2-local/private LLM gateway.
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
├── deploy/     # EC2 deploy script, Nginx & systemd configs
└── docs/       # Product specs, architecture & implementation docs
```

---

## Quickstart

### Prerequisites

- Python ≥ 3.11
- Node.js ≥ 18

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload
```

The backend starts at `http://127.0.0.1:8000`. A default admin account is bootstrapped on first run — credentials are written to `backend/data/bootstrap_admin_credentials.json`.

Override defaults with `IZGE_DEFAULT_ADMIN_EMAIL` and `IZGE_DEFAULT_ADMIN_PASSWORD`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.


### Docker Compose

For a portable, company-controlled runtime with persisted SQLite and artifact storage:

```bash
docker compose up --build
```

Then open `http://localhost:8080`. The backend remains available at `http://localhost:8000`; credentials are generated into the persisted Docker volume at `/data/bootstrap_admin_credentials.json` when `IZGE_DEFAULT_ADMIN_PASSWORD` is empty.

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
```

Back up and restore the persisted company memory volume with:

```bash
scripts/docker-backup.sh
docker compose down
scripts/docker-restore.sh backups/<backup-file>.tar.gz --force
```

The backup contains SQLite, uploaded artifact storage, pasted-text storage, and bootstrap credentials. Restore is intentionally explicit and refuses to run while Compose services are active unless `IZGE_RESTORE_ALLOW_RUNNING=1` is set.

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

## Demo readiness evaluation

Run the isolated seed evaluation before a live MVP demo:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

Run the full one-company workflow scenario when checking real-world readiness:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
```

These launch temporary backends, ingest controlled corpora, run locked query classes, check contradiction/drift provenance, verify permission-limited evidence redaction, exercise bounded scenario replay, and shut down. Nonzero exit means the demo confidence lane failed.

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
