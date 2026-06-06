# Izge Operations Control Map

This is the operator-facing index for running, inspecting, backing up, and improving Izge without hunting through scattered scripts. Keep this file current whenever a new service, script, storage root, migration path, or smoke gate is added.

## Runtime topology

| Surface | Local development | Docker Compose | Customer/managed deployment |
| --- | --- | --- | --- |
| Frontend | `cd frontend && npm run dev` | `frontend` service on `http://localhost:8080` | Nginx/static web serving |
| Backend API | `cd backend && .venv/bin/uvicorn app.main:app --reload` | `backend` service on `127.0.0.1:8000` | systemd `izge-backend.service` behind Nginx |
| Worker daemon | `scripts/orchestration-worker.sh --worker-id local-worker` | `worker` service sharing mounted `backend/data` | Not provisioned by the current EC2 deploy script; add a managed process using the same DB/storage env before relying on async jobs in that deployment |
| Database | `backend/data/izge.db` | `backend/data/izge.db` mounted as `/data/izge.db` | `IZGE_SQLITE_PATH` from `/etc/izge/backend.env` |
| Artifact storage | `backend/data/storage` | `backend/data/storage` mounted as `/data/storage` | `IZGE_STORAGE_ROOT` |
| Pasted text storage | `backend/data/pasted` | `backend/data/pasted` mounted as `/data/pasted` | `IZGE_PASTED_TEXT_ROOT` |
| LLM gateway | Ollama/private endpoint | `host.docker.internal:11434` by default | local/private endpoint configured in env |

Frontend sign-in shortcut defaults can be overridden at build time with `VITE_DEFAULT_ADMIN_EMAIL` and `VITE_DEFAULT_ADMIN_PASSWORD`; rotate backend credentials first, then rebuild the frontend with matching values.

## Primary commands

| Need | Command | Notes |
| --- | --- | --- |
| Start full local container runtime | `docker compose up -d --build` | Starts `backend`, `worker`, and `frontend`. |
| Stop full local container runtime | `docker compose down` | Keeps the persisted host-mounted `backend/data` directory. |
| Check service health | `docker compose ps` and `curl http://127.0.0.1:8000/health` | Backend should be healthy; worker should be running. |
| Inspect control-room health | Open `/operations` as admin or call `/api/operations/overview` | Read-only overview of DB/storage, artifact coverage, memory freshness, worker queue, LLM, traces, and next actions. |
| Validate Compose config | `docker compose config` | Proves anchors/env resolve before deploy changes. |
| Run frontend quality gates | `cd frontend && npm run lint && npm run build` | Required after UI/CSS/TypeScript edits. |
| Check backend syntax/schema | `cd backend && python3 -m compileall app && .venv/bin/python -m app.migration_tools check` | Required after backend or migration edits. |
| Smoke backend API behavior | `scripts/backend-api-smoke.sh` | Isolated temp-DB check for admin/employee auth, seeded employees, threaded team chat, and LLM-status access. |
| Upgrade/check DB scripts | `scripts/db-migrate.sh`, `scripts/db-check.sh` | Use these before/after schema work. |
| Run worker locally | `scripts/orchestration-worker.sh --worker-id local-worker --poll-interval-seconds 2 --lease-seconds 120` | Claims bounded DB-backed stage jobs. |
| Prove worker queue | `scripts/worker-smoke-eval.sh` | Confirms a separate process consumes jobs. |
| Prove Docker workflow | `scripts/docker-smoke-eval.sh` | Containerized seed/evidence/orchestration smoke. |
| Prove local/private LLM | `scripts/ollama-smoke-eval.sh` | Requires configured model in the gateway. |
| Backup Docker data | `scripts/docker-backup.sh` | Captures SQLite, storage, pasted text, and bootstrap credentials from mounted `/data`. |
| Restore Docker data | `scripts/docker-restore.sh backups/<file>.tar.gz --force` | Stop Compose first unless explicitly overriding. |
| Deploy to EC2 | `deploy/redeploy-ec2.sh --host <host> -i <key>` | Requires `/etc/izge/backend.env` on the host; use `deploy/env/backend.env.example` only as the manual template. |

## Admin/data inspection surfaces

Use authenticated app surfaces before raw database access:

1. `/operations` — admin control room for DB/storage, artifact coverage, memory freshness, worker queue, LLM, traces, and next actions.
2. `/admin/data` — SQLite path, storage roots, table counts, write/read surface map.
3. `/artifacts` — uploaded/pasted source inventory, review status, preview/download.
4. `/memory-filesystem` — logical memory layout and counts.
5. `/orchestration` — worker queue, bounded stage ledger, and scenario replay.
6. `/audit` — governance and operator actions.
7. `/readiness` — capability coverage, proof signals, and remaining work.

The Operations page is intentionally read-only. Treat it as the first stop before changing data or infrastructure: it will call out missing source files, pending review, completed artifacts with no chunks/memory, queued or expired worker jobs, LLM gateway problems, and trace/replay coverage.

Raw SQLite access is for diagnostics and backup validation only. Production/shared deployments should not modify trusted data through raw SQL because artifact source, memory extraction, audit, and permission records must stay consistent.

## Local Docker database visibility

For development, Docker Compose uses a bind mount instead of a hidden Docker volume:

```text
backend/data   ->   /data inside backend and worker containers
```

This makes the easy workflow valid:

1. Run `docker compose up -d --build`.
2. Open `http://localhost:8080`.
3. Add an artifact through the UI.
4. Inspect `backend/data/izge.db` in DB Browser for SQLite or with `sqlite3`.
5. Inspect uploaded/pasted source bytes under `backend/data/storage` or `backend/data/pasted`.

This is a fair expectation: UI/API writes should be visible in the mounted SQLite database and storage folders. If DB Browser is already open, refresh or reopen the database after writes; SQLite may keep recent changes in `izge.db-wal` until checkpointed. Do not edit trusted application data through DB Browser while the app is running.

## Operational boundaries to preserve

- **Source artifacts are immutable for audit.** Upload a replacement and reject/restrict the old artifact instead of editing stored source bytes.
- **LLM output is never authority of record.** It may assist extraction/routing/synthesis only after permission filtering and with deterministic/auditable fallback.
- **Worker jobs are bounded.** The daemon accepts typed payloads and rejects trusted writes outside the job result.
- **Database migrations must be explicit.** Add Alembic revisions for schema changes; do not patch production DBs ad hoc.
- **Backups can contain company data and credentials.** Keep `backups/` ignored and off public remotes.

## Improvement checklist

Before adding an infra feature, update this control map with:

1. the owning service/process,
2. required env vars,
3. storage and backup impact,
4. health/smoke command,
5. admin or audit visibility,
6. rollback path.
