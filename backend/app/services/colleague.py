from __future__ import annotations

import http.client
import json
import logging
import re
import secrets
import socket
from datetime import UTC, datetime, timedelta
from typing import Any, Iterator, cast
from urllib import parse

from fastapi import HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Artifact, ArtifactChunk, ColleagueRun, ColleagueRunEvent, CompanyChatMessage, Signal, User, WorkTask, Workspace
from app.services.llm import LocalLLMError, validated_local_llm_base_url
from app.services.notifications import create_notification, notify_team_chat_recipients
from app.services.permissions import artifact_is_visible_to_user, signal_is_visible_to_artifact_ids
from app.services.security import hash_password


AGENT_EMAIL = "izge-agent@local.invalid"
AGENT_NAME = "İzge"
TERMINAL_RUN_STATUSES = {"completed", "failed"}
_TURKISH_STOPWORDS = {
    "acaba", "ama", "ancak", "bana", "ben", "beni", "bir", "biz", "bu", "da", "daha", "de", "diye",
    "en", "gibi", "ile", "icin", "için", "mi", "mu", "mı", "mü", "ne", "neden", "nasil", "nasıl", "o",
    "olan", "olarak", "ve", "veya", "ya", "şu", "kim", "hangi", "hakkinda", "hakkında",
}


class LostColleagueLeaseError(RuntimeError):
    pass


def utcnow() -> datetime:
    return datetime.utcnow()


def ensure_colleague_user(db: Session, workspace_id: str) -> User:
    agent = db.scalar(select(User).where(User.email == AGENT_EMAIL))
    if agent is not None:
        if agent.workspace_id != workspace_id:
            raise RuntimeError("Reserved colleague user belongs to another workspace")
        if not agent.is_active:
            agent.is_active = True
            db.commit()
        return agent
    agent = User(
        workspace_id=workspace_id,
        role="Member",
        display_name=AGENT_NAME,
        email=AGENT_EMAIL,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        is_active=True,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


def _clean_thread_id(value: str | None, user_id: str) -> str:
    raw = (value or f"izge-colleague:{user_id}").strip().lower()
    cleaned = "".join(character for character in raw if character.isalnum() or character in {"-", "_", ":"})
    return (cleaned or f"izge-colleague:{user_id}")[:80]


def _clean_thread_title(value: str | None) -> str:
    return ((value or "İzge ile çalışma").strip() or "İzge ile çalışma")[:120]


def _workspace_users(db: Session, workspace_id: str, user_ids: set[str]) -> list[User]:
    if not user_ids:
        return []
    return list(db.scalars(select(User).where(User.workspace_id == workspace_id, User.user_id.in_(user_ids), User.is_active.is_(True))).all())


def normalize_participants(db: Session, actor: User, requested_user_ids: list[str], agent: User) -> list[str]:
    requested = {actor.user_id, agent.user_id, *requested_user_ids}
    users = _workspace_users(db, actor.workspace_id, requested)
    valid_ids = {user.user_id for user in users}
    invalid_ids = requested - valid_ids
    if invalid_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Konuşma katılımcılarından biri bulunamadı.")
    return sorted(valid_ids)


def enqueue_colleague_question(
    db: Session,
    *,
    actor: User,
    message: str,
    client_request_id: str,
    thread_id: str | None,
    thread_title: str | None,
    thread_kind: str,
    participant_user_ids: list[str],
) -> ColleagueRun:
    existing = db.scalar(
        select(ColleagueRun).where(
            ColleagueRun.workspace_id == actor.workspace_id,
            ColleagueRun.client_request_id == client_request_id,
        )
    )
    if existing is not None:
        requested_thread_id = _clean_thread_id(thread_id, actor.user_id)
        if (
            existing.created_by != actor.user_id
            or existing.question != " ".join(message.strip().split())
            or existing.thread_id != requested_thread_id
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu istek kimliği başka bir mesaj için kullanılmış.")
        return existing

    question = " ".join(message.strip().split())
    if not question:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mesaj boş olamaz.")
    agent = ensure_colleague_user(db, actor.workspace_id)
    participants = normalize_participants(db, actor, participant_user_ids, agent)
    cleaned_thread_id = _clean_thread_id(thread_id, actor.user_id)
    cleaned_title = _clean_thread_title(thread_title)
    run = ColleagueRun(
        workspace_id=actor.workspace_id,
        created_by=actor.user_id,
        kind="ask",
        client_request_id=client_request_id,
        thread_id=cleaned_thread_id,
        thread_title=cleaned_title,
        thread_kind=thread_kind,
        participant_user_ids=participants,
        question=question,
    )
    db.add(run)
    try:
        db.flush()
        user_message = CompanyChatMessage(
            workspace_id=actor.workspace_id,
            author_user_id=actor.user_id,
            body=question,
            message_metadata={
                "channel": cleaned_thread_id,
                "thread_id": cleaned_thread_id,
                "thread_title": cleaned_title,
                "thread_kind": thread_kind,
                "participant_user_ids": participants,
                "source": "izge-colleague",
                "colleague_run_id": run.run_id,
                "client_request_id": client_request_id,
            },
        )
        db.add(user_message)
        db.flush()
        notify_team_chat_recipients(
            db, author=actor, message_id=user_message.message_id, body=question,
            thread_id=cleaned_thread_id, thread_title=cleaned_title,
            participant_user_ids=set(participants),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(ColleagueRun).where(
                ColleagueRun.workspace_id == actor.workspace_id,
                ColleagueRun.client_request_id == client_request_id,
            )
        )
        if existing is None:
            raise
        if existing.created_by != actor.user_id or existing.question != question or existing.thread_id != cleaned_thread_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu istek kimliği başka bir mesaj için kullanılmış.")
        return existing
    db.refresh(run)
    return run


def enqueue_artifact_review(db: Session, *, artifact: Artifact, actor: User) -> ColleagueRun:
    existing = db.scalar(
        select(ColleagueRun).where(
            ColleagueRun.workspace_id == actor.workspace_id,
            ColleagueRun.idempotency_key == f"artifact-review:{artifact.artifact_id}",
        )
    )
    if existing is not None:
        return existing
    if artifact.workspace_id != actor.workspace_id or not artifact_is_visible_to_user(db, artifact, actor):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak bulunamadı.")
    agent = ensure_colleague_user(db, actor.workspace_id)
    run = ColleagueRun(
        workspace_id=actor.workspace_id,
        created_by=actor.user_id,
        kind="artifact_review",
        idempotency_key=f"artifact-review:{artifact.artifact_id}",
        thread_id=f"assistant-cowork:artifact:{artifact.artifact_id}",
        thread_title=f"İzge · {artifact.title}"[:120],
        thread_kind="direct",
        participant_user_ids=sorted({actor.user_id, agent.user_id}),
        question=(
            f"Yeni eklenen ‘{artifact.title}’ kaydının getirdiği bilgiyi mevcut şirket hafızasıyla karşılaştır. "
            "Bu yeni kayıtla doğrudan bağlantılı bir çelişki, unutulmuş müşteri talebi, faturalandırılmamış iş, müşteri kaybı riski, "
            "eksik teklif şartı, tekrarlayan sorun veya ekipler arası bekleyen iş var mı? "
            "Yalnız yeni kayıttan doğan somut ve kaynaklı bir durum kullanıcıya bildirmeye değerse bildirim öner. "
            "Yeni kayıtla ilgisiz eski riskleri tekrar bildirme."
        ),
        context_artifact_ids=[artifact.artifact_id],
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(ColleagueRun).where(
                ColleagueRun.workspace_id == actor.workspace_id,
                ColleagueRun.idempotency_key == f"artifact-review:{artifact.artifact_id}",
            )
        )
        if existing is None:
            raise
        return existing
    db.refresh(run)
    return run


def enqueue_manual_review(db: Session, actor: User) -> ColleagueRun:
    agent = ensure_colleague_user(db, actor.workspace_id)
    users = list(db.scalars(select(User).where(User.workspace_id == actor.workspace_id, User.is_active.is_(True))).all())
    return _enqueue_review(
        db,
        workspace_id=actor.workspace_id,
        created_by=actor.user_id,
        participant_user_ids=[user.user_id for user in users],
        idempotency_key=f"manual-review:{secrets.token_hex(8)}",
        agent=agent,
    )


def enqueue_due_evening_reviews(db: Session, now: datetime) -> int:
    from zoneinfo import ZoneInfo

    local_now = now.astimezone(ZoneInfo("Europe/Istanbul")) if now.tzinfo else now.replace(tzinfo=UTC).astimezone(ZoneInfo("Europe/Istanbul"))
    if local_now.hour < 17:
        return 0
    queued = 0
    for workspace in db.scalars(select(Workspace)).all():
        key = f"evening-review:{local_now.date().isoformat()}"
        if db.scalar(select(ColleagueRun).where(ColleagueRun.workspace_id == workspace.workspace_id, ColleagueRun.idempotency_key == key)):
            continue
        agent = ensure_colleague_user(db, workspace.workspace_id)
        users = list(db.scalars(select(User).where(User.workspace_id == workspace.workspace_id, User.is_active.is_(True))).all())
        try:
            _enqueue_review(
                db,
                workspace_id=workspace.workspace_id,
                created_by=agent.user_id,
                participant_user_ids=[user.user_id for user in users],
                idempotency_key=key,
                agent=agent,
            )
            queued += 1
        except IntegrityError:
            db.rollback()
    return queued


def _enqueue_review(
    db: Session,
    *,
    workspace_id: str,
    created_by: str,
    participant_user_ids: list[str],
    idempotency_key: str,
    agent: User,
) -> ColleagueRun:
    run = ColleagueRun(
        workspace_id=workspace_id,
        created_by=created_by,
        kind="evening_review",
        idempotency_key=idempotency_key,
        thread_id="company-general",
        thread_title="Şirket Geneli",
        thread_kind="channel",
        participant_user_ids=sorted(set(participant_user_ids + [agent.user_id])),
        question=(
            "Bugün eklenen şirket kayıtlarını ve açık işleri gözden geçir. Değişmiş veya riskli varsayımları, "
            "takip gerektiren işleri ve yarın için en yararlı üç öneriyi kaynaklara dayanarak Türkçe özetle."
        ),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _claimable_run_predicate(now: datetime):
    return or_(
        ColleagueRun.status == "queued",
        (ColleagueRun.status == "running")
        & ColleagueRun.lease_expires_at.is_not(None)
        & (ColleagueRun.lease_expires_at <= now),
    )


def claim_next_colleague_run(db: Session, *, worker_id: str, lease_seconds: int = 900) -> ColleagueRun | None:
    now = utcnow()
    for _attempt in range(3):
        candidate = db.scalar(
            select(ColleagueRun)
            .where(_claimable_run_predicate(now))
            .order_by(ColleagueRun.created_at.asc())
            .limit(1)
        )
        if candidate is None:
            return None
        reclaimed = candidate.status == "running"
        claimed_at = candidate.started_at or now
        lease_owner = f"{worker_id}:{secrets.token_hex(8)}"
        result = cast(CursorResult[Any], db.execute(
            update(ColleagueRun)
            .where(ColleagueRun.run_id == candidate.run_id, _claimable_run_predicate(now))
            .values(
                status="running",
                lease_owner=lease_owner,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                started_at=claimed_at,
                error=None,
                answer=None,
                sources=[],
                follow_ups=[],
            )
            .execution_options(synchronize_session=False)
        ))
        if result.rowcount != 1:
            db.rollback()
            continue
        db.commit()
        run = db.get(ColleagueRun, candidate.run_id, populate_existing=True)
        if run is None:
            return None
        if reclaimed:
            add_run_event(db, run, "reset", stage_key="retry", label="Çalışma güvenli biçimde yeniden başlatıldı", payload={"status": "running"}, lease_owner=lease_owner)
        return run
    return None


def _next_event_sequence(db: Session, run_id: str) -> int:
    latest = db.scalar(select(ColleagueRunEvent.sequence).where(ColleagueRunEvent.run_id == run_id).order_by(ColleagueRunEvent.sequence.desc()).limit(1))
    return (latest or 0) + 1


def add_run_event(
    db: Session,
    run: ColleagueRun,
    event_type: str,
    *,
    stage_key: str | None = None,
    label: str | None = None,
    text: str | None = None,
    payload: dict | None = None,
    lease_owner: str | None = None,
) -> ColleagueRunEvent:
    expected_owner = lease_owner or run.lease_owner
    if not expected_owner:
        raise LostColleagueLeaseError("Çalışma kiralaması bulunamadı.")
    now = utcnow()
    heartbeat = cast(CursorResult[Any], db.execute(
        update(ColleagueRun)
        .where(
            ColleagueRun.run_id == run.run_id,
            ColleagueRun.status == "running",
            ColleagueRun.lease_owner == expected_owner,
            ColleagueRun.lease_expires_at.is_not(None),
            ColleagueRun.lease_expires_at > now,
        )
        .values(lease_expires_at=now + timedelta(seconds=900))
        .execution_options(synchronize_session=False)
    ))
    if heartbeat.rowcount != 1:
        db.rollback()
        raise LostColleagueLeaseError("Çalışma kiralaması başka bir işlemciye geçti.")
    event = ColleagueRunEvent(
        run_id=run.run_id,
        sequence=_next_event_sequence(db, run.run_id),
        event_type=event_type,
        stage_key=stage_key,
        label=label,
        text=text,
        payload=payload or {},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    db.refresh(run)
    return event


def _terms(value: str) -> set[str]:
    tokens = re.findall(r"[^\W_]+", value.casefold(), flags=re.UNICODE)
    return {token for token in tokens if len(token) > 2 and token not in _TURKISH_STOPWORDS}


def _artifact_visible_to_everyone(db: Session, artifact: Artifact, readers: list[User]) -> bool:
    return all(artifact_is_visible_to_user(db, artifact, reader) for reader in readers)


def task_sources_visible_to_readers(db: Session, task: WorkTask, readers: list[User]) -> bool:
    source_ids = set(task.source_artifact_ids or [])
    if not source_ids:
        return True
    artifacts = db.scalars(
        select(Artifact).where(Artifact.workspace_id == task.workspace_id, Artifact.artifact_id.in_(source_ids))
    ).all()
    return {artifact.artifact_id for artifact in artifacts} == source_ids and all(
        _artifact_visible_to_everyone(db, artifact, readers) for artifact in artifacts
    )


def _run_readers(db: Session, run: ColleagueRun) -> list[User]:
    agent = ensure_colleague_user(db, run.workspace_id)
    reader_ids = {user_id for user_id in run.participant_user_ids if user_id != agent.user_id}
    readers = _workspace_users(db, run.workspace_id, reader_ids)
    if not readers:
        creator = db.scalar(select(User).where(User.user_id == run.created_by, User.workspace_id == run.workspace_id))
        readers = [creator] if creator is not None else []
    return readers


def _recent_thread_context(db: Session, run: ColleagueRun, *, limit: int = 3) -> list[dict]:
    if run.kind != "ask":
        return []
    readers = _run_readers(db, run)
    candidates = list(db.scalars(
        select(ColleagueRun)
        .where(
            ColleagueRun.workspace_id == run.workspace_id,
            ColleagueRun.thread_id == run.thread_id,
            ColleagueRun.run_id != run.run_id,
            ColleagueRun.status == "completed",
            ColleagueRun.answer.is_not(None),
        )
        .order_by(ColleagueRun.created_at.desc())
        .limit(limit * 4)
    ).all())
    safe: list[dict] = []
    for previous in candidates:
        participants = set(previous.participant_user_ids or [])
        if any(reader.role != "Admin" and reader.user_id != previous.created_by and reader.user_id not in participants for reader in readers):
            continue
        source_ids = {str(source.get("artifact_id")) for source in (previous.sources or []) if source.get("artifact_id")}
        artifacts = list(db.scalars(select(Artifact).where(
            Artifact.workspace_id == run.workspace_id,
            Artifact.artifact_id.in_(source_ids),
        )).all()) if source_ids else []
        if {artifact.artifact_id for artifact in artifacts} != source_ids:
            continue
        if any(not _artifact_visible_to_everyone(db, artifact, readers) for artifact in artifacts):
            continue
        safe.append({
            "question": previous.question[:1000],
            "answer": re.sub(r"\s*\[\d+\]", "", previous.answer or "")[:1600],
            "source_artifact_ids": sorted(source_ids),
        })
        if len(safe) >= limit:
            break
    return list(reversed(safe))


def retrieve_shared_context(db: Session, run: ColleagueRun, *, artifact_limit: int = 8, task_limit: int = 8) -> tuple[list[dict], list[dict]]:
    readers = _run_readers(db, run)

    conversation = _recent_thread_context(db, run)
    query_terms = _terms(" ".join([run.question, *(f"{turn['question']} {turn['answer']}" for turn in conversation)]))
    artifacts = list(
        db.scalars(
            select(Artifact)
            .where(Artifact.workspace_id == run.workspace_id, Artifact.review_status != "rejected")
            .order_by(Artifact.created_at.desc())
        ).all()
    )
    allowed = [artifact for artifact in artifacts if _artifact_visible_to_everyone(db, artifact, readers)]
    allowed_by_id = {artifact.artifact_id: artifact for artifact in allowed}
    context_artifact_ids = set(run.context_artifact_ids or [])
    if not context_artifact_ids.issubset(allowed_by_id):
        raise LocalLLMError("Değerlendirilecek kaynağa katılımcıların tamamı erişemiyor.")
    tasks = list(
        db.scalars(
            select(WorkTask)
            .where(WorkTask.workspace_id == run.workspace_id, WorkTask.status != "done")
            .order_by(WorkTask.due_at.asc(), WorkTask.created_at.desc())
            .limit(task_limit * 3)
        ).all()
    )
    tasks = [
        task
        for task in tasks
        if not task.source_artifact_ids
        or all(source_id in allowed_by_id for source_id in task.source_artifact_ids)
    ]
    prior_source_ids = {source_id for turn in conversation for source_id in turn["source_artifact_ids"]}
    priority_source_ids = context_artifact_ids | prior_source_ids
    if run.kind == "evening_review":
        priority_source_ids.update(source_id for task in tasks for source_id in (task.source_artifact_ids or []))
    chunks = list(
        db.scalars(
            select(ArtifactChunk)
            .where(ArtifactChunk.workspace_id == run.workspace_id, ArtifactChunk.artifact_id.in_(allowed_by_id))
            .order_by(ArtifactChunk.created_at.desc())
        ).all()
    ) if allowed_by_id else []
    ranked_chunks = sorted(
        chunks,
        key=lambda chunk: (
            chunk.artifact_id in priority_source_ids,
            len(query_terms & _terms(f"{allowed_by_id[chunk.artifact_id].title} {chunk.text}")),
            -chunk.sequence_number,
            chunk.created_at,
        ),
        reverse=True,
    )
    if query_terms and run.kind != "evening_review":
        matching_chunks = [
            chunk for chunk in ranked_chunks
            if chunk.artifact_id in priority_source_ids
            or query_terms & _terms(f"{allowed_by_id[chunk.artifact_id].title} {chunk.text}")
        ]
        ranked_chunks = matching_chunks if matching_chunks or run.kind == "ask" else ranked_chunks
    sources: list[dict] = []
    seen_artifacts: set[str] = set()
    for chunk in ranked_chunks:
        if chunk.artifact_id in seen_artifacts:
            continue
        seen_artifacts.add(chunk.artifact_id)
        artifact = allowed_by_id[chunk.artifact_id]
        sources.append(
            {
                "artifact_id": artifact.artifact_id,
                "title": artifact.title,
                "quote": chunk.text[:1600],
                "chunk_id": chunk.chunk_id,
            }
        )
        if len(sources) >= artifact_limit:
            break
    if not context_artifact_ids.issubset(seen_artifacts):
        raise LocalLLMError("Değerlendirilecek kaynakta işlenmiş metin bulunamadı.")

    if run.kind == "evening_review":
        tasks = [task for task in tasks if not task.source_artifact_ids or set(task.source_artifact_ids).issubset(seen_artifacts)]
    ranked_tasks = sorted(
        tasks,
        key=lambda task: (len(query_terms & _terms(f"{task.title} {task.description or ''}")), task.updated_at),
        reverse=True,
    )
    return sources, [
        {
            "task_id": task.task_id,
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "assignee_user_id": task.assignee_user_id,
            "due_at": task.due_at.isoformat() if task.due_at else None,
        }
        for task in ranked_tasks[:task_limit]
    ]


def _shared_signal_context(db: Session, run: ColleagueRun, sources: list[dict]) -> list[dict]:
    allowed_artifact_ids = {source["artifact_id"] for source in sources}
    signals = db.scalars(
        select(Signal)
        .where(
            Signal.workspace_id == run.workspace_id,
            Signal.status == "active",
            Signal.source_artifact_id.in_(allowed_artifact_ids),
        )
        .order_by(Signal.urgency_score.desc(), Signal.updated_at.desc())
        .limit(8)
    ).all() if allowed_artifact_ids else []
    safe_signals: list[dict] = []
    for signal in signals:
        if not signal_is_visible_to_artifact_ids(signal, allowed_artifact_ids):
            continue
        safe_signals.append({
            "signal_type": signal.signal_type,
            "title": signal.title,
            "summary": signal.summary,
            "recommended_action": signal.recommended_action,
            "source_artifact_id": signal.source_artifact_id,
        })
    return safe_signals


def _stream_local_answer(
    question: str,
    sources: list[dict],
    tasks: list[dict],
    signals: list[dict] | None = None,
    *,
    review: bool,
    conversation: list[dict] | None = None,
) -> Iterator[str]:
    settings = get_settings()
    if not settings.local_llm_enabled:
        raise LocalLLMError("Yerel dil modeli etkin değil (IZGE_LOCAL_LLM_ENABLED=true gerekli).")
    source_text = "\n\n".join(
        f"[{index}] {source['title']}\n{source['quote']}" for index, source in enumerate(sources, start=1)
    ) or "Paylaşılabilir dosya kaynağı bulunamadı."
    task_text = "\n".join(
        f"- {task['title']} (durum: {task['status']}, son tarih: {task['due_at'] or 'yok'})\n  {task['description'] or ''}"
        for task in tasks
    ) or "Açık görev bulunamadı."
    signal_text = "\n".join(
        f"- {signal['title']}: {signal['summary']} Öneri: {signal['recommended_action'] or 'yok'}"
        for signal in (signals or [])
    ) or "Aktif değişim/risk sinyali bulunamadı."
    conversation_text = "\n\n".join(
        f"Önceki soru: {turn['question']}\nİzge'nin önceki yanıtı: {turn['answer']}"
        for turn in (conversation or [])
    ) or "Önceki konuşma yok."
    system_prompt = (
        "Sen İzge'sin: şirketteki işleri bilen, deneyimli ve güvenilir bir çalışma arkadaşısın. "
        "Her zaman Türkçe, kısa ve doğrudan yaz. Yalnızca aşağıda verilen şirket kaynakları ve görev kayıtlarına dayan. "
        "Dosyaya dayalı her önemli iddianın sonuna [1] biçiminde kaynak numarası koy. Kaynak yetersizse bunu açıkça söyle; uydurma. "
        "Varsayım etiketli bilgi bir hipotezdir, doğrulanmış sonuç değildir. Kaynakta hipotez veya doğrulanmamış neden olarak geçen bilgiyi kesin kök neden gibi sunma. "
        "Risk ile gerçekleşmiş ihlali, potansiyel ücret ile onaylanmış alacağı ayır; kaynakta kanıtlanmayan SLA ihlali çıkarma. "
        "Onay bekleyen tutarı yanıtın hiçbir bölümünde kesinleşmiş alacak veya onaylanmış ücret diye adlandırma; özetinde de potansiyel ek ücret ve gerekli onayları koru. "
        "Faturalanmamış iş tutarında yalnız teslim edilmiş kapsam dışı işleri hesapla; başlanmamış talepleri ve bakım kapsamındaki müdahaleleri bu toplama dahil etme. "
        "Yalnız mevcut isteği yanıtla; devam sorusunda önceki konuşmanın konusunu koru ve sorulmamış başka müşteri veya riskleri listeleme. "
        "İşi yapan, aktaracak ve onaylayacak kişileri karıştırma; isim ve rolleri kayıttaki haliyle koru. "
        "Görev kayıtlarını operasyonel bağlam olarak kullan ama dosya kaynağıymış gibi numaralandırma."
    )
    if review:
        system_prompt += " Gün sonu değerlendirmesinde riskleri ve yarın için en fazla üç somut öneriyi önceliklendir."
    payload = {
        "model": settings.local_llm_model,
        "stream": True,
        "think": False,
        "options": {"temperature": 0.1, "num_predict": 900, "num_ctx": 8192},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"ÖNCEKİ KONUŞMA:\n{conversation_text}\n\nDOSYA KAYNAKLARI:\n{source_text}\n\nAÇIK İŞLER:\n{task_text}\n\nTÜRETİLMİŞ DEĞİŞİM VE RİSK SİNYALLERİ:\n{signal_text}\n\nİSTEK:\n{question}",
            },
        ],
    }
    base_url = validated_local_llm_base_url()
    target = parse.urlparse(parse.urljoin(f"{base_url}/", "/api/chat"))
    if not target.hostname:
        raise LocalLLMError("Yerel dil modeli adresinde sunucu adı yok.")
    connection_class = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(target.hostname, target.port, timeout=settings.local_llm_timeout_seconds)
    try:
        connection.request("POST", target.path, body=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        if response.status >= 400:
            raise LocalLLMError(f"Yerel dil modeli HTTP {response.status} döndürdü.")
        saw_done = False
        while line := response.readline():
            try:
                decoded_line = line.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise LocalLLMError("Yerel dil modeli geçersiz UTF-8 akış verisi döndürdü.") from exc
            if not decoded_line.strip():
                continue
            try:
                item = json.loads(decoded_line)
            except json.JSONDecodeError as exc:
                raise LocalLLMError("Yerel dil modeli bozuk JSON akış verisi döndürdü.") from exc
            if item.get("error"):
                raise LocalLLMError(f"Yerel dil modeli akışı hata verdi: {item['error']}")
            message = item.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str) and content:
                yield content
            if item.get("done") is True:
                saw_done = True
                break
        if not saw_done:
            raise LocalLLMError("Yerel dil modeli akışı tamamlanmadan kapandı.")
    except (OSError, TimeoutError) as exc:
        raise LocalLLMError(f"Yerel dil modeline ulaşılamadı: {exc}") from exc
    finally:
        connection.close()


def _structured_local_output(*, system_prompt: str, user_prompt: str, schema: dict, max_tokens: int, timeout_seconds: int | None = None) -> dict:
    settings = get_settings()
    if not settings.local_llm_enabled:
        raise LocalLLMError("Yerel dil modeli etkin değil (IZGE_LOCAL_LLM_ENABLED=true gerekli).")
    payload = {
        "model": settings.local_llm_model,
        "stream": False,
        "think": False,
        "format": schema,
        "options": {"temperature": 0, "num_predict": max_tokens, "num_ctx": 8192},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    base_url = validated_local_llm_base_url()
    target = parse.urlparse(parse.urljoin(f"{base_url}/", "/api/chat"))
    if not target.hostname:
        raise LocalLLMError("Yerel dil modeli adresinde sunucu adı yok.")
    connection_class = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(target.hostname, target.port, timeout=timeout_seconds or settings.local_llm_timeout_seconds)
    try:
        connection.request("POST", target.path, body=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        if response.status >= 400:
            raise LocalLLMError(f"Yerel dil modeli HTTP {response.status} döndürdü.")
        try:
            outer = json.loads(response.read().decode("utf-8"))
            content = outer["message"]["content"]
            result = json.loads(content)
        except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalLLMError("Yerel dil modeli geçersiz yapılandırılmış yanıt döndürdü.") from exc
        if not isinstance(result, dict):
            raise LocalLLMError("Yerel dil modeli yapılandırılmış nesne döndürmedi.")
        return result
    except (OSError, TimeoutError) as exc:
        raise LocalLLMError(f"Yerel dil modeline ulaşılamadı: {exc}") from exc
    finally:
        connection.close()


def _generate_follow_ups(question: str, answer: str, sources: list[dict]) -> list[str]:
    source_text = "\n".join(f"- {source['title']}: {source['quote']}" for source in sources) or "Kaynak yok."
    result = _structured_local_output(
        system_prompt=(
            "Ana yanıtı değiştirmeden, kullanıcının İzge'ye sorabileceği en fazla üç kısa Türkçe takip sorusu üret. "
            "Sorular kullanıcı ağzından, birbirinden farklı ve yalnız verilen yanıta ve kaynaklara dayanmalı. "
            "Soruların içine doğrulanmamış öncül gömme; teslim, plan ve onay ayrımını koru. "
            "Yanıtın konusu dışındaki kaynaklardan yeni gündem açma. Yeni olgu uydurma. Uygun soru yoksa boş liste döndür."
        ),
        user_prompt=f"SORU:\n{question}\n\nYANIT:\n{answer}\n\nERİŞİLEBİLİR KAYNAKLAR:\n{source_text}",
        schema={
            "type": "object",
            "properties": {
                "follow_ups": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 6, "maxLength": 160},
                    "maxItems": 3,
                }
            },
            "required": ["follow_ups"],
            "additionalProperties": False,
        },
        max_tokens=220,
        timeout_seconds=min(60, get_settings().local_llm_timeout_seconds),
    )
    raw_items = result.get("follow_ups")
    if not isinstance(raw_items, list):
        raise LocalLLMError("Yerel dil modeli takip sorusu listesi döndürmedi.")
    follow_ups: list[str] = []
    for item in raw_items:
        if not isinstance(item, str):
            raise LocalLLMError("Yerel dil modeli geçersiz takip sorusu döndürdü.")
        cleaned = " ".join(item.strip().split())
        if not 6 <= len(cleaned) <= 160:
            raise LocalLLMError("Yerel dil modeli takip sorusu uzunluk sınırını aştı.")
        if cleaned.casefold() not in {existing.casefold() for existing in follow_ups}:
            follow_ups.append(cleaned)
    return follow_ups[:3]


def _safe_follow_ups(question: str, answer: str, sources: list[dict]) -> list[str]:
    try:
        return _generate_follow_ups(question, answer, sources)
    except LocalLLMError as exc:
        logging.getLogger(__name__).warning("Takip soruları üretilemedi: %s", exc)
        return []
    except Exception:
        logging.getLogger(__name__).exception("Takip soruları üretilirken beklenmeyen hata")
        return []


def _evaluate_artifact_review(run: ColleagueRun, sources: list[dict]) -> tuple[bool, str, str]:
    source_text = "\n\n".join(
        f"[{index}] {'YENİ KAYIT' if source['artifact_id'] in (run.context_artifact_ids or []) else 'MEVCUT KAYIT'} — {source['title']}\n{source['quote']}"
        for index, source in enumerate(sources, start=1)
    )
    result = _structured_local_output(
        system_prompt=(
            "Sen İzge'sin. Yeni eklenen kaydı mevcut şirket kayıtlarıyla karşılaştır. Yalnız somut, eyleme dönük ve "
            "bildirime değer, YENİ KAYIT ile doğrudan bağlantılı bir risk veya fırsat varsa should_notify=true döndür. "
            "Bu bütün şirketi yeniden tarama görevi değildir: MEVCUT KAYITLARDA zaten bulunan, yeni kayıtla ilgisiz "
            "eski sorunları yeniden bildirme. Yeni kayıt yalnız sıradan bilgi veya biçimlendirme içeriyorsa "
            "should_notify=false, title ve summary boş olmalı. Belirsizliği veya kanıtsız tahmini bildirim yapma. "
            "true ise summary içinde yeni kayda mutlaka atıf yap ve her önemli iddiayı [1] biçiminde verilen kaynak "
            "numaralarıyla destekle. Her zaman Türkçe yaz."
        ),
        user_prompt=f"GÖREV:\n{run.question}\n\nKAYNAKLAR:\n{source_text or 'Kaynak yok.'}",
        schema={
            "type": "object",
            "properties": {
                "should_notify": {"type": "boolean"},
                "title": {"type": "string", "maxLength": 120},
                "summary": {"type": "string", "maxLength": 1200},
            },
            "required": ["should_notify", "title", "summary"],
            "additionalProperties": False,
        },
        max_tokens=500,
    )
    should_notify = result.get("should_notify")
    title = result.get("title")
    summary = result.get("summary")
    if not isinstance(should_notify, bool) or not isinstance(title, str) or not isinstance(summary, str):
        raise LocalLLMError("Yerel dil modeli geçersiz değerlendirme alanları döndürdü.")
    title = " ".join(title.strip().split())[:120]
    summary = summary.strip()[:1200]
    if should_notify and (not title or not summary):
        raise LocalLLMError("Bildirim değerlendirmesi başlık veya özet içermiyor.")
    if should_notify:
        _validate_answer_citations(summary, sources)
        cited_ids = {sources[int(index) - 1]['artifact_id'] for index in re.findall(r"\[(\d+)\]", summary)}
        if not cited_ids.intersection(run.context_artifact_ids or []):
            raise LocalLLMError("Bildirim yeni kayıttan kanıt içermiyor.")
    return should_notify, title, summary


def _validate_answer_citations(answer: str, sources: list[dict]) -> None:
    citations = [int(value) for value in re.findall(r"\[(\d+)\]", answer)]
    if sources and not citations:
        raise LocalLLMError("Yerel dil modeli kaynaklı yanıt için atıf üretmedi.")
    if not sources and citations:
        raise LocalLLMError("Yerel dil modeli mevcut olmayan bir kaynağa atıf yaptı.")
    if any(citation < 1 or citation > len(sources) for citation in citations):
        raise LocalLLMError("Yerel dil modeli geçersiz bir kaynak numarasına atıf yaptı.")


def _update_owned_run(db: Session, run_id: str, expected_owner: str, **values: Any) -> None:
    now = utcnow()
    result = cast(CursorResult[Any], db.execute(
        update(ColleagueRun)
        .where(
            ColleagueRun.run_id == run_id,
            ColleagueRun.status == "running",
            ColleagueRun.lease_owner == expected_owner,
            ColleagueRun.lease_expires_at.is_not(None),
            ColleagueRun.lease_expires_at > now,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    ))
    if result.rowcount != 1:
        db.rollback()
        raise LostColleagueLeaseError("Çalışma kiralaması başka bir işlemciye geçti.")


def _notification_preview(answer: str) -> str:
    return re.sub(r"\s*\[\d+\]", "", answer).strip()[:1200]


def _notify_completed_run(db: Session, run: ColleagueRun, answer: str, message_id: str | None) -> None:
    agent = ensure_colleague_user(db, run.workspace_id)
    if run.kind == "evening_review":
        recipients = _workspace_users(db, run.workspace_id, set(run.participant_user_ids or []) - {agent.user_id})
        title = "İzge günlük değerlendirmeyi tamamladı"
    elif (run.idempotency_key or "").startswith("automation:") or run.thread_id.startswith("automation:"):
        owner = db.get(User, run.created_by)
        recipients = [owner] if owner is not None and owner.user_id != agent.user_id else []
        title = "İzge otomasyonu tamamladı"
    else:
        return
    for recipient in recipients:
        create_notification(
            db,
            recipient=recipient,
            kind="agent",
            title=title,
            body=_notification_preview(answer),
            source_key=f"run:{run.run_id}",
            thread_id=run.thread_id,
            run_id=run.run_id,
            message_id=message_id,
        )


def process_colleague_run(db: Session, run: ColleagueRun, *, lease_owner: str | None = None) -> ColleagueRun:
    run_id = cast(str, run.__dict__.get("run_id") or run.run_id)
    snapshot_status = cast(str | None, run.__dict__.get("status"))
    if snapshot_status in TERMINAL_RUN_STATUSES:
        return run
    lease_owner = lease_owner or cast(str | None, run.__dict__.get("lease_owner"))
    if snapshot_status != "running" or not lease_owner:
        current = db.get(ColleagueRun, run_id)
        return current or run
    active_stage_key = "memory_update" if run.kind == "evening_review" else "retrieval"
    active_stage_label = "Kurumsal hafıza güncelleniyor" if run.kind == "evening_review" else "Şirket bilgileri taranıyor"
    try:
        if run.kind == "evening_review":
            add_run_event(db, run, "stage", stage_key="memory_update", label="Yeni kayıtlar hafızaya işleniyor", payload={"status": "running"}, lease_owner=lease_owner)
            agent = ensure_colleague_user(db, run.workspace_id)
            pending_artifacts = list(
                db.scalars(
                    select(Artifact)
                    .where(
                        Artifact.workspace_id == run.workspace_id,
                        Artifact.review_status != "rejected",
                        Artifact.ingestion_status.in_(("pending", "failed")),
                    )
                    .order_by(Artifact.created_at.asc())
                ).all()
            )
            from app.services.ingestion import run_ingestion
            from app.services.temporal_graph import sync_temporal_claims

            for artifact in pending_artifacts:
                add_run_event(db, run, "stage", stage_key="memory_update", label=f"{artifact.title} hafızaya işleniyor", payload={"status": "running"}, lease_owner=lease_owner)
                run_ingestion(db, artifact=artifact, actor=agent, use_local_llm=True, use_signal_explanations=True)
            sync_summary = sync_temporal_claims(db, workspace_id=run.workspace_id)
            db.commit()
            add_run_event(
                db,
                run,
                "stage",
                stage_key="memory_update",
                label="Kurumsal hafıza güncel",
                payload={"status": "completed", "processed_artifact_count": len(pending_artifacts), **sync_summary},
                lease_owner=lease_owner,
            )
            active_stage_key = "retrieval"
            active_stage_label = "Güncel hafıza taranıyor"
        add_run_event(db, run, "stage", stage_key="retrieval", label="Şirket bilgileri taranıyor", payload={"status": "running"}, lease_owner=lease_owner)
        sources, tasks = retrieve_shared_context(db, run)
        signals = _shared_signal_context(db, run, sources)
        _update_owned_run(db, run.run_id, lease_owner, sources=sources, lease_expires_at=utcnow() + timedelta(seconds=900))
        db.commit()
        db.refresh(run)
        for source in sources:
            add_run_event(db, run, "source", stage_key="retrieval", label=source["title"], payload={"source": source}, lease_owner=lease_owner)
        add_run_event(db, run, "stage", stage_key="retrieval", label="Kaynaklar hazır", payload={"status": "completed"}, lease_owner=lease_owner)
        active_stage_key = "thinking"
        active_stage_label = "Yeni kayıt değerlendiriliyor" if run.kind == "artifact_review" else "Yanıt hazırlanıyor"
        add_run_event(db, run, "stage", stage_key="thinking", label=active_stage_label, payload={"status": "running"}, lease_owner=lease_owner)

        if run.kind == "artifact_review":
            should_notify, notification_title, summary = _evaluate_artifact_review(run, sources)
            follow_ups = _safe_follow_ups(run.question, summary, sources) if should_notify else []
            if should_notify:
                add_run_event(db, run, "delta", stage_key="answer", text=summary, lease_owner=lease_owner)
            add_run_event(db, run, "stage", stage_key="thinking", label="Yeni kayıt değerlendirildi", payload={"status": "completed"}, lease_owner=lease_owner)
            add_run_event(db, run, "done", stage_key="answer", label="Tamamlandı", payload={"status": "completed", "notified": should_notify}, lease_owner=lease_owner)
            _update_owned_run(
                db,
                run.run_id,
                lease_owner,
                answer=summary if should_notify else None,
                follow_ups=follow_ups,
                status="completed",
                completed_at=utcnow(),
                lease_owner=None,
                lease_expires_at=None,
            )
            if should_notify:
                agent = ensure_colleague_user(db, run.workspace_id)
                message = CompanyChatMessage(
                    workspace_id=run.workspace_id,
                    author_user_id=agent.user_id,
                    body=summary,
                    message_metadata={
                        "channel": run.thread_id,
                        "thread_id": run.thread_id,
                        "thread_title": run.thread_title,
                        "thread_kind": run.thread_kind,
                        "participant_user_ids": run.participant_user_ids,
                        "source": "izge-artifact-review",
                        "colleague_run_id": run.run_id,
                        "source_refs": sources,
                        "follow_ups": follow_ups,
                    },
                )
                db.add(message)
                db.flush()
                recipient = db.get(User, run.created_by)
                if recipient is None:
                    raise RuntimeError("Kaynak değerlendirmesinin alıcısı bulunamadı.")
                create_notification(
                    db,
                    recipient=recipient,
                    kind="agent",
                    title=notification_title,
                    body=_notification_preview(summary),
                    source_key=f"run:{run.run_id}",
                    thread_id=run.thread_id,
                    run_id=run.run_id,
                    message_id=message.message_id,
                )
            db.commit()
            db.refresh(run)
            return run

        answer_parts: list[str] = []
        buffer = ""
        for delta in _stream_local_answer(
            run.question,
            sources,
            tasks,
            signals,
            review=run.kind == "evening_review",
            conversation=_recent_thread_context(db, run),
        ):
            answer_parts.append(delta)
            buffer += delta
            if len(buffer) >= 80 or "\n" in buffer:
                add_run_event(db, run, "delta", stage_key="answer", text=buffer, lease_owner=lease_owner)
                buffer = ""
        if buffer:
            add_run_event(db, run, "delta", stage_key="answer", text=buffer, lease_owner=lease_owner)
        answer = "".join(answer_parts).strip()
        if not answer:
            raise LocalLLMError("Yerel dil modeli boş yanıt döndürdü.")
        _validate_answer_citations(answer, sources)
        follow_ups = _safe_follow_ups(run.question, answer, sources)

        add_run_event(db, run, "stage", stage_key="thinking", label="Yanıt hazır", payload={"status": "completed"}, lease_owner=lease_owner)
        agent = ensure_colleague_user(db, run.workspace_id)
        existing_answer_message = db.scalar(
            select(CompanyChatMessage).where(
                CompanyChatMessage.workspace_id == run.workspace_id,
                CompanyChatMessage.author_user_id == agent.user_id,
                CompanyChatMessage.message_metadata["colleague_run_id"].as_string() == run.run_id,
            )
        )
        add_run_event(db, run, "done", stage_key="answer", label="Tamamlandı", payload={"status": "completed"}, lease_owner=lease_owner)
        _update_owned_run(
            db,
            run.run_id,
            lease_owner,
            answer=answer,
            follow_ups=follow_ups,
            status="completed",
            completed_at=utcnow(),
            lease_owner=None,
            lease_expires_at=None,
        )
        answer_message = existing_answer_message
        if answer_message is None:
            answer_message = CompanyChatMessage(
                workspace_id=run.workspace_id,
                author_user_id=agent.user_id,
                body=answer,
                message_metadata={
                    "channel": run.thread_id,
                    "thread_id": run.thread_id,
                    "thread_title": run.thread_title,
                    "thread_kind": run.thread_kind,
                    "participant_user_ids": run.participant_user_ids,
                    "source": "izge-colleague",
                    "colleague_run_id": run.run_id,
                    "source_refs": sources,
                    "follow_ups": follow_ups,
                },
            )
            db.add(answer_message)
            db.flush()
        if run.kind == "ask" and len(set(run.participant_user_ids) - {agent.user_id}) > 1:
            notify_team_chat_recipients(
                db, author=agent, message_id=answer_message.message_id, body=_notification_preview(answer),
                thread_id=run.thread_id, thread_title=run.thread_title,
                participant_user_ids=set(run.participant_user_ids),
            )
        _notify_completed_run(db, run, answer, answer_message.message_id)
        db.commit()
    except LostColleagueLeaseError:
        db.rollback()
        db.expire_all()
        return db.get(ColleagueRun, run_id) or run
    except Exception as exc:
        logging.getLogger(__name__).exception("Colleague run failed: run_id=%s stage=%s", run_id, active_stage_key)
        db.rollback()
        refreshed_run = db.get(ColleagueRun, run_id)
        if refreshed_run is None:
            raise
        run = refreshed_run
        error = "Gün sonu hafıza güncellemesi tamamlanamadı." if run.kind == "evening_review" and active_stage_key == "memory_update" else str(exc)[:2000]
        try:
            add_run_event(db, run, "stage", stage_key=active_stage_key, label=active_stage_label, payload={"status": "failed"}, lease_owner=lease_owner)
            add_run_event(db, run, "failed", stage_key="answer", label="Yanıt üretilemedi", text=error, payload={"status": "failed"}, lease_owner=lease_owner)
            _update_owned_run(
                db,
                run.run_id,
                lease_owner,
                status="failed",
                error=error,
                completed_at=utcnow(),
                lease_owner=None,
                lease_expires_at=None,
            )
            db.commit()
        except LostColleagueLeaseError:
            db.rollback()
            db.expire_all()
            return db.get(ColleagueRun, run_id) or run
    db.refresh(run)
    return run


def dispatch_due_reminders(db: Session, now: datetime) -> int:
    from zoneinfo import ZoneInfo

    tasks = list(
        db.scalars(
            select(WorkTask).where(
                WorkTask.status != "done",
                WorkTask.assignee_user_id.is_not(None),
                WorkTask.remind_at.is_not(None),
                WorkTask.remind_at <= now.replace(tzinfo=None) if now.tzinfo else WorkTask.remind_at <= now,
                WorkTask.reminder_sent_at.is_(None),
            )
        ).all()
    )
    sent = 0
    for task in tasks:
        agent = ensure_colleague_user(db, task.workspace_id)
        assignee = db.get(User, task.assignee_user_id) if task.assignee_user_id else None
        visible_title = task.title if assignee is not None and task_sources_visible_to_readers(db, task, [assignee]) else "Erişimi kısıtlı iş"
        body = f"Hatırlatma: **{visible_title}**"
        if task.due_at:
            local_due = task.due_at.replace(tzinfo=UTC).astimezone(ZoneInfo("Europe/Istanbul"))
            body += f" — son tarih {local_due.strftime('%d.%m.%Y %H:%M')}"
        db.add(
            CompanyChatMessage(
                workspace_id=task.workspace_id,
                author_user_id=agent.user_id,
                body=body,
                message_metadata={
                    "channel": "izge-colleague",
                    "thread_id": "izge-colleague",
                    "thread_title": "İzge ile çalışma",
                    "thread_kind": "direct",
                    "participant_user_ids": [task.assignee_user_id, agent.user_id],
                    "source": "izge-reminder",
                    "task_id": task.task_id,
                },
            )
        )
        task.reminder_sent_at = utcnow()
        sent += 1
    if sent:
        db.commit()
    return sent


def default_worker_id() -> str:
    return f"{socket.gethostname()}-{secrets.token_hex(3)}"
