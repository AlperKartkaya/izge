from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import Artifact, ArtifactChunk, User
from app.schemas.api import ArtifactChunkProvenance, ArtifactDetail, ArtifactPermissionUpdate, ArtifactProactiveSignals, ArtifactRead, PastedTextCreate
from app.config import get_settings
from app.services.audit import log_event
from app.services.permissions import list_permitted_user_ids, require_admin, require_artifact_access, set_artifact_permissions
from app.services.querying import artifact_proactive_signals
from app.services.storage import ensure_supported_upload, persist_pasted_text, persist_upload_bytes

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.post("/upload", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
async def upload_artifact(
    file: UploadFile = File(...),
    title: str = Form(...),
    visibility_scope: str = Form("workspace"),
    permitted_user_ids: str = Form(""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ArtifactRead:
    settings = get_settings()
    if visibility_scope not in {"workspace", "restricted"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="visibility_scope must be workspace or restricted")
    if current_user.role != "Admin" and visibility_scope != "workspace":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create restricted artifacts")
    try:
        ensure_supported_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Upload exceeds maximum allowed size")
    artifact = Artifact(
        workspace_id=current_user.workspace_id,
        title=title,
        source_type="file_upload",
        source_path="pending",
        mime_type=file.content_type or "application/octet-stream",
        uploaded_by=current_user.user_id,
        visibility_scope=visibility_scope,
        original_filename=file.filename,
        ingestion_status="pending",
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    source_path, checksum = persist_upload_bytes(content, artifact_id=artifact.artifact_id, filename=file.filename)
    artifact.source_path = source_path
    artifact.checksum_sha256 = checksum
    db.commit()
    set_artifact_permissions(
        db,
        artifact=artifact,
        actor=current_user,
        permitted_user_ids=[value for value in permitted_user_ids.split(",") if value],
    )
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="ARTIFACT_UPLOADED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"title": artifact.title, "mime_type": artifact.mime_type},
    )
    return ArtifactRead.model_validate(artifact)


@router.post("/pasted-text", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
def create_pasted_text_artifact(payload: PastedTextCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ArtifactRead:
    if current_user.role != "Admin" and payload.visibility_scope != "workspace":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create restricted artifacts")
    artifact = Artifact(
        workspace_id=current_user.workspace_id,
        title=payload.title,
        source_type="pasted_text",
        source_path="pending",
        mime_type="text/plain",
        uploaded_by=current_user.user_id,
        visibility_scope=payload.visibility_scope,
        original_filename=None,
        ingestion_status="pending",
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    source_path, checksum = persist_pasted_text(payload.text, artifact_id=artifact.artifact_id)
    artifact.source_path = source_path
    artifact.checksum_sha256 = checksum
    db.commit()
    set_artifact_permissions(db, artifact=artifact, actor=current_user, permitted_user_ids=payload.permitted_user_ids)
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="PASTED_TEXT_SUBMITTED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"title": artifact.title},
    )
    return ArtifactRead.model_validate(artifact)


@router.get("", response_model=list[ArtifactRead])
def list_artifacts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ArtifactRead]:
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == current_user.workspace_id).order_by(Artifact.created_at.desc())).all()
    visible = [artifact for artifact in artifacts if not _access_error(db, artifact, current_user)]
    return [ArtifactRead.model_validate(artifact) for artifact in visible]


@router.get("/{artifact_id}", response_model=ArtifactDetail)
def get_artifact(artifact_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ArtifactDetail:
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    require_artifact_access(db, artifact, current_user)
    chunks = db.scalars(select(ArtifactChunk).where(ArtifactChunk.artifact_id == artifact.artifact_id).order_by(ArtifactChunk.sequence_number.asc())).all()
    chunk_count = len(chunks)
    return ArtifactDetail(
        **ArtifactRead.model_validate(artifact).model_dump(),
        extracted_text_preview=(artifact.extracted_text or "")[:500] or None,
        chunk_count=chunk_count,
        permitted_user_ids=list_permitted_user_ids(db, artifact.artifact_id),
        chunk_provenance=[
            ArtifactChunkProvenance(
                chunk_id=chunk.chunk_id,
                sequence_number=chunk.sequence_number,
                extraction_method=str((chunk.chunk_metadata or {}).get("extraction_method", "pending")),
                extraction_status=str((chunk.chunk_metadata or {}).get("extraction_status", "pending")),
                extracted_object_count=int((chunk.chunk_metadata or {}).get("extracted_object_count", 0)),
                fallback_reason=(chunk.chunk_metadata or {}).get("fallback_reason"),
                chunk_excerpt=str((chunk.chunk_metadata or {}).get("chunk_excerpt") or (chunk.text[:200] + "..." if len(chunk.text) > 200 else chunk.text)),
            )
            for chunk in chunks
        ],
    )


@router.get("/{artifact_id}/signals", response_model=ArtifactProactiveSignals)
def get_artifact_signals(artifact_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ArtifactProactiveSignals:
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    require_artifact_access(db, artifact, current_user)
    return ArtifactProactiveSignals(**artifact_proactive_signals(db, current_user, artifact))


@router.patch("/{artifact_id}/permissions", response_model=ArtifactDetail)
def update_artifact_permissions(
    artifact_id: str,
    payload: ArtifactPermissionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ArtifactDetail:
    require_admin(current_user)
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    artifact.visibility_scope = payload.visibility_scope
    db.commit()
    set_artifact_permissions(db, artifact=artifact, actor=current_user, permitted_user_ids=payload.permitted_user_ids)
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="PERMISSION_CHANGED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"visibility_scope": payload.visibility_scope, "permitted_user_ids": payload.permitted_user_ids},
    )
    return get_artifact(artifact_id, current_user, db)


def _access_error(db: Session, artifact: Artifact, current_user: User) -> bool:
    try:
        require_artifact_access(db, artifact, current_user)
        return False
    except HTTPException:
        return True
