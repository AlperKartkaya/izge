from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from app.db import get_db
from app.dependencies import get_current_user
from app.models import ColleagueRun, CompanyChatMessage, Notification, User
from app.schemas.notifications import NotificationList, NotificationRead
from app.services.colleague import _notification_body, utcnow
from app.services.agent_sources import visible_sources


router = APIRouter(prefix="/notifications", tags=["notifications"])
LIST_BODY_LIMIT = 320


def _sources(notification: Notification, db: Session) -> list[dict]:
    if notification.run_id:
        sources = db.scalar(select(ColleagueRun.sources).where(
            ColleagueRun.run_id == notification.run_id,
            ColleagueRun.workspace_id == notification.workspace_id,
        ))
        return list(sources or [])
    if notification.message_id:
        metadata = db.scalar(select(CompanyChatMessage.message_metadata).where(
            CompanyChatMessage.message_id == notification.message_id,
            CompanyChatMessage.workspace_id == notification.workspace_id,
        ))
        refs = (metadata or {}).get("source_refs")
        return [source for source in refs if isinstance(source, dict)] if isinstance(refs, list) else []
    return []


def _read(notification: Notification, db: Session, reader: User) -> NotificationRead:
    payload = NotificationRead.model_validate(notification, from_attributes=True)
    sources = _sources(notification, db)
    if len(visible_sources(db, reader, sources)) != len(sources):
        payload.title = "Erişimi değişen İzge bildirimi"
        payload.body = "Bu bildirimin dayandığı kaynaklara erişiminiz değiştiği için içerik gizlendi."
    elif notification.run_id:
        answer = db.scalar(select(ColleagueRun.answer).where(
            ColleagueRun.run_id == notification.run_id,
            ColleagueRun.workspace_id == notification.workspace_id,
        ))
        if answer:
            payload.body = _notification_body(answer)
    elif notification.message_id:
        message_body = db.scalar(select(CompanyChatMessage.body).where(
            CompanyChatMessage.message_id == notification.message_id,
            CompanyChatMessage.workspace_id == notification.workspace_id,
        ))
        if message_body:
            payload.body = _notification_body(message_body)
    return payload


def _list_read(notification: Notification, body: str, body_length: int, db: Session, reader: User) -> NotificationRead:
    payload = NotificationRead(
        notification_id=notification.notification_id,
        kind=notification.kind,
        title=notification.title,
        body=f"{body.rstrip()}…" if body_length > LIST_BODY_LIMIT else body,
        thread_id=notification.thread_id,
        run_id=notification.run_id,
        message_id=notification.message_id,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )
    sources = _sources(notification, db)
    if len(visible_sources(db, reader, sources)) != len(sources):
        payload.title = "Erişimi değişen İzge bildirimi"
        payload.body = "Bu bildirimin dayandığı kaynaklara erişiminiz değiştiği için içerik gizlendi."
    return payload


def _stored_list_read(notification: Notification, db: Session, reader: User) -> NotificationRead:
    return _list_read(notification, notification.body[:LIST_BODY_LIMIT], len(notification.body), db, reader)


def _owned_notification(notification_id: str, current_user: User, db: Session) -> Notification:
    notification = db.scalar(
        select(Notification).where(
            Notification.notification_id == notification_id,
            Notification.workspace_id == current_user.workspace_id,
            Notification.recipient_user_id == current_user.user_id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bildirim bulunamadı.")
    return notification


@router.get("", response_model=NotificationList)
def list_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationList:
    query = select(Notification).where(
        Notification.workspace_id == current_user.workspace_id,
        Notification.recipient_user_id == current_user.user_id,
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.execute(
        query
        .add_columns(
            func.substr(Notification.body, 1, LIST_BODY_LIMIT),
            func.length(Notification.body),
        )
        .options(load_only(
            Notification.notification_id,
            Notification.workspace_id,
            Notification.recipient_user_id,
            Notification.kind,
            Notification.title,
            Notification.thread_id,
            Notification.run_id,
            Notification.message_id,
            Notification.source_key,
            Notification.read_at,
            Notification.created_at,
        ))
        .order_by(Notification.created_at.desc())
        .limit(limit)
    ).all()
    unread_count = db.scalar(
        select(func.count()).select_from(Notification).where(
            Notification.workspace_id == current_user.workspace_id,
            Notification.recipient_user_id == current_user.user_id,
            Notification.read_at.is_(None),
        )
    ) or 0
    return NotificationList(
        items=[_list_read(item, body or "", body_length or 0, db, current_user) for item, body, body_length in rows],
        unread_count=unread_count,
    )


@router.get("/{notification_id}", response_model=NotificationRead)
def get_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationRead:
    return _read(_owned_notification(notification_id, current_user, db), db, current_user)


@router.patch("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationRead:
    notification = _owned_notification(notification_id, current_user, db)
    if notification.read_at is None:
        notification.read_at = utcnow()
        db.commit()
        db.refresh(notification)
    return _stored_list_read(notification, db, current_user)


@router.patch("/{notification_id}/unread", response_model=NotificationRead)
def mark_notification_unread(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationRead:
    notification = _owned_notification(notification_id, current_user, db)
    if notification.read_at is not None:
        notification.read_at = None
        db.commit()
        db.refresh(notification)
    return _stored_list_read(notification, db, current_user)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    notification = _owned_notification(notification_id, current_user, db)
    db.delete(notification)
    db.commit()
