from __future__ import annotations

import json
import queue
import sys
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import event, select
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import ColleagueRun, ColleagueRunEvent, User
from app.routers.team_chat import _message_read_model
from app.routers.work import _run_read
from app.schemas.api import TeamChatMessageRead
from app.schemas.work import ColleagueAskCreate, ColleagueRunRead, WorkTaskCreate
from app.services.agent_model import model_catalog
from app.services.colleague import process_colleague_run
from app.services.demo import demo_thread_messages, extract_demo_upload, isolated_demo_session, prepare_demo_question, run_demo_question
from app.services.security import consume_public_demo_quota


router = APIRouter(prefix="/demo", tags=["demo"])


class DemoHistoryTurn(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    answer: str = Field(min_length=1, max_length=8000)


class DemoLocalSource(BaseModel):
    artifact_id: str | None = Field(default=None, max_length=120)
    title: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=50_000)


class DemoLocalTask(WorkTaskCreate):
    task_id: str = Field(min_length=1, max_length=64)


class DemoAskCreate(ColleagueAskCreate):
    history: list[DemoHistoryTurn] = Field(default_factory=list, max_length=3)
    local_sources: list[DemoLocalSource] = Field(default_factory=list, max_length=4)
    local_tasks: list[DemoLocalTask] = Field(default_factory=list, max_length=50)
    conversation_context: str | None = Field(default=None, max_length=8000)

    @model_validator(mode="after")
    def bound_local_context(self) -> "DemoAskCreate":
        if sum(len(source.text) for source in self.local_sources) > 100_000:
            raise ValueError("Yerel kaynak metni toplam 100000 karakteri aşamaz.")
        client_source_ids = [source.artifact_id for source in self.local_sources if source.artifact_id]
        if len(client_source_ids) != len(set(client_source_ids)):
            raise ValueError("Yerel kaynak kimlikleri benzersiz olmalıdır.")
        task_ids = [task.task_id for task in self.local_tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("Yerel iş kimlikleri benzersiz olmalıdır.")
        return self


class DemoAskRead(BaseModel):
    run: ColleagueRunRead
    messages: list[TeamChatMessageRead]


class DemoExtractRead(BaseModel):
    text: str


def _require_public_demo(user: User) -> None:
    if not user.is_public_demo:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu uç nokta yalnızca genel demo içindir.")


def _validate_model_options(payload: DemoAskCreate) -> None:
    if payload.allow_external_tools or payload.request_reviewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Genel demo harici araç veya denetçi kullanamaz.")
    if not payload.model_profile and not payload.reasoning_effort:
        return
    catalog = model_catalog()
    profile = next(item for item in catalog["profiles"] if item["id"] == (payload.model_profile or catalog["default_profile"]))
    if not profile["enabled"]:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=profile["reason"] or "Model yapılandırılmadı.")
    if payload.reasoning_effort and payload.reasoning_effort not in profile["supported_efforts"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bu model seçilen düşünme düzeyini desteklemiyor.")


@router.post("/ask", response_model=DemoAskRead)
def ask_demo(
    payload: DemoAskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DemoAskRead:
    _require_public_demo(current_user)
    _validate_model_options(payload)
    with isolated_demo_session(db) as demo_db:
        consume_public_demo_quota(ip_hash=current_user.public_demo_ip_hash or "")
        actor = demo_db.get(User, current_user.user_id)
        if actor is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Demo oturumu bulunamadı.")
        run, source_id_map = run_demo_question(
            demo_db,
            actor=actor,
            message=payload.message,
            client_request_id=payload.client_request_id,
            response_language=payload.response_language,
            model_profile=payload.model_profile,
            reasoning_effort=payload.reasoning_effort,
            history=[item.model_dump() for item in payload.history],
            local_sources=[item.model_dump() for item in payload.local_sources],
            local_tasks=[item.model_dump() for item in payload.local_tasks],
            conversation_context=payload.conversation_context,
        )
        message_rows = demo_thread_messages(demo_db, actor=actor, thread_id=run.thread_id)
        author_ids = {row.author_user_id for row in message_rows}
        author_by_id = {
            user.user_id: user
            for user in demo_db.scalars(select(User).where(User.user_id.in_(author_ids))).all()
        }
        run_read = _run_read(demo_db, run, actor)
        messages = [_message_read_model(row, author_by_id, demo_db, actor) for row in message_rows]
        for source in run_read.sources:
            source.artifact_id = source_id_map.get(source.artifact_id, source.artifact_id)
        for message in messages:
            source_refs = message.message_metadata.get("source_refs")
            if isinstance(source_refs, list):
                for source in source_refs:
                    if isinstance(source, dict) and isinstance(source.get("artifact_id"), str):
                        source["artifact_id"] = source_id_map.get(source["artifact_id"], source["artifact_id"])
        return DemoAskRead(run=run_read, messages=messages)


def _sse(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _demo_event_stream(
    demo_db: Session,
    actor: User,
    run: ColleagueRun,
    source_id_map: dict[str, str],
    lease_owner: str,
    close_session,
) -> Iterator[str]:
    events: queue.Queue[tuple[str, object]] = queue.Queue()

    def collect(session: Session, _flush_context) -> None:
        for item in session.new:
            if not isinstance(item, ColleagueRunEvent) or item.run_id != run.run_id:
                continue
            payload = dict(item.payload or {})
            source = payload.get("source")
            if isinstance(source, dict) and isinstance(source.get("artifact_id"), str):
                payload["source"] = {**source, "artifact_id": source_id_map.get(source["artifact_id"], source["artifact_id"])}
            events.put((item.event_type, {
                "sequence": item.sequence,
                "event_type": item.event_type,
                "stage_key": item.stage_key,
                "label": item.label,
                "text": item.text,
                **payload,
            }))

    def work() -> None:
        try:
            events.put(("accepted", {"run_id": run.run_id, "status": run.status}))
            events.put(("result", process_colleague_run(demo_db, run, lease_owner=lease_owner)))
        except Exception as exc:
            events.put(("stream_error", exc))

    event.listen(demo_db, "after_flush", collect)
    worker = threading.Thread(target=work, name=f"demo-run-{run.run_id}", daemon=True)
    worker.start()
    try:
        while True:
            event_type, data = events.get()
            if event_type == "stream_error":
                yield _sse("failed", {"status": "failed", "text": "İzge bu çalışmayı tamamlayamadı."})
                return
            if event_type == "result":
                finished = data
                assert isinstance(finished, ColleagueRun)
                run_read = _run_read(demo_db, finished, actor)
                for source in run_read.sources:
                    source.artifact_id = source_id_map.get(source.artifact_id, source.artifact_id)
                yield _sse("result", {"run": run_read.model_dump(mode="json")})
                return
            assert isinstance(data, dict)
            yield _sse(event_type, data)
    finally:
        worker.join()
        event.remove(demo_db, "after_flush", collect)
        close_session()


@router.post("/ask/events")
def stream_demo_answer(
    payload: DemoAskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    _require_public_demo(current_user)
    _validate_model_options(payload)
    consume_public_demo_quota(ip_hash=current_user.public_demo_ip_hash or "")
    isolated = isolated_demo_session(db)
    demo_db = isolated.__enter__()
    try:
        actor = demo_db.get(User, current_user.user_id)
        if actor is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Demo oturumu bulunamadı.")
        run, source_id_map, lease_owner = prepare_demo_question(
            demo_db,
            actor=actor,
            message=payload.message,
            client_request_id=payload.client_request_id,
            response_language=payload.response_language,
            model_profile=payload.model_profile,
            reasoning_effort=payload.reasoning_effort,
            history=[item.model_dump() for item in payload.history],
            local_sources=[item.model_dump() for item in payload.local_sources],
            local_tasks=[item.model_dump() for item in payload.local_tasks],
            conversation_context=payload.conversation_context,
        )
    except Exception:
        isolated.__exit__(*sys.exc_info())
        raise
    stream = _demo_event_stream(demo_db, actor, run, source_id_map, lease_owner, lambda: isolated.__exit__(None, None, None))
    return StreamingResponse(stream, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/extract", response_model=DemoExtractRead)
async def extract_demo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> DemoExtractRead:
    _require_public_demo(current_user)
    consume_public_demo_quota(ip_hash=f"extract:{current_user.public_demo_ip_hash or ''}", limit=10)
    return DemoExtractRead(text=await extract_demo_upload(file))
