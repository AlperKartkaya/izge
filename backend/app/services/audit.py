from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AuditEvent


def log_event(
    db: Session,
    *,
    workspace_id: str,
    actor_user_id: str | None,
    event_type: str,
    target_type: str,
    target_id: str,
    event_metadata: dict,
) -> AuditEvent:
    event = AuditEvent(
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        event_metadata=event_metadata,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
