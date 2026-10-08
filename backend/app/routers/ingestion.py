from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import Artifact, IngestionJob, User
from app.schemas.api import IngestionJobRead, IngestionRunCreate
from app.services.ingestion import run_ingestion
from app.services.permissions import require_admin, require_artifact_access

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/run", response_model=IngestionJobRead, status_code=status.HTTP_201_CREATED)
def create_ingestion_run(payload: IngestionRunCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> IngestionJobRead:
    require_admin(current_user)
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == payload.artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    require_artifact_access(db, artifact, current_user)
    job = run_ingestion(db, artifact=artifact, actor=current_user)
    return IngestionJobRead.model_validate(job)


@router.get("/jobs/{job_id}", response_model=IngestionJobRead)
def get_ingestion_job(job_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> IngestionJobRead:
    job = db.scalar(select(IngestionJob).where(IngestionJob.job_id == job_id, IngestionJob.workspace_id == current_user.workspace_id))
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak işleme kaydı bulunamadı.")
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == job.artifact_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    require_artifact_access(db, artifact, current_user)
    return IngestionJobRead.model_validate(job)
