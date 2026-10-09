from __future__ import annotations

import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Literal, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.dependencies import get_current_user
from app.models import Artifact, ColleagueRun, ColleagueRunEvent, User, WorkTask
from app.schemas.work import (
    ColleagueAskAccepted,
    ColleagueAskCreate,
    ColleagueReviewAccepted,
    ColleagueRunList,
    ColleagueRunRead,
    ColleagueSourceRead,
    ColleagueStageRead,
    RunStatus,
    TaskStatus,
    ThreadKind,
    WorkTaskCreate,
    WorkTaskList,
    WorkTaskRead,
    WorkTaskUpdate,
)
from app.services.audit import log_event
from app.services.colleague import TERMINAL_RUN_STATUSES, enqueue_colleague_question, enqueue_manual_review, task_sources_visible_to_readers
from app.services.permissions import artifact_is_visible_to_user


router = APIRouter(prefix="/work", tags=["work"])


def _response_language_from_header(value: str | None) -> Literal["tr", "en"]:
    primary = (value or "tr").split(",", 1)[0].strip().split("-", 1)[0].lower()
    return "en" if primary == "en" else "tr"


def _utc_naive(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _visible_source_ids(db: Session, user: User, source_ids: list[str]) -> list[str]:
    if not source_ids:
        return []
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id, Artifact.artifact_id.in_(source_ids))).all()
    visible_ids = {artifact.artifact_id for artifact in artifacts if artifact_is_visible_to_user(db, artifact, user)}
    return [source_id for source_id in source_ids if source_id in visible_ids]


def _task_read(db: Session, reader: User, task: WorkTask, assignee: User | None) -> WorkTaskRead:
    source_ids = list(task.source_artifact_ids or [])
    visible_source_ids = _visible_source_ids(db, reader, source_ids)
    source_text_is_visible = task_sources_visible_to_readers(db, task, [reader])
    return WorkTaskRead(
        task_id=task.task_id,
        workspace_id=task.workspace_id,
        created_by=task.created_by,
        assignee_user_id=task.assignee_user_id,
        assignee_display_name=assignee.display_name if assignee else None,
        title=task.title if source_text_is_visible else "Erişimi kısıtlı iş",
        description=task.description if source_text_is_visible else None,
        status=cast(TaskStatus, task.status),
        due_at=task.due_at,
        remind_at=task.remind_at,
        reminder_sent_at=task.reminder_sent_at,
        source_artifact_ids=visible_source_ids,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _validate_assignee(db: Session, workspace_id: str, user_id: str | None) -> User | None:
    if user_id is None:
        return None
    assignee = db.scalar(select(User).where(User.user_id == user_id, User.workspace_id == workspace_id, User.is_active.is_(True)))
    if assignee is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Atanan kullanıcı bulunamadı.")
    return assignee


def _artifact_snapshot(db: Session, actor: User, artifact_ids: list[str]) -> dict:
    unique_ids = list(dict.fromkeys(artifact_ids))
    artifacts = list(db.scalars(select(Artifact).where(Artifact.workspace_id == actor.workspace_id, Artifact.artifact_id.in_(unique_ids))).all()) if unique_ids else []
    by_id = {artifact.artifact_id: artifact for artifact in artifacts}
    if set(unique_ids) != set(by_id) or any(not artifact_is_visible_to_user(db, artifact, actor) for artifact in artifacts):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kaynak dosyalardan biri bulunamadı veya erişilemiyor.")
    return {artifact_id: {"title": by_id[artifact_id].title, "captured_at": datetime.utcnow().isoformat()} for artifact_id in unique_ids}


@router.get("/tasks", response_model=WorkTaskList)
def list_tasks(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> WorkTaskList:
    tasks = list(db.scalars(select(WorkTask).where(WorkTask.workspace_id == current_user.workspace_id).order_by(WorkTask.status.asc(), WorkTask.due_at.asc(), WorkTask.created_at.desc())).all())
    assignee_ids = {task.assignee_user_id for task in tasks if task.assignee_user_id}
    assignees = list(db.scalars(select(User).where(User.user_id.in_(assignee_ids))).all()) if assignee_ids else []
    by_id = {user.user_id: user for user in assignees}
    return WorkTaskList(items=[_task_read(db, current_user, task, by_id.get(task.assignee_user_id or "")) for task in tasks])


@router.post("/tasks", response_model=WorkTaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: WorkTaskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> WorkTaskRead:
    assignee = _validate_assignee(db, current_user.workspace_id, payload.assignee_user_id)
    snapshot = _artifact_snapshot(db, current_user, payload.source_artifact_ids)
    task = WorkTask(
        workspace_id=current_user.workspace_id,
        created_by=current_user.user_id,
        assignee_user_id=payload.assignee_user_id,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        status=payload.status,
        due_at=_utc_naive(payload.due_at),
        remind_at=_utc_naive(payload.remind_at),
        source_artifact_ids=list(snapshot),
        source_snapshot=snapshot,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    log_event(db, workspace_id=current_user.workspace_id, actor_user_id=current_user.user_id, event_type="WORK_TASK_CREATED", target_type="work_task", target_id=task.task_id, event_metadata={"assignee_user_id": task.assignee_user_id, "status": task.status})
    return _task_read(db, current_user, task, assignee)


@router.patch("/tasks/{task_id}", response_model=WorkTaskRead)
def update_task(task_id: str, payload: WorkTaskUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> WorkTaskRead:
    task = db.scalar(select(WorkTask).where(WorkTask.task_id == task_id, WorkTask.workspace_id == current_user.workspace_id))
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="İş bulunamadı.")
    fields = payload.model_fields_set
    if "title" in fields and payload.title is not None:
        task.title = payload.title.strip()
    if "description" in fields:
        task.description = payload.description.strip() if payload.description else None
    if payload.status is not None:
        task.status = payload.status
    if "assignee_user_id" in fields:
        _validate_assignee(db, current_user.workspace_id, payload.assignee_user_id)
        task.assignee_user_id = payload.assignee_user_id
    if "due_at" in fields:
        task.due_at = _utc_naive(payload.due_at)
    if "remind_at" in fields:
        task.remind_at = _utc_naive(payload.remind_at)
        task.reminder_sent_at = None
    if payload.source_artifact_ids is not None:
        snapshot = _artifact_snapshot(db, current_user, payload.source_artifact_ids)
        task.source_artifact_ids = list(snapshot)
        task.source_snapshot = snapshot
    db.commit()
    db.refresh(task)
    assignee = _validate_assignee(db, current_user.workspace_id, task.assignee_user_id)
    log_event(db, workspace_id=current_user.workspace_id, actor_user_id=current_user.user_id, event_type="WORK_TASK_UPDATED", target_type="work_task", target_id=task.task_id, event_metadata={"fields": sorted(fields)})
    return _task_read(db, current_user, task, assignee)


def _can_read_run(run: ColleagueRun, user: User) -> bool:
    return user.role == "Admin" or run.created_by == user.user_id or user.user_id in (run.participant_user_ids or [])


def _latest_reset_sequence(db: Session, run_id: str) -> int:
    return db.scalar(
        select(ColleagueRunEvent.sequence)
        .where(ColleagueRunEvent.run_id == run_id, ColleagueRunEvent.event_type == "reset")
        .order_by(ColleagueRunEvent.sequence.desc())
        .limit(1)
    ) or 0


def _run_read(db: Session, run: ColleagueRun, reader: User) -> ColleagueRunRead:
    reset_sequence = _latest_reset_sequence(db, run.run_id)
    stage_events = list(db.scalars(select(ColleagueRunEvent).where(ColleagueRunEvent.run_id == run.run_id, ColleagueRunEvent.event_type == "stage", ColleagueRunEvent.sequence >= reset_sequence).order_by(ColleagueRunEvent.sequence.asc())).all())
    source_ids = [str(source.get("artifact_id")) for source in (run.sources or []) if source.get("artifact_id")]
    visible_source_ids = set(_visible_source_ids(db, reader, source_ids))
    all_sources_visible = len(visible_source_ids) == len(set(source_ids))
    return ColleagueRunRead(
        run_id=run.run_id,
        kind=cast("Literal['ask', 'evening_review', 'artifact_review']", run.kind),
        thread_id=run.thread_id,
        thread_title=run.thread_title if all_sources_visible else "İzge ile çalışma",
        thread_kind=cast(ThreadKind, run.thread_kind),
        participant_user_ids=list(run.participant_user_ids or []),
        question=run.question if all_sources_visible or run.kind != "artifact_review" else "Yeni kayıt değerlendirildi.",
        status=cast(RunStatus, run.status),
        answer=run.answer if all_sources_visible else "Bu yanıtın dayandığı kaynaklara erişiminiz değiştiği için içerik gizlendi.",
        error=run.error,
        sources=[ColleagueSourceRead.model_validate(source) for source in (run.sources or []) if source.get("artifact_id") in visible_source_ids],
        follow_ups=list(run.follow_ups or []) if all_sources_visible else [],
        stages=[
            ColleagueStageRead(
                sequence=event.sequence,
                key=event.stage_key or "work",
                label=event.label or "İşleniyor",
                status=str((event.payload or {}).get("status") or "running"),
                created_at=event.created_at,
            )
            for event in stage_events
        ],
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


@router.post("/ask", response_model=ColleagueAskAccepted, status_code=status.HTTP_202_ACCEPTED)
def ask_colleague(payload: ColleagueAskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ColleagueAskAccepted:
    run = enqueue_colleague_question(
        db,
        actor=current_user,
        message=payload.message,
        client_request_id=payload.client_request_id,
        thread_id=payload.thread_id,
        thread_title=payload.thread_title,
        thread_kind=payload.thread_kind,
        participant_user_ids=payload.participant_user_ids,
        response_language=payload.response_language,
    )
    return ColleagueAskAccepted(run_id=run.run_id, thread_id=run.thread_id, status=cast(RunStatus, run.status))


@router.get("/runs", response_model=ColleagueRunList)
def list_runs(
    limit: int = Query(default=40, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    thread_id: str | None = Query(default=None, min_length=1, max_length=80),
) -> ColleagueRunList:
    query = select(ColleagueRun).where(ColleagueRun.workspace_id == current_user.workspace_id)
    if isinstance(thread_id, str):
        query = query.where(ColleagueRun.thread_id == thread_id)
    runs = list(db.scalars(query.order_by(ColleagueRun.created_at.desc())).all())
    visible_runs = [run for run in runs if _can_read_run(run, current_user)][:limit]
    return ColleagueRunList(items=[_run_read(db, run, current_user) for run in visible_runs])


@router.get("/runs/{run_id}", response_model=ColleagueRunRead)
def get_run(run_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ColleagueRunRead:
    run = db.scalar(select(ColleagueRun).where(ColleagueRun.run_id == run_id, ColleagueRun.workspace_id == current_user.workspace_id))
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Çalışma bulunamadı.")
    if not _can_read_run(run, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu çalışmaya erişemezsiniz.")
    return _run_read(db, run, current_user)


def _event_stream(run_id: str, start_sequence: int, reader_id: str) -> Iterator[str]:
    sequence = start_sequence
    idle_rounds = 0
    while idle_rounds < 600:
        with SessionLocal() as db:
            reset_sequence = _latest_reset_sequence(db, run_id)
            events = list(db.scalars(select(ColleagueRunEvent).where(ColleagueRunEvent.run_id == run_id, ColleagueRunEvent.sequence > max(sequence, reset_sequence - 1)).order_by(ColleagueRunEvent.sequence.asc())).all())
            run = db.get(ColleagueRun, run_id)
            reader = db.get(User, reader_id)
            if run is None or reader is None:
                return
            source_ids = [str(source.get("artifact_id")) for source in (run.sources or []) if source.get("artifact_id")]
            visible_source_ids = set(_visible_source_ids(db, reader, source_ids))
            if len(visible_source_ids) != len(set(source_ids)):
                return
            for event in events:
                if event.event_type == "source":
                    event_source = (event.payload or {}).get("source")
                    event_artifact_id = str(event_source.get("artifact_id")) if isinstance(event_source, dict) and event_source.get("artifact_id") else None
                    if event_artifact_id not in visible_source_ids:
                        return
                sequence = event.sequence
                data = {
                    "sequence": event.sequence,
                    "event_type": event.event_type,
                    "stage_key": event.stage_key,
                    "label": event.label,
                    "text": event.text,
                    **(event.payload or {}),
                }
                yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
            if run.status in TERMINAL_RUN_STATUSES and not events:
                return
        if events:
            idle_rounds = 0
        else:
            idle_rounds += 1
            if idle_rounds % 50 == 0:
                yield ": keep-alive\n\n"
        time.sleep(0.2)


@router.get("/runs/{run_id}/events")
def stream_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    run = db.scalar(select(ColleagueRun).where(ColleagueRun.run_id == run_id, ColleagueRun.workspace_id == current_user.workspace_id))
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Çalışma bulunamadı.")
    if not _can_read_run(run, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu çalışmaya erişemezsiniz.")
    source_ids = [str(source.get("artifact_id")) for source in (run.sources or []) if source.get("artifact_id")]
    if len(_visible_source_ids(db, current_user, source_ids)) != len(set(source_ids)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Çalışmanın kaynak erişimleri değişti.")
    start = after_sequence
    if last_event_id and last_event_id.isdigit():
        start = max(start, int(last_event_id))
    return StreamingResponse(_event_stream(run_id, start, current_user.user_id), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/review", response_model=ColleagueReviewAccepted, status_code=status.HTTP_202_ACCEPTED)
def request_review(
    accept_language: str | None = Header(default=None, alias="Accept-Language"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ColleagueReviewAccepted:
    run = enqueue_manual_review(db, current_user, response_language=_response_language_from_header(accept_language))
    return ColleagueReviewAccepted(run_id=run.run_id, status=cast(RunStatus, run.status))
