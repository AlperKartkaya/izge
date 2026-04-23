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
