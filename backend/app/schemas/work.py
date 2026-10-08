from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


TaskStatus = Literal["open", "in_progress", "done"]
ThreadKind = Literal["channel", "direct", "group"]
RunStatus = Literal["queued", "running", "completed", "failed"]


class WorkTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    status: TaskStatus = "open"
    assignee_user_id: str | None = None
    due_at: datetime | None = None
    remind_at: datetime | None = None
    source_artifact_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("due_at", "remind_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Tarih ve saat bilgisi saat dilimi içermelidir.")
        return value


class WorkTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    status: TaskStatus | None = None
    assignee_user_id: str | None = None
    due_at: datetime | None = None
    remind_at: datetime | None = None
    source_artifact_ids: list[str] | None = Field(default=None, max_length=20)

    @field_validator("due_at", "remind_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Tarih ve saat bilgisi saat dilimi içermelidir.")
        return value


class WorkTaskRead(BaseModel):
    task_id: str
    workspace_id: str
    created_by: str
    assignee_user_id: str | None
    assignee_display_name: str | None
    title: str
    description: str | None
    status: TaskStatus
    due_at: datetime | None
    remind_at: datetime | None
    reminder_sent_at: datetime | None
    source_artifact_ids: list[str]
    created_at: datetime
    updated_at: datetime


class WorkTaskList(BaseModel):
    items: list[WorkTaskRead]


class ColleagueAskCreate(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    client_request_id: str = Field(min_length=8, max_length=120)
    thread_id: str | None = Field(default=None, min_length=1, max_length=80)
    thread_title: str | None = Field(default=None, min_length=1, max_length=120)
    thread_kind: ThreadKind = "direct"
    participant_user_ids: list[str] = Field(default_factory=list, max_length=50)


class ColleagueAskAccepted(BaseModel):
    run_id: str
    thread_id: str
    status: RunStatus


class ColleagueSourceRead(BaseModel):
    artifact_id: str
    title: str
    quote: str
    chunk_id: str | None = None


class ColleagueStageRead(BaseModel):
    sequence: int
    key: str
    label: str
    status: str
    created_at: datetime


class ColleagueRunRead(BaseModel):
    run_id: str
    kind: Literal["ask", "evening_review"]
    thread_id: str
    thread_title: str
    thread_kind: ThreadKind
    participant_user_ids: list[str]
    question: str
    status: RunStatus
    answer: str | None
    error: str | None
    sources: list[ColleagueSourceRead]
    stages: list[ColleagueStageRead]
    created_at: datetime
    updated_at: datetime


class ColleagueRunList(BaseModel):
    items: list[ColleagueRunRead]


class ColleagueReviewAccepted(BaseModel):
    run_id: str
    status: RunStatus
