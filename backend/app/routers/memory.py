from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import Artifact, ArtifactChunk, Assumption, Commitment, Constraint, Decision, Outcome, User
from app.schemas.api import MemoryDetail
from app.services.permissions import require_artifact_access

router = APIRouter(prefix="/memory", tags=["memory"])

MODEL_MAP: dict[str, tuple[type[Any], str]] = {
    "decision": (Decision, "decision_id"),
    "assumption": (Assumption, "assumption_id"),
    "constraint": (Constraint, "constraint_id"),
    "outcome": (Outcome, "outcome_id"),
    "commitment": (Commitment, "commitment_id"),
}


@router.get("/{memory_type}/{memory_id}", response_model=MemoryDetail)
def get_memory_detail(memory_type: str, memory_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MemoryDetail:
    model_info = MODEL_MAP.get(memory_type)
    if model_info is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory type not found")
    model, pk_name = model_info
    memory = db.scalar(select(model).where(getattr(model, pk_name) == memory_id, model.workspace_id == current_user.workspace_id))
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory object not found")
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == memory.source_artifact_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source artifact not found")
    require_artifact_access(db, artifact, current_user)
    chunk = None
    chunk_metadata: dict[str, Any] = {}
    if memory.source_chunk_id:
        chunk = db.scalar(select(ArtifactChunk).where(ArtifactChunk.chunk_id == memory.source_chunk_id))
        chunk_metadata = chunk.chunk_metadata if chunk is not None and isinstance(chunk.chunk_metadata, dict) else {}
    return MemoryDetail(
        memory_type=memory_type,
        memory_id=getattr(memory, pk_name),
        title_or_label=memory.title_or_label,
        normalized_text=memory.normalized_text,
        confidence_score=memory.confidence_score,
        event_timestamp=memory.event_timestamp,
        source_artifact_id=memory.source_artifact_id,
        source_chunk_id=memory.source_chunk_id,
        evidence_span=memory.evidence_span,
        status=getattr(memory, "status", None),
        due_date=getattr(memory, "due_date", None),
        owner_label=getattr(memory, "owner_label", None),
        extraction_method=getattr(memory, "extraction_method", "heuristic"),
        source_artifact_title=artifact.title,
        source_chunk_excerpt=chunk.text if chunk is not None else None,
        extraction_fallback_reason=chunk_metadata.get("fallback_reason"),
    )
