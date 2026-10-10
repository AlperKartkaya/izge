from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.work import RunStatus


class AutomationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=4000)
    schedule_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    frequency: Literal["hourly", "every_6_hours", "daily", "weekly"] = "daily"
    starts_at: datetime | None = None
    response_language: Literal["tr", "en"] = "tr"
    enabled: bool = True

    @field_validator("title", "prompt")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Bu alan boş bırakılamaz.")
        return value.strip()

    @field_validator("starts_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("Başlangıç tarihi saat dilimi içermelidir.")
        return value


class AutomationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    prompt: str | None = Field(default=None, min_length=1, max_length=4000)
    schedule_time: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    frequency: Literal["hourly", "every_6_hours", "daily", "weekly"] | None = None
    starts_at: datetime | None = None
    response_language: Literal["tr", "en"] | None = None
    enabled: bool | None = None

    @field_validator("title", "prompt")
    @classmethod
    def not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Bu alan boş bırakılamaz.")
        return value.strip() if value is not None else None

    @field_validator("starts_at")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("Başlangıç tarihi saat dilimi içermelidir.")
        return value


class AutomationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    automation_id: str
    title: str
    prompt: str
    schedule_time: str
    frequency: Literal["hourly", "every_6_hours", "daily", "weekly"]
    starts_at: datetime | None
    response_language: Literal["tr", "en"]
    enabled: bool
    timezone: str = "Europe/Istanbul"
    last_run_at: datetime | None
    last_run_id: str | None
    last_run_status: RunStatus | None
    next_run_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AutomationList(BaseModel):
    items: list[AutomationRead]
