from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.automation import Automation
from app.schemas.automation import AutomationCreate, AutomationList, AutomationRead, AutomationUpdate
from app.schemas.work import ColleagueAskAccepted, RunStatus
from app.services.automations import enqueue_automation, next_run_at


router = APIRouter(prefix="/automations", tags=["automations"])


def _owned(db: Session, actor: User, automation_id: str) -> Automation:
    item = db.scalar(select(Automation).where(Automation.automation_id == automation_id, Automation.workspace_id == actor.workspace_id, Automation.created_by == actor.user_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Otomasyon bulunamadı.")
    return item


def _read(item: Automation) -> AutomationRead:
    return AutomationRead.model_validate({
        "automation_id": item.automation_id, "title": item.title, "prompt": item.prompt,
        "schedule_time": item.schedule_time, "response_language": item.response_language,
        "enabled": item.enabled, "last_run_at": item.last_run_at,
        "next_run_at": next_run_at(item, datetime.now(UTC)), "created_at": item.created_at, "updated_at": item.updated_at,
    })


@router.get("", response_model=AutomationList)
def list_automations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationList:
    items = db.scalars(select(Automation).where(Automation.workspace_id == current_user.workspace_id, Automation.created_by == current_user.user_id).order_by(Automation.created_at.desc())).all()
    return AutomationList(items=[_read(item) for item in items])


@router.post("", response_model=AutomationRead, status_code=201)
def create_automation(payload: AutomationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationRead:
    item = Automation(workspace_id=current_user.workspace_id, created_by=current_user.user_id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return _read(item)


@router.patch("/{automation_id}", response_model=AutomationRead)
def update_automation(automation_id: str, payload: AutomationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationRead:
    item = _owned(db, current_user, automation_id)
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return _read(item)


@router.delete("/{automation_id}", status_code=204)
def delete_automation(automation_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    db.delete(_owned(db, current_user, automation_id))
    db.commit()
    return Response(status_code=204)


@router.post("/{automation_id}/run", response_model=ColleagueAskAccepted, status_code=202)
def run_automation(automation_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ColleagueAskAccepted:
    item = _owned(db, current_user, automation_id)
    run = enqueue_automation(db, item, current_user, now=datetime.now(UTC), scheduled=False)
    return ColleagueAskAccepted(run_id=run.run_id, thread_id=run.thread_id, status=cast(RunStatus, run.status))
