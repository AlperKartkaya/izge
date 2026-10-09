from datetime import datetime
from pathlib import Path
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import Artifact, ArtifactChunk, User
from app.schemas.api import (
    ArtifactChunkProvenance,
    ArtifactDetail,
    ArtifactMetadataUpdate,
    ArtifactPermissionUpdate,
    ArtifactProactiveSignals,
    ArtifactRead,
    ArtifactReviewUpdate,
    PastedTextCreate,
)
from app.config import get_settings
from app.services.audit import log_event
from app.services.permissions import list_permitted_user_ids, require_admin, require_artifact_access, set_artifact_permissions
from app.services.querying import artifact_proactive_signals
from app.services.storage import ensure_supported_upload, persist_pasted_text, persist_upload_bytes, resolve_artifact_source_path

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


def _feed_memory_inline(db: Session, artifact: Artifact, actor: User) -> bool:
    """Index newly added source material immediately without mutating process-wide settings."""
    from app.config import get_settings
    from app.services.ingestion import run_ingestion

    settings = get_settings()
    try:
        run_ingestion(
            db,
            artifact=artifact,
            actor=actor,
            use_local_llm=settings.local_llm_enabled,
            use_signal_explanations=False,
        )
        return artifact.ingestion_status == "completed"
    except Exception as exc:
        artifact.ingestion_status = "failed"
        artifact.review_status = "needs_review"
        artifact.review_notes = f"Memory ingestion failed after intake: {exc}"
        db.commit()
        return False


def _queue_artifact_review(db: Session, artifact: Artifact, actor: User) -> None:
    from app.services.colleague import enqueue_artifact_review

    enqueue_artifact_review(db, artifact=artifact, actor=actor)


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Görünürlük şirket geneli veya kısıtlı olmalıdır.")
    if current_user.role != "Admin" and visibility_scope != "workspace":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Kısıtlı kaynakları yalnızca yöneticiler oluşturabilir.")
    try:
        ensure_supported_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Dosya izin verilen boyut sınırını aşıyor.")
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
    if _feed_memory_inline(db, artifact, current_user):
        _queue_artifact_review(db, artifact, current_user)
    db.refresh(artifact)
    return ArtifactRead.model_validate(artifact)


@router.post("/pasted-text", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
def create_pasted_text_artifact(payload: PastedTextCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ArtifactRead:
    settings = get_settings()
    if len(payload.text.encode("utf-8")) > settings.max_pasted_text_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Not izin verilen boyut sınırını aşıyor.")
    if current_user.role != "Admin" and payload.visibility_scope != "workspace":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Kısıtlı kaynakları yalnızca yöneticiler oluşturabilir.")
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
    if _feed_memory_inline(db, artifact, current_user):
        _queue_artifact_review(db, artifact, current_user)
    db.refresh(artifact)
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
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


@router.get("/{artifact_id}/preview")
def preview_artifact_source(artifact_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FileResponse:
    artifact = _get_accessible_artifact(db, artifact_id, current_user)
    source_path = _artifact_source_file(artifact)
    return FileResponse(
        source_path,
        media_type=artifact.mime_type or "application/octet-stream",
        filename=_safe_download_name(artifact),
        content_disposition_type="inline",
    )


@router.get("/{artifact_id}/download")
def download_artifact_source(artifact_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FileResponse:
    artifact = _get_accessible_artifact(db, artifact_id, current_user)
    source_path = _artifact_source_file(artifact)
    return FileResponse(
        source_path,
        media_type=artifact.mime_type or "application/octet-stream",
        filename=_safe_download_name(artifact),
        content_disposition_type="attachment",
    )


@router.get("/{artifact_id}/signals", response_model=ArtifactProactiveSignals)
def get_artifact_signals(artifact_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ArtifactProactiveSignals:
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
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


@router.patch("/{artifact_id}/metadata", response_model=ArtifactDetail)
def update_artifact_metadata(
    artifact_id: str,
    payload: ArtifactMetadataUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ArtifactDetail:
    require_admin(current_user)
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    old_title = artifact.title
    artifact.title = payload.title
    db.commit()
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="ARTIFACT_METADATA_UPDATED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"old_title": old_title, "new_title": payload.title},
    )
    return get_artifact(artifact_id, current_user, db)


@router.patch("/{artifact_id}/review", response_model=ArtifactDetail)
def update_artifact_review_status(
    artifact_id: str,
    payload: ArtifactReviewUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ArtifactDetail:
    require_admin(current_user)
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    artifact.review_status = payload.review_status
    artifact.review_notes = payload.review_notes
    artifact.reviewed_by = current_user.user_id
    artifact.reviewed_at = datetime.utcnow()
    db.commit()
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="ARTIFACT_REVIEW_UPDATED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"review_status": payload.review_status, "has_notes": bool(payload.review_notes)},
    )
    return get_artifact(artifact_id, current_user, db)


def _get_accessible_artifact(db: Session, artifact_id: str, current_user: User) -> Artifact:
    artifact = db.scalar(select(Artifact).where(Artifact.artifact_id == artifact_id, Artifact.workspace_id == current_user.workspace_id))
    if artifact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    require_artifact_access(db, artifact, current_user)
    return artifact


def _artifact_source_file(artifact: Artifact) -> Path:
    if not artifact.source_path or artifact.source_path == "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak dosyası henüz hazır değil.")

    source_path = resolve_artifact_source_path(source_path=artifact.source_path, artifact_id=artifact.artifact_id, source_type=artifact.source_type)
    if source_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak dosyası bulunamadı.")
    return source_path


def _safe_download_name(artifact: Artifact) -> str:
    raw_name = artifact.original_filename or f"{artifact.title or artifact.artifact_id}.txt"
    safe_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", raw_name).strip(" .")
    return safe_name or f"{artifact.artifact_id}.txt"


def _access_error(db: Session, artifact: Artifact, current_user: User) -> bool:
    try:
        require_artifact_access(db, artifact, current_user)
        return False
    except HTTPException:
        return True
