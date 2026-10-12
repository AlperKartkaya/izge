from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import logging
from pathlib import Path
import shutil
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.config import get_settings
from app.models import Artifact, ArtifactPermission, AssistantConversation, CompanyChatMessage, User
from app.schemas.api import TeamChatMessageCreate, TeamChatMessageRead, TeamChatThreadRead, TeamChatTypingCreate, TeamChatTypingRead, TeamChatTypingUserRead
from app.services.audit import log_event
from app.services.notifications import notify_team_chat_recipients
from app.services.permissions import artifact_is_visible_to_user
from app.services.agent_sources import visible_sources
from app.services.storage import ensure_supported_upload, persist_upload_bytes
from app.services.security import public_demo_source_user_id

router = APIRouter(prefix="/team-chat", tags=["team-chat"])
_TYPING_TTL_SECONDS = 5
_typing_state: dict[tuple[str, str, str], datetime] = {}
_PUBLIC_DEMO_SEED_BATCH = "pusula-b2b-demo-v1"


def _clean_thread_id(value: str | None) -> str:
    raw_value = (value or "company-general").strip().lower()
    cleaned = "".join(character for character in raw_value if character.isalnum() or character in {"-", "_", ":"})
    return (cleaned or "company-general")[:80]


def _clean_thread_title(value: str | None, thread_id: str) -> str:
    fallback_titles = {
        "company-general": "Company General",
        "product-rollout": "Product Rollout",
        "direct:employee1-employee2": "Employee 1 / Employee 2",
        "customer-success": "Customer Success",
    }
    title = (value or fallback_titles.get(thread_id) or thread_id.replace("-", " ").replace(":", " / "))[:120].strip()
    return title or "Company General"


def _employee_handle_for_user(user: User) -> str | None:
    email_local_part = user.email.split("@", 1)[0].lower()
    if email_local_part.startswith("employee"):
        return email_local_part
    normalized_name = user.display_name.lower().replace(" ", "")
    return normalized_name if normalized_name.startswith("employee") else None


ThreadKind = Literal["channel", "direct", "group"]


def _validated_participants(
    db: Session,
    *,
    current_user: User,
    thread_kind: ThreadKind,
    requested_ids: set[str],
) -> set[str]:
    if thread_kind in {"direct", "group"} and not requested_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Direct and group threads require participant_user_ids")
    if not requested_ids:
        return set()
    requested_ids.add(current_user.user_id)
    valid_ids = set(db.scalars(select(User.user_id).where(
        User.workspace_id == current_user.workspace_id,
        User.user_id.in_(requested_ids),
        User.is_active.is_(True),
    )).all())
    if valid_ids != requested_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive thread participant")
    if thread_kind in {"direct", "group"} and len(valid_ids) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Direct and group threads require another active participant")
    return valid_ids


def _existing_private_thread_participants(db: Session, *, workspace_id: str, thread_id: str, thread_kind: ThreadKind) -> set[str]:
    messages = db.scalars(select(CompanyChatMessage).where(
        CompanyChatMessage.workspace_id == workspace_id,
    ).order_by(CompanyChatMessage.created_at.asc())).all()
    matching = [message for message in messages if str(
        (message.message_metadata or {}).get("thread_id") or (message.message_metadata or {}).get("channel")
    ) == thread_id]
    source = next((message for message in matching if (message.message_metadata or {}).get("action") == "group_created"), None)
    source = source or (matching[0] if matching else None)
    metadata = source.message_metadata if source else {}
    known_kind = str((metadata or {}).get("thread_kind") or ("direct" if thread_id.startswith("direct:") else thread_kind))
    if known_kind != thread_kind:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Konuşmanın türü değiştirilemez.")
    if thread_kind == "direct" and thread_id.startswith("direct:"):
        encoded_ids = {value for value in thread_id.removeprefix("direct:").split(":") if value}
        if len(encoded_ids) >= 2:
            return encoded_ids
    return _participant_user_ids_from_metadata(metadata or {}) if thread_kind in {"direct", "group"} else set()


def _participant_handles_from_metadata(metadata: dict[str, object]) -> set[str]:
    raw_participants = metadata.get("participant_handles")
    if not isinstance(raw_participants, list):
        return set()
    return {
        str(participant).strip().lower()
        for participant in raw_participants
        if str(participant).strip()
    }


def _participant_user_ids_from_metadata(metadata: dict[str, object]) -> set[str]:
    raw_participants = metadata.get("participant_user_ids")
    if not isinstance(raw_participants, list):
        return set()
    return {str(participant).strip() for participant in raw_participants if str(participant).strip()}


def _message_is_visible_to_user(message: CompanyChatMessage, current_user: User, db: Session | None = None) -> bool:
    metadata = message.message_metadata or {}
    thread_id = str(metadata.get("thread_id") or metadata.get("channel") or "company-general")
    thread_kind = str(metadata.get("thread_kind") or ("direct" if thread_id.startswith("direct:") else "channel"))
    participant_user_ids = _participant_user_ids_from_metadata(metadata)
    if current_user.is_public_demo:
        if current_user.user_id in participant_user_ids:
            return True
        if metadata.get("seeded") is not True or metadata.get("seed_batch") != _PUBLIC_DEMO_SEED_BATCH or db is None:
            return False
        source_user_id = public_demo_source_user_id(db, current_user)
        return bool(source_user_id and source_user_id in participant_user_ids)
    if participant_user_ids:
        return current_user.user_id in participant_user_ids
    current_handle = _employee_handle_for_user(current_user)
    if thread_kind == "group":
        participant_handles = _participant_handles_from_metadata(metadata)
        return bool(participant_handles) and bool(current_handle) and current_handle in participant_handles
    if thread_kind != "direct":
        return True
    if not current_handle:
        return False
    participants = thread_id.replace("direct:", "", 1).split("-")
    return current_handle in participants


def _thread_is_visible_to_user(thread_id: str, thread_kind: str, current_user: User, db: Session) -> bool:
    if thread_kind not in {"direct", "group"}:
        return True
    if thread_id == "izge-colleague" or thread_id.startswith("assistant-cowork:"):
        return True
    if current_user.user_id in thread_id.replace("direct:", "", 1).split(":"):
        return True
    existing_messages = db.scalars(
        select(CompanyChatMessage)
        .where(CompanyChatMessage.workspace_id == current_user.workspace_id)
        .order_by(CompanyChatMessage.created_at.desc())
        .limit(500)
    ).all()
    if any(
        str((message.message_metadata or {}).get("thread_id") or (message.message_metadata or {}).get("channel")) == thread_id
        and _message_is_visible_to_user(message, current_user, db)
        for message in existing_messages
    ):
        return True
    if thread_kind == "group":
        return False
    current_handle = _employee_handle_for_user(current_user)
    if not current_handle:
        return False
    return current_handle in thread_id.replace("direct:", "", 1).split("-")


def _message_read_model(message: CompanyChatMessage, author_by_id: dict[str, User], db: Session, reader: User) -> TeamChatMessageRead:
    author = author_by_id.get(message.author_user_id)
    author_role: Literal["Admin", "Member"] = "Member"
    if author and author.role == "Admin":
        author_role = "Admin"
    metadata = dict(message.message_metadata or {})
    body = message.body
    source_refs = metadata.get("source_refs")
    if isinstance(source_refs, list) and source_refs:
        refs = [source for source in source_refs if isinstance(source, dict)]
        if len(visible_sources(db, reader, refs)) != len(source_refs):
            body = "Bu yanıtın dayandığı kaynaklara erişiminiz değiştiği için içerik gizlendi."
            metadata["source_refs"] = []
            metadata["follow_ups"] = []
            metadata["thread_title"] = "İzge ile çalışma"
            metadata["source_access_changed"] = True
    attachments = metadata.get("attachments")
    if isinstance(attachments, list):
        artifact_ids = {
            str(attachment.get("artifact_id"))
            for attachment in attachments
            if isinstance(attachment, dict) and attachment.get("artifact_id")
        }
        artifacts = db.scalars(select(Artifact).where(
            Artifact.workspace_id == reader.workspace_id,
            Artifact.artifact_id.in_(artifact_ids),
        )).all() if artifact_ids else []
        visible_ids = {artifact.artifact_id for artifact in artifacts if artifact_is_visible_to_user(db, artifact, reader)}
        metadata["attachments"] = [
            attachment for attachment in attachments
            if isinstance(attachment, dict) and str(attachment.get("artifact_id")) in visible_ids
        ]
    return TeamChatMessageRead(
        message_id=message.message_id,
        workspace_id=message.workspace_id,
        author_user_id=message.author_user_id,
        author_display_name=author.display_name if author else "Unknown user",
        author_role=author_role,
        body=body,
        message_metadata=metadata,
        created_at=message.created_at,
    )


@router.get("", response_model=TeamChatThreadRead)
def list_team_chat_messages(
    limit: int = 80,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    thread_id: str | None = None,
) -> TeamChatThreadRead:
    bounded_limit = max(1, min(limit, 200))
    deleted_threads = set(db.scalars(select(AssistantConversation.thread_id).where(
        AssistantConversation.workspace_id == current_user.workspace_id,
        AssistantConversation.owner_user_id == current_user.user_id,
        AssistantConversation.deleted_at.is_not(None),
    )))
    fetched_messages = db.scalars(
        select(CompanyChatMessage)
        .where(CompanyChatMessage.workspace_id == current_user.workspace_id)
        .order_by(CompanyChatMessage.created_at.desc())
    ).all()
    messages = list(reversed([
        message for message in fetched_messages
        if _message_is_visible_to_user(message, current_user, db)
        and str((message.message_metadata or {}).get("thread_id") or (message.message_metadata or {}).get("channel")) not in deleted_threads
        and (thread_id is None or str((message.message_metadata or {}).get("thread_id") or (message.message_metadata or {}).get("channel")) == thread_id)
    ][:bounded_limit]))
    author_ids = {message.author_user_id for message in messages}
    authors = (
        db.scalars(
            select(User).where(
                User.workspace_id == current_user.workspace_id,
                User.user_id.in_(author_ids),
            )
        ).all()
        if author_ids
        else []
    )
    author_by_id = {author.user_id: author for author in authors}
    return TeamChatThreadRead(
        workspace_id=current_user.workspace_id,
        generated_at=datetime.now(UTC),
        messages=[_message_read_model(message, author_by_id, db, current_user) for message in messages],
    )


@router.get("/typing", response_model=TeamChatTypingRead)
def list_typing_users(
    thread_id: str,
    thread_kind: ThreadKind = "channel",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatTypingRead:
    cleaned_thread_id = _clean_thread_id(thread_id)
    if not _thread_is_visible_to_user(cleaned_thread_id, thread_kind, current_user, db):
        return TeamChatTypingRead(workspace_id=current_user.workspace_id, generated_at=datetime.now(UTC), typing=[])

    now = datetime.now(UTC)
    expired_keys = [key for key, expires_at in _typing_state.items() if expires_at <= now]
    for key in expired_keys:
        _typing_state.pop(key, None)

    active_user_ids = [
        user_id
        for (workspace_id, active_thread_id, user_id), expires_at in _typing_state.items()
        if workspace_id == current_user.workspace_id
        and active_thread_id == cleaned_thread_id
        and user_id != current_user.user_id
        and expires_at > now
    ]
    users = db.scalars(select(User).where(User.workspace_id == current_user.workspace_id, User.user_id.in_(active_user_ids))).all() if active_user_ids else []
    expires_by_user = {(user_id): expires_at for (workspace_id, active_thread_id, user_id), expires_at in _typing_state.items() if workspace_id == current_user.workspace_id and active_thread_id == cleaned_thread_id}
    return TeamChatTypingRead(
        workspace_id=current_user.workspace_id,
        generated_at=now,
        typing=[
            TeamChatTypingUserRead(
                user_id=user.user_id,
                display_name=user.display_name,
                thread_id=cleaned_thread_id,
                expires_at=expires_by_user[user.user_id],
            )
            for user in users
        ],
    )


@router.post("/typing", response_model=TeamChatTypingRead)
def mark_typing(
    payload: TeamChatTypingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatTypingRead:
    cleaned_thread_id = _clean_thread_id(payload.thread_id)
    if not _thread_is_visible_to_user(cleaned_thread_id, payload.thread_kind, current_user, db):
        return TeamChatTypingRead(workspace_id=current_user.workspace_id, generated_at=datetime.now(UTC), typing=[])
    _typing_state[(current_user.workspace_id, cleaned_thread_id, current_user.user_id)] = datetime.now(UTC) + timedelta(seconds=_TYPING_TTL_SECONDS)
    return list_typing_users(cleaned_thread_id, payload.thread_kind, current_user, db)


@router.post("", response_model=TeamChatMessageRead, status_code=status.HTTP_201_CREATED)
def create_team_chat_message(
    payload: TeamChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatMessageRead:
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Message body is required.")
    thread_id = _clean_thread_id(payload.thread_id)
    thread_title = _clean_thread_title(payload.thread_title, thread_id)
    participant_user_ids = _validated_participants(
        db,
        current_user=current_user,
        thread_kind=payload.thread_kind,
        requested_ids=_participant_user_ids_from_metadata(payload.message_metadata),
    )
    message = CompanyChatMessage(
        workspace_id=current_user.workspace_id,
        author_user_id=current_user.user_id,
        body=body,
        message_metadata={
            **payload.message_metadata,
            "channel": thread_id,
            "thread_id": thread_id,
            "thread_title": thread_title,
            "thread_kind": payload.thread_kind,
            **({"participant_user_ids": sorted(participant_user_ids)} if participant_user_ids else {}),
            "source": "izge-product",
        },
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="TEAM_CHAT_MESSAGE_CREATED",
        target_type="company_chat_message",
        target_id=message.message_id,
        event_metadata={"channel": thread_id, "thread_id": thread_id, "thread_title": thread_title, "thread_kind": payload.thread_kind, "body_length": len(body)},
    )
    notify_team_chat_recipients(
        db,
        author=current_user,
        message_id=message.message_id,
        body=body,
        thread_id=thread_id,
        thread_title=thread_title,
        participant_user_ids=participant_user_ids,
    )
    db.commit()
    return _message_read_model(message, {current_user.user_id: current_user}, db, current_user)


@router.post("/attachments", response_model=TeamChatMessageRead, status_code=status.HTTP_201_CREATED)
async def attach_team_chat_file(
    file: UploadFile = File(...),
    thread_id: str = Form(...),
    thread_title: str = Form(...),
    thread_kind: ThreadKind = Form("channel"),
    participant_user_ids: str = Form("[]"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatMessageRead:
    try:
        parsed_participants = json.loads(participant_user_ids)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Katılımcı listesi geçersiz.") from exc
    if not isinstance(parsed_participants, list) or any(not isinstance(item, str) for item in parsed_participants):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Katılımcı listesi geçersiz.")
    cleaned_thread_id = _clean_thread_id(thread_id)
    cleaned_title = _clean_thread_title(thread_title, cleaned_thread_id)
    requested_participants = {item.strip() for item in parsed_participants if item.strip()}
    if thread_kind == "direct" and (cleaned_thread_id == "izge-colleague" or cleaned_thread_id.startswith("assistant-cowork:")) and requested_participants <= {current_user.user_id}:
        participants = {current_user.user_id}
    else:
        participants = _validated_participants(
            db,
            current_user=current_user,
            thread_kind=thread_kind,
            requested_ids=requested_participants,
        )
        existing_participants = _existing_private_thread_participants(
            db,
            workspace_id=current_user.workspace_id,
            thread_id=cleaned_thread_id,
            thread_kind=thread_kind,
        )
        if existing_participants and participants != existing_participants:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dosya mevcut konuşmanın katılımcılarıyla paylaşılmalıdır.")
    if not _thread_is_visible_to_user(cleaned_thread_id, thread_kind, current_user, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu konuşmaya dosya ekleyemezsiniz.")
    try:
        ensure_supported_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    content = await file.read()
    if len(content) > get_settings().max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Dosya izin verilen boyut sınırını aşıyor.")
    filename = Path(file.filename or "dosya.txt").name
    artifact = Artifact(
        workspace_id=current_user.workspace_id,
        title=filename,
        source_type="team_chat_attachment",
        source_path="pending",
        mime_type=file.content_type or "application/octet-stream",
        uploaded_by=current_user.user_id,
        visibility_scope="workspace" if thread_kind == "channel" else "restricted",
        original_filename=filename,
        ingestion_status="pending",
        review_notes=f"Sohbet eki · {cleaned_title}",
    )
    db.add(artifact)
    db.flush()
    source_path: str | None = None
    try:
        source_path, checksum = persist_upload_bytes(content, artifact_id=artifact.artifact_id, filename=filename)
        artifact.source_path = source_path
        artifact.checksum_sha256 = checksum
        for user_id in sorted(participants if thread_kind in {"direct", "group"} else set()):
            db.add(ArtifactPermission(
                workspace_id=current_user.workspace_id,
                artifact_id=artifact.artifact_id,
                user_id=user_id,
                granted_by=current_user.user_id,
            ))
        message = CompanyChatMessage(
            workspace_id=current_user.workspace_id,
            author_user_id=current_user.user_id,
            body=f"📎 {filename}",
            message_metadata={
                "channel": cleaned_thread_id,
                "thread_id": cleaned_thread_id,
                "thread_title": cleaned_title,
                "thread_kind": thread_kind,
                **({"participant_user_ids": sorted(participants)} if participants else {}),
                "source": "izge-product",
                "attachment_only": True,
                "attachments": [{
                    "artifact_id": artifact.artifact_id,
                    "title": filename,
                    "filename": filename,
                    "mime_type": artifact.mime_type,
                }],
            },
        )
        db.add(message)
        db.commit()
    except Exception:
        db.rollback()
        if source_path:
            shutil.rmtree(Path(source_path).parent, ignore_errors=True)
        raise
    db.refresh(message)
    logger = logging.getLogger(__name__)
    try:
        from app.routers.artifacts import _feed_memory_inline
        _feed_memory_inline(db, artifact, current_user)
    except Exception:
        db.rollback()
        logger.exception("Team chat attachment ingestion failed after persistence: artifact_id=%s", artifact.artifact_id)
    try:
        log_event(
            db,
            workspace_id=current_user.workspace_id,
            actor_user_id=current_user.user_id,
            event_type="TEAM_CHAT_ATTACHMENT_CREATED",
            target_type="company_chat_message",
            target_id=message.message_id,
            event_metadata={"thread_id": cleaned_thread_id, "artifact_id": artifact.artifact_id, "mime_type": artifact.mime_type},
        )
    except Exception:
        db.rollback()
        logger.exception("Team chat attachment audit failed after persistence: message_id=%s", message.message_id)
    try:
        notify_team_chat_recipients(
            db,
            author=current_user,
            message_id=message.message_id,
            body=f"Dosya paylaştı: {filename}",
            thread_id=cleaned_thread_id,
            thread_title=cleaned_title,
            participant_user_ids=participants,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Team chat attachment notification failed after persistence: message_id=%s", message.message_id)
    return _message_read_model(message, {current_user.user_id: current_user}, db, current_user)
