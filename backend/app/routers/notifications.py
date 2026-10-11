from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import ColleagueRun, CompanyChatMessage, Notification, User
from app.schemas.notifications import NotificationList, NotificationRead
from app.services.colleague import utcnow
from app.services.agent_sources import visible_sources


router = APIRouter(prefix="/notifications", tags=["notifications"])


def _sources(notification: Notification, db: Session) -> list[dict]:
    if notification.run_id:
        run = db.get(ColleagueRun, notification.run_id)
        return list(run.sources or []) if run else []
    if notification.message_id:
        message = db.get(CompanyChatMessage, notification.message_id)
        refs = (message.message_metadata or {}).get("source_refs") if message else None
        return [source for source in refs if isinstance(source, dict)] if isinstance(refs, list) else []
    return []


def _read(notification: Notification, db: Session, reader: User) -> NotificationRead:
    payload = NotificationRead.model_validate(notification, from_attributes=True)
    sources = _sources(notification, db)
    if len(visible_sources(db, reader, sources)) != len(sources):
        payload.title = "Erişimi değişen İzge bildirimi"
        payload.body = "Bu bildirimin dayandığı kaynaklara erişiminiz değiştiği için içerik gizlendi."
    return payload


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
    items = list(db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)).all())
    unread_count = db.scalar(
        select(func.count()).select_from(Notification).where(
            Notification.workspace_id == current_user.workspace_id,
            Notification.recipient_user_id == current_user.user_id,
            Notification.read_at.is_(None),
        )
    ) or 0
    return NotificationList(items=[_read(item, db, current_user) for item in items], unread_count=unread_count)


@router.patch("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationRead:
    notification = db.scalar(
        select(Notification).where(
            Notification.notification_id == notification_id,
            Notification.workspace_id == current_user.workspace_id,
            Notification.recipient_user_id == current_user.user_id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bildirim bulunamadı.")
    if notification.read_at is None:
        notification.read_at = utcnow()
        db.commit()
        db.refresh(notification)
    return _read(notification, db, current_user)
