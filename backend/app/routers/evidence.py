from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import (
    MemoryFilesystemRead,
    OrchestrationBlueprintRead,
    OrchestrationJobClaimRequest,
    OrchestrationJobCompleteRequest,
    OrchestrationJobCreate,
    OrchestrationJobListRead,
    OrchestrationJobRead,
    OrchestrationStageRunsRead,
    TargetReadinessRead,
)
from app.services.evidence_substrate import (
    build_memory_filesystem,
    build_orchestration_blueprint,
    build_target_readiness,
    list_orchestration_stage_runs,
)
from app.services.job_queue import claim_next_orchestration_job, complete_orchestration_job, enqueue_orchestration_job, list_orchestration_jobs
from app.services.permissions import require_admin

router = APIRouter(prefix="/evidence-substrate", tags=["evidence-substrate"])


@router.get("/filesystem", response_model=MemoryFilesystemRead)
def get_memory_filesystem(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MemoryFilesystemRead:
    return MemoryFilesystemRead(**build_memory_filesystem(db, current_user))


@router.get("/orchestration", response_model=OrchestrationBlueprintRead)
def get_orchestration_blueprint(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> OrchestrationBlueprintRead:
    return OrchestrationBlueprintRead(**build_orchestration_blueprint(db, current_user))


@router.get("/orchestration/runs", response_model=OrchestrationStageRunsRead)
def get_orchestration_stage_runs(
    query_run_id: str | None = None,
    limit: int = Query(default=80, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrchestrationStageRunsRead:
    return OrchestrationStageRunsRead(**list_orchestration_stage_runs(db, current_user, query_run_id=query_run_id, limit=limit))


@router.get("/orchestration/jobs", response_model=OrchestrationJobListRead)
def get_orchestration_jobs(
    status_filter: str | None = None,
    limit: int = Query(default=80, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrchestrationJobListRead:
    jobs = list_orchestration_jobs(db, current_user, status_filter=status_filter, limit=limit)
    return OrchestrationJobListRead(workspace_id=current_user.workspace_id, generated_at=datetime.utcnow(), jobs=jobs)


@router.post("/orchestration/jobs", response_model=OrchestrationJobRead, status_code=status.HTTP_201_CREATED)
def create_orchestration_job(
    payload: OrchestrationJobCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrchestrationJobRead:
    require_admin(current_user)
    job = enqueue_orchestration_job(
        db,
        current_user,
        job_kind=payload.job_kind,
        stage_key=payload.stage_key,
        query_run_id=payload.query_run_id,
        priority=payload.priority,
        payload_json=payload.payload_json,
    )
    return OrchestrationJobRead.model_validate(job)


@router.post("/orchestration/jobs/claim", response_model=OrchestrationJobRead | None)
def claim_orchestration_job(
    payload: OrchestrationJobClaimRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrchestrationJobRead | None:
    require_admin(current_user)
    job = claim_next_orchestration_job(db, current_user, worker_id=payload.worker_id, lease_seconds=payload.lease_seconds)
    return OrchestrationJobRead.model_validate(job) if job is not None else None


@router.post("/orchestration/jobs/{job_id}/complete", response_model=OrchestrationJobRead)
def complete_orchestration_job_route(
    job_id: str,
    payload: OrchestrationJobCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrchestrationJobRead:
    require_admin(current_user)
    job = complete_orchestration_job(
        db,
        current_user,
        job_id=job_id,
        result_json=payload.result_json,
        status_value=payload.status,
        error_message=payload.error_message,
    )
    return OrchestrationJobRead.model_validate(job)


@router.get("/readiness", response_model=TargetReadinessRead)
def get_target_readiness(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TargetReadinessRead:
    return TargetReadinessRead(**build_target_readiness(db, current_user))
