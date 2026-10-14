from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.models import Artifact, ArtifactChunk, ColleagueRun, CompanyChatMessage, User, WorkTask
from app.services.colleague import ensure_colleague_user, enqueue_colleague_question, process_colleague_run, task_sources_visible_to_readers, utcnow
from app.services.ingestion import chunk_text
from app.services.permissions import artifact_is_visible_to_user
from app.services.storage import ensure_supported_upload


_MAX_DEMO_DATABASE_BYTES = 64 * 1024 * 1024
_MAX_DEMO_UPLOAD_BYTES = 2 * 1024 * 1024
_MAX_LOCAL_SOURCE_CHARS = 50_000
_DEMO_SLOTS = threading.BoundedSemaphore(2)


@contextmanager
def demo_execution_slot() -> Iterator[None]:
    if not _DEMO_SLOTS.acquire(blocking=False):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Demo şu anda yoğun. Lütfen kısa süre sonra tekrar deneyin.")
    try:
        yield
    finally:
        _DEMO_SLOTS.release()


@contextmanager
def isolated_demo_session(source_db: Session) -> Iterator[Session]:
    destination: sqlite3.Connection | None = None
    clone_engine = None
    with demo_execution_slot():
        try:
            source = source_db.connection().connection.driver_connection
            if not isinstance(source, sqlite3.Connection):
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Demo izolasyonu kullanılamıyor.")
            page_count = int(source.execute("PRAGMA page_count").fetchone()[0])
            page_size = int(source.execute("PRAGMA page_size").fetchone()[0])
            if page_count * page_size > _MAX_DEMO_DATABASE_BYTES:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Demo verisi güvenli bellek sınırını aşıyor.")

            destination = sqlite3.connect(":memory:", check_same_thread=False)
            source.backup(destination)
            destination.execute("PRAGMA foreign_keys=ON")
            clone_engine = create_engine(
                "sqlite://",
                creator=lambda: destination,
                poolclass=StaticPool,
            )
            with Session(clone_engine, expire_on_commit=False) as clone_db:
                yield clone_db
        finally:
            if clone_engine is not None:
                clone_engine.dispose()
            elif destination is not None:
                destination.close()


def seed_browser_context(
    db: Session,
    *,
    actor: User,
    thread_id: str,
    history: list[dict[str, str]],
    local_sources: list[dict[str, str]],
    conversation_context: str | None,
) -> tuple[list[str], dict[str, str]]:
    agent = ensure_colleague_user(db, actor.workspace_id)
    participants = sorted({actor.user_id, agent.user_id})
    for turn in history:
        db.add(ColleagueRun(
            workspace_id=actor.workspace_id,
            created_by=actor.user_id,
            kind="ask",
            client_request_id=f"demo-history-{secrets.token_hex(16)}",
            thread_id=thread_id,
            thread_title="İzge ile çalışma",
            thread_kind="direct",
            participant_user_ids=participants,
            question=turn["question"].strip(),
            answer=turn["answer"].strip(),
            status="completed",
            sources=[],
            follow_ups=[],
            completed_at=utcnow(),
        ))
    if conversation_context and conversation_context.strip():
        db.add(ColleagueRun(
            workspace_id=actor.workspace_id,
            created_by=actor.user_id,
            kind="ask",
            client_request_id=f"demo-context-{secrets.token_hex(16)}",
            thread_id=thread_id,
            thread_title="İzge ile çalışma",
            thread_kind="direct",
            participant_user_ids=participants,
            question="Tarayıcıdan sağlanan yakın konuşma bağlamı",
            answer=conversation_context.strip(),
            status="completed",
            sources=[],
            follow_ups=[],
            completed_at=utcnow(),
        ))

    artifact_ids: list[str] = []
    source_id_map: dict[str, str] = {}
    for source in local_sources:
        text = source["text"].strip()
        artifact = Artifact(
            workspace_id=actor.workspace_id,
            title=source["title"].strip(),
            source_type="pasted_text",
            source_path="browser-local",
            mime_type="text/plain",
            uploaded_by=actor.user_id,
            visibility_scope="workspace",
            original_filename=None,
            checksum_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            extracted_text=text,
            ingestion_status="completed",
            review_status="submitted",
        )
        db.add(artifact)
        db.flush()
        for sequence, value in enumerate(chunk_text(text)):
            db.add(ArtifactChunk(
                artifact_id=artifact.artifact_id,
                workspace_id=actor.workspace_id,
                sequence_number=sequence,
                text=value,
                chunk_metadata={"extraction_method": "browser-local", "extraction_status": "completed"},
            ))
        artifact_ids.append(artifact.artifact_id)
        if source.get("artifact_id"):
            source_id_map[artifact.artifact_id] = source["artifact_id"]
    db.commit()
    return artifact_ids, source_id_map


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def apply_browser_tasks(
    db: Session,
    *,
    actor: User,
    local_tasks: list[dict],
    source_id_map: dict[str, str],
) -> None:
    client_to_internal = {client_id: internal_id for internal_id, client_id in source_id_map.items()}
    for item in local_tasks:
        task = db.scalar(select(WorkTask).where(
            WorkTask.task_id == item["task_id"],
            WorkTask.workspace_id == actor.workspace_id,
        ))
        if task is not None and not task_sources_visible_to_readers(db, task, [actor]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yerel iş değişikliği erişilemeyen bir kayda dayanıyor.")
        resolved_source_ids = [client_to_internal.get(source_id, source_id) for source_id in item["source_artifact_ids"]]
        artifacts = list(db.scalars(select(Artifact).where(
            Artifact.workspace_id == actor.workspace_id,
            Artifact.artifact_id.in_(resolved_source_ids),
        )).all()) if resolved_source_ids else []
        if {artifact.artifact_id for artifact in artifacts} != set(resolved_source_ids) or any(
            not artifact_is_visible_to_user(db, artifact, actor) for artifact in artifacts
        ):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yerel iş kaynaklarından biri bulunamadı veya erişilemiyor.")
        snapshot = {artifact.artifact_id: {"title": artifact.title, "captured_at": utcnow().isoformat()} for artifact in artifacts}
        if task is None:
            task = WorkTask(
                workspace_id=actor.workspace_id,
                created_by=actor.user_id,
                assignee_user_id=actor.user_id,
            )
            db.add(task)
        task.title = item["title"].strip()
        task.description = item["description"].strip() if item.get("description") else None
        task.status = item["status"]
        task.due_at = _utc_naive(item.get("due_at"))
        task.remind_at = _utc_naive(item.get("remind_at"))
        task.reminder_sent_at = None
        task.source_artifact_ids = resolved_source_ids
        task.source_snapshot = snapshot
    db.commit()


def run_demo_question(
    db: Session,
    *,
    actor: User,
    message: str,
    client_request_id: str,
    response_language: str,
    model_profile: str | None,
    reasoning_effort: str | None,
    history: list[dict[str, str]],
    local_sources: list[dict[str, str]],
    local_tasks: list[dict],
    conversation_context: str | None,
) -> tuple[ColleagueRun, dict[str, str]]:
    run, source_id_map, lease_owner = prepare_demo_question(
        db,
        actor=actor,
        message=message,
        client_request_id=client_request_id,
        response_language=response_language,
        model_profile=model_profile,
        reasoning_effort=reasoning_effort,
        history=history,
        local_sources=local_sources,
        local_tasks=local_tasks,
        conversation_context=conversation_context,
    )
    return process_colleague_run(db, run, lease_owner=lease_owner), source_id_map


def prepare_demo_question(
    db: Session,
    *,
    actor: User,
    message: str,
    client_request_id: str,
    response_language: str,
    model_profile: str | None,
    reasoning_effort: str | None,
    history: list[dict[str, str]],
    local_sources: list[dict[str, str]],
    local_tasks: list[dict],
    conversation_context: str | None,
) -> tuple[ColleagueRun, dict[str, str], str]:
    thread_id = f"demo:{secrets.token_hex(16)}"
    artifact_ids, source_id_map = seed_browser_context(
        db,
        actor=actor,
        thread_id=thread_id,
        history=history,
        local_sources=local_sources,
        conversation_context=conversation_context,
    )
    apply_browser_tasks(
        db,
        actor=actor,
        local_tasks=local_tasks,
        source_id_map=source_id_map,
    )
    options = {
        key: value
        for key, value in {"model_profile": model_profile, "reasoning_effort": reasoning_effort}.items()
        if value is not None
    }
    run = enqueue_colleague_question(
        db,
        actor=actor,
        message=message,
        client_request_id=f"demo-{client_request_id}-{secrets.token_hex(8)}"[:120],
        thread_id=thread_id,
        thread_title="İzge ile çalışma",
        thread_kind="direct",
        participant_user_ids=[actor.user_id],
        response_language=response_language,
        agent_options=options,
    )
    lease_owner = f"demo-sync:{secrets.token_hex(16)}"
    run.context_artifact_ids = artifact_ids
    run.status = "running"
    run.lease_owner = lease_owner
    run.lease_expires_at = utcnow() + timedelta(minutes=15)
    run.started_at = utcnow()
    db.commit()
    db.refresh(run)
    return run, source_id_map, lease_owner


def demo_thread_messages(db: Session, *, actor: User, thread_id: str) -> list[CompanyChatMessage]:
    from sqlalchemy import select

    return list(db.scalars(
        select(CompanyChatMessage)
        .where(
            CompanyChatMessage.workspace_id == actor.workspace_id,
            CompanyChatMessage.message_metadata["thread_id"].as_string() == thread_id,
        )
        .order_by(CompanyChatMessage.created_at.asc())
    ).all())


def extract_demo_bytes(content: bytes, suffix: str) -> str:
    if suffix == ".pdf":
        reader = PdfReader(BytesIO(content), strict=True)
        if len(reader.pages) > get_settings().max_pdf_pages:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF izin verilen sayfa sınırını aşıyor.")
        pages: list[str] = []
        extracted_chars = 0
        for index, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
            if page_text.strip():
                normalized_page = page_text.strip()
                extracted_chars += len(normalized_page)
                if extracted_chars > _MAX_LOCAL_SOURCE_CHARS:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Çıkarılan metin demo kaynak sınırını aşıyor.")
                pages.append(f"[Page {index}]\n{normalized_page}")
        return "\n\n".join(pages).strip()
    return content.decode("utf-8", errors="ignore")


async def extract_demo_upload(file: UploadFile) -> str:
    try:
        ensure_supported_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    upload_limit = min(get_settings().max_upload_bytes, _MAX_DEMO_UPLOAD_BYTES)
    with demo_execution_slot():
        content = await file.read(upload_limit + 1)
        if len(content) > upload_limit:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Dosya izin verilen boyut sınırını aşıyor.")
        suffix = Path(file.filename or "").suffix.lower()
        try:
            text = await run_in_threadpool(extract_demo_bytes, content, suffix)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Dosya metni okunamadı.") from exc
    if len(text) > min(get_settings().max_extracted_text_chars, _MAX_LOCAL_SOURCE_CHARS):
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Çıkarılan metin demo kaynak sınırını aşıyor.")
    return text
