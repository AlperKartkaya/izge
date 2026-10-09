from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.domain import TimestampMixin, new_id


class WorkTask(Base, TimestampMixin):
    __tablename__ = "work_tasks"

    task_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("tsk"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    assignee_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.user_id"), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    source_artifact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class ColleagueRun(Base, TimestampMixin):
    __tablename__ = "colleague_runs"
    __table_args__ = (
        UniqueConstraint("workspace_id", "client_request_id", name="uq_colleague_run_workspace_request"),
        UniqueConstraint("workspace_id", "idempotency_key", name="uq_colleague_run_workspace_idempotency"),
    )

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("crn"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), default="ask", nullable=False, index=True)
    client_request_id: Mapped[str | None] = mapped_column(String(120))
    idempotency_key: Mapped[str | None] = mapped_column(String(120))
    thread_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    thread_title: Mapped[str] = mapped_column(String(120), nullable=False)
    thread_kind: Mapped[str] = mapped_column(String(16), default="direct", nullable=False)
    participant_user_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    response_language: Mapped[str] = mapped_column(String(2), default="tr", server_default="tr", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False, index=True)
    answer: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    sources: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    context_artifact_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    follow_ups: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(255), index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ColleagueRunEvent(Base):
    __tablename__ = "colleague_run_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence", name="uq_colleague_event_run_sequence"),)

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("cev"))
    run_id: Mapped[str] = mapped_column(ForeignKey("colleague_runs.run_id", ondelete="CASCADE"), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    stage_key: Mapped[str | None] = mapped_column(String(64))
    label: Mapped[str | None] = mapped_column(String(255))
    text: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("recipient_user_id", "source_key", name="uq_notification_recipient_source"),)

    notification_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ntf"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    recipient_user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    thread_id: Mapped[str | None] = mapped_column(String(80), index=True)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("colleague_runs.run_id"), index=True)
    message_id: Mapped[str | None] = mapped_column(ForeignKey("company_chat_messages.message_id"), index=True)
    source_key: Mapped[str] = mapped_column(String(160), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
