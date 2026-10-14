from __future__ import annotations

import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Literal, cast

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.dependencies import get_current_user
from app.models import Artifact, AssistantConversation, ColleagueRun, ColleagueRunEvent, User, WorkTask
from app.routers.team_chat import _clean_thread_id as clean_team_chat_thread_id, _validated_reply_target, attach_team_chat_file
from app.schemas.api import TeamChatMessageRead
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
    AssistantConversationCreate,
    AssistantConversationList,
    AssistantConversationRead,
    AssistantConversationUpdate,
)
from app.services.audit import log_event
from app.services.colleague import AGENT_EMAIL, TERMINAL_RUN_STATUSES, enqueue_colleague_question, enqueue_manual_review, task_sources_visible_to_readers
from app.services.security import consume_public_demo_quota
from app.services.permissions import artifact_is_visible_to_user
from app.services.agent_sources import visible_sources
from app.services.agent_model import model_catalog
from app.services.agent_tools import available_mcp_tools
from app.config import get_settings
from app.services.conversations import DEFAULT_ASSISTANT_THREAD_ID, archive_conversation, conversation_for_thread, empty_active_conversation, ensure_personal_conversation, get_owned_conversation


router = APIRouter(prefix="/work", tags=["work"])


def _conversation_read(conversation: AssistantConversation) -> AssistantConversationRead:
    return AssistantConversationRead(
        conversation_id=conversation.conversation_id,
        thread_id=conversation.thread_id,
        title=conversation.title,
        archived_at=conversation.archived_at,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def _reject_active_conversation_run(db: Session, conversation: AssistantConversation) -> None:
    active_run = db.scalar(select(ColleagueRun.run_id).where(
        ColleagueRun.workspace_id == conversation.workspace_id,
        ColleagueRun.created_by == conversation.owner_user_id,
        ColleagueRun.thread_id == conversation.thread_id,
        ColleagueRun.status.in_(["queued", "running"]),
    ).limit(1))
    if active_run:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Etkin çalışma tamamlanmadan konuşma gizlenemez.")


@router.get("/conversations", response_model=AssistantConversationList)
def list_conversations(
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantConversationList:
    legacy_runs = list(db.scalars(select(ColleagueRun).where(
        ColleagueRun.workspace_id == current_user.workspace_id,
        ColleagueRun.created_by == current_user.user_id,
        ColleagueRun.thread_kind == "direct",
    ).order_by(ColleagueRun.created_at.asc())).all())
    agent_user_id = db.scalar(select(User.user_id).where(
        User.workspace_id == current_user.workspace_id,
        User.email == AGENT_EMAIL,
    ))
    for run in legacy_runs:
        participants = set(run.participant_user_ids or [])
        if participants <= {current_user.user_id, agent_user_id} and conversation_for_thread(db, current_user, run.thread_id) is None:
            ensure_personal_conversation(db, current_user, thread_id=run.thread_id, title=run.thread_title or run.question[:120])
    if conversation_for_thread(db, current_user, DEFAULT_ASSISTANT_THREAD_ID) is None:
        ensure_personal_conversation(
            db,
            current_user,
            thread_id=DEFAULT_ASSISTANT_THREAD_ID,
            title=None,
        )
    db.commit()
    query = select(AssistantConversation).where(
        AssistantConversation.workspace_id == current_user.workspace_id,
        AssistantConversation.owner_user_id == current_user.user_id,
        AssistantConversation.deleted_at.is_(None),
    )
    if not include_archived:
        query = query.where(AssistantConversation.archived_at.is_(None))
    conversations = list(db.scalars(query).all())
    latest_activity = dict(db.execute(
        select(ColleagueRun.thread_id, func.max(ColleagueRun.updated_at))
        .where(
            ColleagueRun.workspace_id == current_user.workspace_id,
            ColleagueRun.created_by == current_user.user_id,
            ColleagueRun.thread_id.in_([item.thread_id for item in conversations]),
        )
        .group_by(ColleagueRun.thread_id)
    ).all()) if conversations else {}
    conversations.sort(key=lambda item: latest_activity.get(item.thread_id) or item.updated_at, reverse=True)
    return AssistantConversationList(items=[_conversation_read(item) for item in conversations])


@router.post("/conversations", response_model=AssistantConversationRead, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: AssistantConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantConversationRead:
    # Serialize creation per user so two tabs reuse the same empty draft.
    db.execute(update(User).where(User.user_id == current_user.user_id).values(updated_at=User.updated_at))
    existing = empty_active_conversation(db, current_user)
    if existing is not None:
        return _conversation_read(existing)
    conversation = AssistantConversation(
        workspace_id=current_user.workspace_id,
        owner_user_id=current_user.user_id,
        thread_id="pending",
        title=payload.title.strip(),
    )
    db.add(conversation)
    db.flush()
    conversation.thread_id = f"assistant-cowork:{conversation.conversation_id}"
    db.commit()
    db.refresh(conversation)
    return _conversation_read(conversation)


@router.get("/conversations/{conversation_id}", response_model=AssistantConversationRead)
def get_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantConversationRead:
    return _conversation_read(get_owned_conversation(db, current_user, conversation_id))


@router.patch("/conversations/{conversation_id}", response_model=AssistantConversationRead)
def update_conversation(
    conversation_id: str,
    payload: AssistantConversationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AssistantConversationRead:
    conversation = get_owned_conversation(db, current_user, conversation_id)
    if payload.archived is not None and payload.archived != (conversation.archived_at is not None):
        _reject_active_conversation_run(db, conversation)
        archive_conversation(conversation, payload.archived)
    if payload.title is not None:
        conversation.title = payload.title.strip()
    db.commit()
    db.refresh(conversation)
    return _conversation_read(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    conversation = get_owned_conversation(db, current_user, conversation_id)
    _reject_active_conversation_run(db, conversation)
    conversation.deleted_at = datetime.utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/conversations/{conversation_id}/attachments", response_model=TeamChatMessageRead, status_code=status.HTTP_201_CREATED)
async def attach_conversation_file(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TeamChatMessageRead:
    conversation = get_owned_conversation(db, current_user, conversation_id)
    if conversation.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Arşivlenmiş konuşmaya dosya eklenemez.")
    return await attach_team_chat_file(
        file=file,
        thread_id=conversation.thread_id,
        thread_title=conversation.title,
        thread_kind="direct",
        participant_user_ids=json.dumps([current_user.user_id]),
        current_user=current_user,
        db=db,
    )


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


def _can_read_run(db: Session, run: ColleagueRun, user: User) -> bool:
    conversation = db.scalar(select(AssistantConversation).where(
        AssistantConversation.workspace_id == run.workspace_id,
        AssistantConversation.owner_user_id == run.created_by,
        AssistantConversation.thread_id == run.thread_id,
    ))
    if conversation is not None:
        return conversation.owner_user_id == user.user_id and conversation.deleted_at is None
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
    readable_sources = visible_sources(db, reader, run.sources or [])
    all_sources_visible = len(readable_sources) == len(run.sources or [])
    latest_stages = {}
    for event in stage_events:
        latest_stages[event.stage_key or "work"] = event
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
        error=run.error if all_sources_visible else None,
        sources=[ColleagueSourceRead.model_validate(source) for source in readable_sources],
        follow_ups=list(run.follow_ups or []) if all_sources_visible else [],
        stages=[
            ColleagueStageRead(
                summary=str((event.payload or {}).get("summary"))[:220] if (event.payload or {}).get("summary") else None,
                sequence=event.sequence,
                key=event.stage_key or "work",
                label=event.label or "İşleniyor",
                status=str((event.payload or {}).get("status") or "running"),
                created_at=event.created_at,
            )
            for event in latest_stages.values() if all_sources_visible
        ],
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


@router.get("/models")
def get_agent_models(accept_language: str | None = Header(default=None, alias="Accept-Language"), current_user: User = Depends(get_current_user)) -> dict:
    catalog = model_catalog()
    if _response_language_from_header(accept_language) == "en":
        reasons = {"ollama": "Local model is disabled.", "onprem": "Company model server is not configured.", "glm": "GLM API key is missing.", "deepseek": "DeepSeek API key is missing.", "codex": "Local Codex bridge is not configured."}
        for profile in catalog["profiles"]:
            if profile.get("reason"):
                profile["reason"] = reasons[profile["id"]]
            if profile["id"] == "ollama":
                profile["label"] = f"Local model · {profile['model']}"
            elif profile["id"] == "onprem":
                profile["label"] = f"Company model · {profile['model'] or 'not configured'}"
            elif profile["id"] == "codex":
                profile["label"] = "GPT-6 Luna · Codex session"
    catalog["tools"] = {"web_search": bool(get_settings().agent_web_search_key.get_secret_value()), "mcp": bool(available_mcp_tools(current_user.workspace_id, [current_user.user_id])), "reviewer": True}
    if current_user.is_public_demo:
        catalog["tools"] = {"web_search": False, "mcp": False, "reviewer": False}
        for profile in catalog["profiles"]:
            profile["native_web_search"] = False
    return catalog


@router.post("/ask", response_model=ColleagueAskAccepted, status_code=status.HTTP_202_ACCEPTED)
def ask_colleague(payload: ColleagueAskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ColleagueAskAccepted:
    if current_user.is_public_demo:
        conversation = conversation_for_thread(db, current_user, payload.thread_id)
        if (
            conversation is None
            or conversation.archived_at is not None
            or conversation.deleted_at is not None
            or payload.thread_kind != "direct"
            or set(payload.participant_user_ids) - {current_user.user_id}
            or payload.allow_external_tools
            or payload.request_reviewer
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Genel demo yalnızca kişisel İzge konuşmasını kullanabilir.")
    options = {key: value for key, value in payload.model_dump(include={"model_profile", "reasoning_effort", "allow_external_tools", "request_reviewer"}).items() if value is not None and value is not False}
    if payload.model_profile or payload.reasoning_effort:
        catalog = model_catalog()
        profile = next(item for item in catalog["profiles"] if item["id"] == (payload.model_profile or catalog["default_profile"]))
        if not profile["enabled"]:
            raise HTTPException(status_code=503, detail=profile["reason"] or "Model yapılandırılmadı.")
        if payload.reasoning_effort and payload.reasoning_effort not in profile["supported_efforts"]:
            raise HTTPException(status_code=422, detail="Bu model seçilen düşünme düzeyini desteklemiyor.")
    if current_user.is_public_demo:
        consume_public_demo_quota(ip_hash=current_user.public_demo_ip_hash or "")
    reply_target = _validated_reply_target(
        db,
        current_user=current_user,
        thread_id=clean_team_chat_thread_id(payload.thread_id),
        reply_to_message_id=payload.reply_to_message_id,
    )
    run = enqueue_colleague_question(
        db,
        actor=current_user,
        message=payload.message,
        client_request_id=payload.client_request_id,
        thread_id=payload.thread_id,
        thread_title=payload.thread_title,
        thread_kind=payload.thread_kind,
        participant_user_ids=payload.participant_user_ids,
        reply_to_message_id=reply_target.message_id if reply_target else None,
        response_language=payload.response_language,
        agent_options=options,
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
    visible_runs = [run for run in runs if _can_read_run(db, run, current_user)][:limit]
    return ColleagueRunList(items=[_run_read(db, run, current_user) for run in visible_runs])


@router.get("/runs/{run_id}", response_model=ColleagueRunRead)
def get_run(run_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ColleagueRunRead:
    run = db.scalar(select(ColleagueRun).where(ColleagueRun.run_id == run_id, ColleagueRun.workspace_id == current_user.workspace_id))
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Çalışma bulunamadı.")
    if not _can_read_run(db, run, current_user):
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
            if reader.workspace_id != run.workspace_id or not reader.is_active or not _can_read_run(db, run, reader):
                return
            readable = visible_sources(db, reader, run.sources or [])
            if len(readable) != len(run.sources or []):
                return
            for event in events:
                if event.event_type == "source":
                    event_source = (event.payload or {}).get("source")
                    if not isinstance(event_source, dict) or not visible_sources(db, reader, [event_source]):
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
    if not _can_read_run(db, run, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu çalışmaya erişemezsiniz.")
    if len(visible_sources(db, current_user, run.sources or [])) != len(run.sources or []):
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
