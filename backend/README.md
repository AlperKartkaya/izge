# Izge Backend

Minimal FastAPI + SQLite backend foundation for the locked Izge MVP.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload
```

## Default seeded admin

- email: `admin@example.com`
- password: generated on first run and written to `data/bootstrap_admin_credentials.json`

Override these with `IZGE_DEFAULT_ADMIN_EMAIL` and `IZGE_DEFAULT_ADMIN_PASSWORD` if needed.

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

If you already have a backend running and want to evaluate that instance
directly:

```bash
IZGE_EVAL_BASE_URL=http://127.0.0.1:8000 .venv/bin/python -m manual_eval.run_seed_eval
```
