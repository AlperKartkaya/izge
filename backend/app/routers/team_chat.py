from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import CompanyChatMessage, User
from app.schemas.api import TeamChatMessageCreate, TeamChatMessageRead, TeamChatThreadRead, TeamChatTypingCreate, TeamChatTypingRead, TeamChatTypingUserRead
from app.services.audit import log_event

router = APIRouter(prefix="/team-chat", tags=["team-chat"])
_TYPING_TTL_SECONDS = 5
_typing_state: dict[tuple[str, str, str], datetime] = {}


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


def _message_is_visible_to_user(message: CompanyChatMessage, current_user: User) -> bool:
    if current_user.role == "Admin":
        return True
    metadata = message.message_metadata or {}
    thread_id = str(metadata.get("thread_id") or metadata.get("channel") or "company-general")
    thread_kind = str(metadata.get("thread_kind") or ("direct" if thread_id.startswith("direct:") else "channel"))
    if thread_kind != "direct":
        return True
    current_handle = _employee_handle_for_user(current_user)
    if not current_handle:
        return False
    participants = thread_id.replace("direct:", "", 1).split("-")
    return current_handle in participants


def _thread_is_visible_to_user(thread_id: str, thread_kind: str, current_user: User) -> bool:
    if current_user.role == "Admin" or thread_kind != "direct":
        return True
    if thread_id.startswith("assistant-cowork:"):
        return True
    current_handle = _employee_handle_for_user(current_user)
    if not current_handle:
        return False
    return current_handle in thread_id.replace("direct:", "", 1).split("-")


def _message_read_model(message: CompanyChatMessage, author_by_id: dict[str, User]) -> TeamChatMessageRead:
    author = author_by_id.get(message.author_user_id)
    author_role: Literal["Admin", "Member"] = "Member"
    if author and author.role == "Admin":
        author_role = "Admin"
    return TeamChatMessageRead(
        message_id=message.message_id,
        workspace_id=message.workspace_id,
        author_user_id=message.author_user_id,
        author_display_name=author.display_name if author else "Unknown user",
        author_role=author_role,
        body=message.body,
        message_metadata=message.message_metadata or {},
        created_at=message.created_at,
    )


@router.get("", response_model=TeamChatThreadRead)
def list_team_chat_messages(
    limit: int = 80,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatThreadRead:
    bounded_limit = max(1, min(limit, 200))
    fetched_messages = list(
        reversed(
            db.scalars(
                select(CompanyChatMessage)
                .where(CompanyChatMessage.workspace_id == current_user.workspace_id)
                .order_by(CompanyChatMessage.created_at.desc())
                .limit(bounded_limit)
            ).all()
        )
    )
    messages = [message for message in fetched_messages if _message_is_visible_to_user(message, current_user)]
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
        messages=[_message_read_model(message, author_by_id) for message in messages],
    )


@router.get("/typing", response_model=TeamChatTypingRead)
def list_typing_users(
    thread_id: str,
    thread_kind: Literal["channel", "direct"] = "channel",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatTypingRead:
    cleaned_thread_id = _clean_thread_id(thread_id)
    if not _thread_is_visible_to_user(cleaned_thread_id, thread_kind, current_user):
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
    if not _thread_is_visible_to_user(cleaned_thread_id, payload.thread_kind, current_user):
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
    return _message_read_model(message, {current_user.user_id: current_user})
