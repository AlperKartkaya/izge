from __future__ import annotations

import argparse
import os
import socket
import time
from datetime import UTC, datetime
from typing import Any

from app.db import SessionLocal
from app.migration_tools import check_database, upgrade_database
from app.models import OrchestrationJob
from app.services.bootstrap import seed_defaults
from app.services.job_queue import claim_next_orchestration_job_for_worker, complete_orchestration_job_for_worker


SUPPORTED_JOB_KINDS = {"stage_packet", "synthetic_company_stage_packet"}


def _utciso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


def _payload_summary(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": payload.get("schema_version"),
        "company": payload.get("company"),
        "allowed_inputs": payload.get("allowed_inputs", []),
        "trusted_write_allowed": payload.get("trusted_write_allowed", False),
    }


def process_job(job: OrchestrationJob, *, worker_id: str) -> tuple[str, dict[str, Any], str | None]:
    """Execute the bounded, DB-backed worker contract for one orchestration job.

    The current worker is intentionally conservative: it validates a typed
    stage-packet payload, records deterministic evidence, and never performs
    trusted writes outside the job result. That gives the demo a real daemon
    and Docker service without pretending that arbitrary agent execution is
    safe or production-hardened yet.
    """

    payload = job.payload_json or {}
    if not isinstance(payload, dict):
        return "failed", {}, "Job payload must be an object"
    if job.job_kind not in SUPPORTED_JOB_KINDS:
        return "failed", _payload_summary(payload), f"Unsupported job kind: {job.job_kind}"
    if payload.get("trusted_write_allowed") is not False:
        return "failed", _payload_summary(payload), "Worker only accepts bounded payloads with trusted_write_allowed=false"

    result = {
        "schema_version": "orchestration_job_result.v1",
        "worker_id": worker_id,
        "job_id": job.job_id,
        "job_kind": job.job_kind,
        "stage_key": job.stage_key,
        "processed_at": _utciso(),
        "verifier_status": "passed",
        "trusted_write_allowed": False,
        "summary": "Processed bounded stage payload without trusted writes.",
        "input_contract": _payload_summary(payload),
        "next_operator_action": "Inspect the stage result and promote follow-up work through typed UI/API actions.",
    }
    return "completed", result, None


def run_worker(
    *,
    worker_id: str,
    poll_interval_seconds: float,
    lease_seconds: int,
    max_jobs: int | None,
    idle_timeout_seconds: float | None,
    once: bool,
    workspace_id: str | None = None,
) -> int:
    upgrade_database()
    with SessionLocal() as db:
        seed_defaults(db)
    check_database()

    processed = 0
    idle_started = time.monotonic()
    while True:
        with SessionLocal() as db:
            job = claim_next_orchestration_job_for_worker(
                db,
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                workspace_id=workspace_id,
            )
            if job is None:
                if once:
                    print(f"izge-worker idle worker_id={worker_id}")
                    return 0
                if idle_timeout_seconds is not None and time.monotonic() - idle_started >= idle_timeout_seconds:
                    print(f"izge-worker idle-timeout worker_id={worker_id} processed={processed}")
                    return 0
                time.sleep(poll_interval_seconds)
                continue

            idle_started = time.monotonic()
            try:
                status_value, result_json, error_message = process_job(job, worker_id=worker_id)
            except Exception as exc:  # pragma: no cover - defensive daemon guard
                status_value, result_json, error_message = "failed", {}, f"{type(exc).__name__}: {exc}"

            completed_job = complete_orchestration_job_for_worker(
                db,
                job,
                result_json=result_json,
                status_value=status_value,
                error_message=error_message,
            )
            processed += 1
            print(f"izge-worker processed job_id={completed_job.job_id} status={completed_job.status} worker_id={worker_id}")

        if once or (max_jobs is not None and processed >= max_jobs):
            return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Izge DB-backed orchestration worker")
    parser.add_argument("--worker-id", default=_default_worker_id())
    parser.add_argument("--poll-interval-seconds", type=float, default=2.0)
    parser.add_argument("--lease-seconds", type=int, default=120)
    parser.add_argument("--max-jobs", type=int, default=None)
    parser.add_argument("--idle-timeout-seconds", type=float, default=None)
    parser.add_argument("--once", action="store_true", help="Claim and process at most one job, then exit")
    parser.add_argument("--workspace-id", default=None, help="Optional workspace scope for single-tenant runs")
    args = parser.parse_args()
    raise SystemExit(
        run_worker(
            worker_id=args.worker_id,
            poll_interval_seconds=args.poll_interval_seconds,
            lease_seconds=args.lease_seconds,
            max_jobs=args.max_jobs,
            idle_timeout_seconds=args.idle_timeout_seconds,
            once=args.once,
            workspace_id=args.workspace_id,
        )
    )


if __name__ == "__main__":
    main()
