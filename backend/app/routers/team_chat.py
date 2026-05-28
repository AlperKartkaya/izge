from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import CompanyChatMessage, User
from app.schemas.api import TeamChatMessageCreate, TeamChatMessageRead, TeamChatThreadRead
from app.services.audit import log_event

router = APIRouter(prefix="/team-chat", tags=["team-chat"])


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


def _message_read_model(message: CompanyChatMessage, author_by_id: dict[str, User]) -> TeamChatMessageRead:
    author = author_by_id.get(message.author_user_id)
    return TeamChatMessageRead(
        message_id=message.message_id,
        workspace_id=message.workspace_id,
        author_user_id=message.author_user_id,
        author_display_name=author.display_name if author else "Unknown user",
        author_role=author.role if author and author.role in {"Admin", "Member"} else "Member",
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
    messages = list(
        reversed(
            db.scalars(
                select(CompanyChatMessage)
                .where(CompanyChatMessage.workspace_id == current_user.workspace_id)
                .order_by(CompanyChatMessage.created_at.desc())
                .limit(bounded_limit)
            ).all()
        )
    )
    author_ids = {message.author_user_id for message in messages}
    authors = db.scalars(select(User).where(User.workspace_id == current_user.workspace_id, User.user_id.in_(author_ids))).all() if author_ids else []
    author_by_id = {author.user_id: author for author in authors}
    return TeamChatThreadRead(
        workspace_id=current_user.workspace_id,
        generated_at=datetime.now(UTC),
        messages=[_message_read_model(message, author_by_id) for message in messages],
    )


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
            "channel": thread_id,
            "thread_id": thread_id,
            "thread_title": thread_title,
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
        event_metadata={"channel": thread_id, "thread_id": thread_id, "thread_title": thread_title, "body_length": len(body)},
    )
    return _message_read_model(message, {current_user.user_id: current_user})
