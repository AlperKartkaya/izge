from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Notification, User


def create_notification(
    db: Session,
    *,
    recipient: User,
    kind: str,
    title: str,
    body: str,
    source_key: str,
    thread_id: str | None = None,
    run_id: str | None = None,
    message_id: str | None = None,
) -> Notification:
    existing = db.scalar(
        select(Notification).where(
            Notification.recipient_user_id == recipient.user_id,
            Notification.source_key == source_key,
        )
    )
    if existing is not None:
        return existing
    notification = Notification(
        workspace_id=recipient.workspace_id,
        recipient_user_id=recipient.user_id,
        kind=kind,
        title=title[:255],
        body=body[:1200] if run_id or message_id else body,
        source_key=source_key,
        thread_id=thread_id,
        run_id=run_id,
        message_id=message_id,
    )
    try:
        with db.begin_nested():
            db.add(notification)
            db.flush()
    except IntegrityError:
        existing = db.scalar(
            select(Notification).where(
                Notification.recipient_user_id == recipient.user_id,
                Notification.source_key == source_key,
            )
        )
        if existing is None:
            raise
        return existing
    return notification


def notify_team_chat_recipients(
    db: Session,
    *,
    author: User,
    message_id: str,
    body: str,
    thread_id: str,
    thread_title: str,
    participant_user_ids: set[str],
) -> int:
    if participant_user_ids:
        recipient_ids = participant_user_ids - {author.user_id}
    else:
        recipient_ids = set(
            db.scalars(
                select(User.user_id).where(
                    User.workspace_id == author.workspace_id,
                    User.is_active.is_(True),
                    User.is_public_demo.is_(False),
                    User.user_id != author.user_id,
                    User.email != "izge-agent@local.invalid",
                )
            ).all()
        )
    recipients = list(db.scalars(select(User).where(
        User.workspace_id == author.workspace_id,
        User.user_id.in_(recipient_ids),
        User.is_active.is_(True),
        User.is_public_demo.is_(False),
        User.email != "izge-agent@local.invalid",
    )).all()) if recipient_ids else []
    for recipient in recipients:
        create_notification(
            db,
            recipient=recipient,
            kind="message",
            title=f"{author.display_name} · {thread_title}",
            body=body,
            source_key=f"message:{message_id}",
            thread_id=thread_id,
            message_id=message_id,
        )
    return len(recipients)
