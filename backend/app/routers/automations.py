from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import ColleagueRun, User
from app.models.automation import Automation
from app.schemas.automation import AutomationCreate, AutomationList, AutomationRead, AutomationUpdate
from app.schemas.work import ColleagueAskAccepted, RunStatus
from app.services.automations import ISTANBUL, enqueue_automation, next_run_at


router = APIRouter(prefix="/automations", tags=["automations"])


def _owned(db: Session, actor: User, automation_id: str) -> Automation:
    item = db.scalar(select(Automation).where(Automation.automation_id == automation_id, Automation.workspace_id == actor.workspace_id, Automation.created_by == actor.user_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Otomasyon bulunamadı.")
    return item


def _read(db: Session, item: Automation) -> AutomationRead:
    run_scope = (
        ColleagueRun.workspace_id == item.workspace_id,
        ColleagueRun.created_by == item.created_by,
        ColleagueRun.thread_id == f"automation:{item.automation_id}",
    )
    latest_run = db.scalar(select(ColleagueRun).where(*run_scope, ColleagueRun.run_id == item.last_run_id)) if item.last_run_id else None
    if latest_run is None:
        latest_run = db.scalar(select(ColleagueRun).where(*run_scope).order_by(ColleagueRun.created_at.desc()).limit(1))
    last_run_id = latest_run.run_id if latest_run else None
    last_run_at = latest_run.started_at if latest_run else item.last_run_at
    return AutomationRead.model_validate({
        "automation_id": item.automation_id, "title": item.title, "prompt": item.prompt,
        "schedule_time": item.schedule_time, "frequency": item.frequency, "starts_at": item.starts_at,
        "response_language": item.response_language, "enabled": item.enabled,
        "last_run_at": last_run_at, "last_run_id": last_run_id,
        "last_run_status": latest_run.status if latest_run else None,
        "next_run_at": next_run_at(item, datetime.now(UTC)), "created_at": item.created_at, "updated_at": item.updated_at,
    })


@router.get("", response_model=AutomationList)
def list_automations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationList:
    items = db.scalars(select(Automation).where(Automation.workspace_id == current_user.workspace_id, Automation.created_by == current_user.user_id).order_by(Automation.created_at.desc())).all()
    return AutomationList(items=[_read(db, item) for item in items])


@router.post("", response_model=AutomationRead, status_code=201)
def create_automation(payload: AutomationCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationRead:
    values = payload.model_dump()
    if payload.starts_at is not None:
        values["starts_at"] = payload.starts_at.astimezone(UTC).replace(tzinfo=None)
        values["schedule_time"] = payload.starts_at.astimezone(ISTANBUL).strftime("%H:%M")
    item = Automation(workspace_id=current_user.workspace_id, created_by=current_user.user_id, **values)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _read(db, item)


@router.patch("/{automation_id}", response_model=AutomationRead)
def update_automation(automation_id: str, payload: AutomationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AutomationRead:
    item = _owned(db, current_user, automation_id)
    values = payload.model_dump(exclude_none=True)
    if payload.starts_at is not None:
        values["starts_at"] = payload.starts_at.astimezone(UTC).replace(tzinfo=None)
        values["schedule_time"] = payload.starts_at.astimezone(ISTANBUL).strftime("%H:%M")
    elif "schedule_time" in values and item.starts_at is not None:
        local_start = item.starts_at.replace(tzinfo=UTC).astimezone(ISTANBUL)
        hour, minute = map(int, values["schedule_time"].split(":"))
        values["starts_at"] = local_start.replace(hour=hour, minute=minute).astimezone(UTC).replace(tzinfo=None)
    if "starts_at" in values or "frequency" in values:
        item.last_scheduled_at = None
    for key, value in values.items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return _read(db, item)


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
