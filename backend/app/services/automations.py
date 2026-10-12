from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssistantConversation, ColleagueRun, User
from app.models.automation import Automation
from app.services.colleague import enqueue_colleague_question


ISTANBUL = ZoneInfo("Europe/Istanbul")
FREQUENCY_INTERVALS = {
    "hourly": timedelta(hours=1),
    "every_6_hours": timedelta(hours=6),
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
}


def local_time(now: datetime) -> datetime:
    return (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(ISTANBUL)


def _utc(now: datetime) -> datetime:
    return (now if now.tzinfo else now.replace(tzinfo=UTC)).astimezone(UTC)


def _anchor(automation: Automation) -> datetime:
    if automation.starts_at is not None:
        return _utc(automation.starts_at)
    created = local_time(automation.created_at)
    hour, minute = map(int, automation.schedule_time.split(":"))
    return created.replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(UTC)


def _latest_slot(automation: Automation, now: datetime) -> datetime | None:
    anchor, current = _anchor(automation), _utc(now)
    if current < anchor:
        return None
    interval = FREQUENCY_INTERVALS[automation.frequency]
    return anchor + interval * ((current - anchor) // interval)


def _scheduled_checkpoint(automation: Automation) -> datetime | None:
    return _utc(automation.last_scheduled_at) if automation.last_scheduled_at is not None else None


def _next_slot_after(automation: Automation, checkpoint: datetime) -> datetime:
    anchor = _anchor(automation)
    interval = FREQUENCY_INTERVALS[automation.frequency]
    if checkpoint < anchor:
        return anchor
    return anchor + interval * (((checkpoint - anchor) // interval) + 1)


def next_run_at(automation: Automation, now: datetime) -> datetime | None:
    if not automation.enabled:
        return None
    current, anchor = _utc(now), _anchor(automation)
    checkpoint = _scheduled_checkpoint(automation)
    target = anchor if checkpoint is None else _next_slot_after(automation, checkpoint)
    # An overdue job runs on the worker's next poll; only its latest slot is dispatched.
    return max(target, current)


def _active_thread_id(db: Session, automation: Automation, actor: User) -> str:
    thread_id = f"automation:{automation.automation_id}"
    while conversation := db.scalar(select(AssistantConversation).where(
        AssistantConversation.workspace_id == automation.workspace_id,
        AssistantConversation.owner_user_id == actor.user_id,
        AssistantConversation.thread_id == thread_id,
    )):
        if conversation.archived_at is None and conversation.deleted_at is None:
            return thread_id
        thread_id = f"{thread_id[:42]}:{conversation.conversation_id}"
    return thread_id


def enqueue_automation(db: Session, automation: Automation, actor: User, *, now: datetime, scheduled: bool) -> ColleagueRun:
    slot = _latest_slot(automation, now) if scheduled else None
    if scheduled and slot is None:
        raise ValueError("Automation is not due yet")
    key = f"automation:{automation.automation_id}:{slot.isoformat()}" if slot else f"automation-manual:{uuid4()}"
    run = db.scalar(select(ColleagueRun).where(ColleagueRun.workspace_id == automation.workspace_id, ColleagueRun.client_request_id == key))
    if run is None:
        run = enqueue_colleague_question(
            db,
            actor=actor,
            message=automation.prompt,
            client_request_id=key,
            thread_id=_active_thread_id(db, automation, actor),
            thread_title=automation.title,
            thread_kind="direct",
            participant_user_ids=[actor.user_id],
            response_language=automation.response_language,
        )
    automation.last_run_at = _utc(now).replace(tzinfo=None)
    automation.last_run_id = run.run_id
    if slot is not None:
        automation.last_scheduled_at = slot.replace(tzinfo=None)
    db.commit()
    return run


def dispatch_due_automations(db: Session, now: datetime) -> int:
    queued = 0
    for automation in db.scalars(select(Automation).where(Automation.enabled.is_(True))).all():
        slot = _latest_slot(automation, now)
        checkpoint = _scheduled_checkpoint(automation)
        if slot is None or (checkpoint is not None and checkpoint >= slot):
            continue
        actor = db.scalar(select(User).where(
            User.user_id == automation.created_by,
            User.workspace_id == automation.workspace_id,
            User.is_active.is_(True),
            User.is_public_demo.is_(False),
        ))
        if actor is None:
            continue
        enqueue_automation(db, automation, actor, now=now, scheduled=True)
        queued += 1
    return queued
