from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import AuditEvent, User
from app.schemas.api import AuditEventRead
from app.services.permissions import require_admin

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/events", response_model=list[AuditEventRead])
def list_audit_events(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[AuditEventRead]:
    require_admin(current_user)
    events = db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == current_user.workspace_id).order_by(AuditEvent.timestamp.desc())).all()
    return [AuditEventRead.model_validate(event) for event in events]
