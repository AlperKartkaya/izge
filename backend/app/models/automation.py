from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.domain import TimestampMixin, new_id


class Automation(Base, TimestampMixin):
    __tablename__ = "automations"

    automation_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("aut"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    prompt: Mapped[str] = mapped_column(Text)
    schedule_time: Mapped[str] = mapped_column(String(5))
    frequency: Mapped[str] = mapped_column(String(24), default="daily", server_default="daily", nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    response_language: Mapped[str] = mapped_column(String(2), default="tr", server_default="tr", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_run_id: Mapped[str | None] = mapped_column(String(64))
    last_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
