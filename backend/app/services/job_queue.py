from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import OrchestrationJob, QueryRun, User

TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}
CLAIMABLE_JOB_STATUSES = {"queued", "retry"}


def _utcnow() -> datetime:
    return datetime.utcnow()


def _claimable_status_predicate(now: datetime):
    return or_(
        OrchestrationJob.status.in_(CLAIMABLE_JOB_STATUSES),
        (OrchestrationJob.status == "claimed")
        & (OrchestrationJob.lease_expires_at.is_not(None))
        & (OrchestrationJob.lease_expires_at <= now),
    )


def enqueue_orchestration_job(
    db: Session,
    user: User,
    *,
    job_kind: str = "stage_packet",
    stage_key: str | None = None,
    query_run_id: str | None = None,
    priority: int = 100,
    payload_json: dict[str, Any] | None = None,
) -> OrchestrationJob:
    if query_run_id is not None:
        query_run = db.scalar(select(QueryRun).where(QueryRun.query_run_id == query_run_id, QueryRun.workspace_id == user.workspace_id))
        if query_run is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query run not found")
    job = OrchestrationJob(
        workspace_id=user.workspace_id,
        created_by=user.user_id,
        query_run_id=query_run_id,
        job_kind=job_kind,
        stage_key=stage_key,
        priority=priority,
        payload_json=payload_json or {},
        result_json={},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def list_orchestration_jobs(db: Session, user: User, *, status_filter: str | None = None, limit: int = 80) -> list[OrchestrationJob]:
    query = select(OrchestrationJob).where(OrchestrationJob.workspace_id == user.workspace_id)
    if user.role != "Admin":
        query = query.where(OrchestrationJob.created_by == user.user_id)
    if status_filter is not None:
        query = query.where(OrchestrationJob.status == status_filter)
    return list(db.scalars(query.order_by(OrchestrationJob.created_at.desc()).limit(limit)).all())


def claim_next_orchestration_job(
    db: Session,
    user: User,
    *,
    worker_id: str,
    lease_seconds: int = 90,
) -> OrchestrationJob | None:
    return claim_next_orchestration_job_for_worker(
        db,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
        workspace_id=user.workspace_id,
    )


def claim_next_orchestration_job_for_worker(
    db: Session,
    *,
    worker_id: str,
    lease_seconds: int = 90,
    workspace_id: str | None = None,
) -> OrchestrationJob | None:
    now = _utcnow()
    query = select(OrchestrationJob).where(
        _claimable_status_predicate(now),
        OrchestrationJob.available_at <= now,
    )
    if workspace_id is not None:
        query = query.where(OrchestrationJob.workspace_id == workspace_id)
    job = db.scalar(
        query
        .order_by(OrchestrationJob.priority.asc(), OrchestrationJob.available_at.asc(), OrchestrationJob.created_at.asc())
        .limit(1)
    )
    if job is None:
        return None
    job.status = "claimed"
    job.lease_owner = worker_id
    job.claimed_at = now
    job.lease_expires_at = now + timedelta(seconds=lease_seconds)
    db.commit()
    db.refresh(job)
    return job


def complete_orchestration_job_for_worker(
    db: Session,
    job: OrchestrationJob,
    *,
    result_json: dict[str, Any] | None = None,
    status_value: str = "completed",
    error_message: str | None = None,
) -> OrchestrationJob:
    if status_value not in TERMINAL_JOB_STATUSES:
        raise ValueError("Job status must be terminal")
    job.status = status_value
    job.result_json = result_json or {}
    job.error_message = error_message
    job.completed_at = _utcnow()
    db.commit()
    db.refresh(job)
    return job


def complete_orchestration_job(
    db: Session,
    user: User,
    *,
    job_id: str,
    result_json: dict[str, Any] | None = None,
    status_value: str = "completed",
    error_message: str | None = None,
) -> OrchestrationJob:
    if status_value not in TERMINAL_JOB_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Job status must be terminal")
    job = db.scalar(select(OrchestrationJob).where(OrchestrationJob.job_id == job_id, OrchestrationJob.workspace_id == user.workspace_id))
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orchestration job not found")
    return complete_orchestration_job_for_worker(
        db,
        job,
        result_json=result_json,
        status_value=status_value,
        error_message=error_message,
    )
