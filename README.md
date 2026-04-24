# Izge

Izge is a **local-first institutional memory and decision intelligence system** focused on the MVP wedge of **product and roadmap history**.

It is not internal search, chat over files, generic RAG, or a PM copilot. The product intent is to reconstruct what was decided, why it was decided, what assumptions and constraints shaped it, what later contradicted it, and what teams should do next based on that history.

## Repository structure

- `backend/` — FastAPI + SQLite backend, ingestion pipeline, structured memory extraction, graph persistence, reasoning routes, and manual evaluation assets.
- `frontend/` — React + TypeScript frontend with the current MVP product surfaces.
- `docs/` — locked product, architecture, scope, UX, and demo documents.
- `CONTINUATION_PROMPT_FOR_NEW_CODING_AGENT.md` — handoff prompt for continuing implementation in a new coding session.

## Current state

This repository is no longer spec-only. It already contains real MVP implementation work, including:

- local-first backend and frontend foundations,
- structured memory extraction,
- explicit graph persistence and linkage,
- query-class-specific reasoning,
- evidence-first result rendering,
- contradiction and drift inspection surfaces,
- and a compact manual evaluation seed plus harness.

The source of truth for scope and category discipline remains the documentation in `docs/`, especially:

- `docs/MVP_IMPLEMENTATION_CONTRACT.md`
- `docs/PRE_INCUBATION_PRODUCT_BRIEF.md`
- `docs/VISION_AND_POSITIONING.md`
- `docs/MVP_SCOPE.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DECISION_GRAPH_SPEC.md`
- `docs/UI_UX_SPEC.md`
- `docs/DEMO_SCRIPT.md`

## Running locally

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload
```

Default local admin credentials:

- email: `admin@example.com`
- password: `change-me-admin`

Override with `IZGE_DEFAULT_ADMIN_EMAIL` and `IZGE_DEFAULT_ADMIN_PASSWORD` if needed.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend on `http://127.0.0.1:8000` by default.

## Manual evaluation

The current seed dataset and lightweight harness live under:

- `backend/manual_eval/product_roadmap_seed/`
- `backend/manual_eval/run_seed_eval.py`

These are intended for repeatable sanity checks as reasoning quality improves.

For the demo-readiness confidence check, run the isolated seed evaluation:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

This starts a temporary local backend with isolated SQLite and storage paths,
ingests the product/roadmap seed corpus, verifies lineage, contradiction,
assumption-drift, next-action, provenance, and permission-limited evidence
behavior, then shuts the temporary backend down. It exits nonzero if the
institutional-memory demo story regresses.

## Development note

When continuing implementation, treat Izge as an **institution memory engine first** and **decision intelligence product second**. Avoid drifting into chat-over-files, generic search, PM-copilot behavior, premature integrations, or speculative simulation work.
