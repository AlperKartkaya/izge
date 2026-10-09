from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class NotificationRead(BaseModel):
    notification_id: str
    kind: Literal["message", "agent"]
    title: str
    body: str
    thread_id: str | None
    run_id: str | None
    message_id: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationRead]
    unread_count: int
