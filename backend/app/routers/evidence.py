from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import MemoryFilesystemRead, OrchestrationBlueprintRead, OrchestrationStageRunsRead, TargetReadinessRead
from app.services.evidence_substrate import (
    build_memory_filesystem,
    build_orchestration_blueprint,
    build_target_readiness,
    list_orchestration_stage_runs,
)

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


@router.get("/readiness", response_model=TargetReadinessRead)
def get_target_readiness(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TargetReadinessRead:
    return TargetReadinessRead(**build_target_readiness(db, current_user))
