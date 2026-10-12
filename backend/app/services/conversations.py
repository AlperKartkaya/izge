from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssistantConversation, ColleagueRun, CompanyChatMessage, User


DEFAULT_ASSISTANT_THREAD_ID = "izge-colleague"
DEFAULT_ASSISTANT_TITLE = "İzge ile çalışma"


def get_owned_conversation(db: Session, actor: User, conversation_id: str) -> AssistantConversation:
    conversation = db.scalar(select(AssistantConversation).where(
        AssistantConversation.conversation_id == conversation_id,
        AssistantConversation.workspace_id == actor.workspace_id,
        AssistantConversation.owner_user_id == actor.user_id,
        AssistantConversation.deleted_at.is_(None),
    ))
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Konuşma bulunamadı.")
    return conversation


def conversation_for_thread(db: Session, actor: User, thread_id: str) -> AssistantConversation | None:
    return db.scalar(select(AssistantConversation).where(
        AssistantConversation.workspace_id == actor.workspace_id,
        AssistantConversation.owner_user_id == actor.user_id,
        AssistantConversation.thread_id == thread_id,
    ))


def empty_active_conversation(db: Session, actor: User) -> AssistantConversation | None:
    has_run = select(ColleagueRun.run_id).where(
        ColleagueRun.workspace_id == actor.workspace_id,
        ColleagueRun.created_by == actor.user_id,
        ColleagueRun.thread_id == AssistantConversation.thread_id,
    ).exists()
    has_attachment = select(CompanyChatMessage.message_id).where(
        CompanyChatMessage.workspace_id == actor.workspace_id,
        CompanyChatMessage.author_user_id == actor.user_id,
        CompanyChatMessage.message_metadata["thread_id"].as_string() == AssistantConversation.thread_id,
    ).exists()
    return db.scalar(select(AssistantConversation).where(
        AssistantConversation.workspace_id == actor.workspace_id,
        AssistantConversation.owner_user_id == actor.user_id,
        AssistantConversation.archived_at.is_(None),
        AssistantConversation.deleted_at.is_(None),
        ~has_run,
        ~has_attachment,
    ).order_by(AssistantConversation.created_at.desc()).limit(1))


def ensure_personal_conversation(
    db: Session,
    actor: User,
    *,
    thread_id: str | None,
    title: str | None,
) -> AssistantConversation:
    raw_thread_id = (thread_id or DEFAULT_ASSISTANT_THREAD_ID).strip().lower()
    cleaned_thread_id = "".join(character for character in raw_thread_id if character.isalnum() or character in {"-", "_", ":"})[:80] or DEFAULT_ASSISTANT_THREAD_ID
    conversation = conversation_for_thread(db, actor, cleaned_thread_id)
    if conversation is None:
        conversation = AssistantConversation(
            workspace_id=actor.workspace_id,
            owner_user_id=actor.user_id,
            thread_id=cleaned_thread_id,
            title=((title or DEFAULT_ASSISTANT_TITLE).strip() or DEFAULT_ASSISTANT_TITLE)[:120],
        )
        db.add(conversation)
        db.flush()
    elif conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Silinmiş konuşmaya yeni mesaj gönderilemez.")
    elif conversation.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Arşivlenmiş konuşmaya yeni mesaj gönderilemez.")
    return conversation


def archive_conversation(conversation: AssistantConversation, archived: bool) -> None:
    conversation.archived_at = datetime.utcnow() if archived else None
