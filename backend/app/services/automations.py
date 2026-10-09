from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ColleagueRun, User
from app.models.automation import Automation
from app.services.colleague import enqueue_colleague_question


ISTANBUL = ZoneInfo("Europe/Istanbul")


def local_time(now: datetime) -> datetime:
    return (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(ISTANBUL)


def next_run_at(automation: Automation, now: datetime) -> datetime | None:
    if not automation.enabled:
        return None
    local_now = local_time(now)
    hour, minute = map(int, automation.schedule_time.split(":"))
    target = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    already_ran = automation.last_run_at is not None and local_time(automation.last_run_at).date() == local_now.date()
    if already_ran:
        target += timedelta(days=1)
    # An overdue job runs on the worker's next poll, not a fictitious tomorrow.
    return max(target, local_now).astimezone(UTC)


def enqueue_automation(db: Session, automation: Automation, actor: User, *, now: datetime, scheduled: bool) -> ColleagueRun:
    key = f"automation:{automation.automation_id}:{local_time(now).date().isoformat()}" if scheduled else f"automation-manual:{uuid4()}"
    run = db.scalar(select(ColleagueRun).where(ColleagueRun.workspace_id == automation.workspace_id, ColleagueRun.client_request_id == key))
    if run is None:
        run = enqueue_colleague_question(
            db,
            actor=actor,
            message=automation.prompt,
            client_request_id=key,
            thread_id=f"automation:{automation.automation_id}",
            thread_title=automation.title,
            thread_kind="direct",
            participant_user_ids=[actor.user_id],
            response_language=automation.response_language,
        )
    if scheduled:
        automation.last_run_at = (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(UTC).replace(tzinfo=None)
        db.commit()
    return run


def dispatch_due_automations(db: Session, now: datetime) -> int:
    local_now = local_time(now)
    queued = 0
    for automation in db.scalars(select(Automation).where(Automation.enabled.is_(True))).all():
        if automation.schedule_time > local_now.strftime("%H:%M"):
            continue
        if automation.last_run_at and local_time(automation.last_run_at).date() >= local_now.date():
            continue
        actor = db.scalar(select(User).where(User.user_id == automation.created_by, User.workspace_id == automation.workspace_id, User.is_active.is_(True)))
        if actor is None:
            continue
        enqueue_automation(db, automation, actor, now=now, scheduled=True)
        queued += 1
    return queued
