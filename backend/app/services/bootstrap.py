from __future__ import annotations

import json
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Base, engine
from app.models import User, Workspace
from app.services.audit import log_event
from app.services.security import hash_password


def initialize_database() -> None:
    settings = get_settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    settings.pasted_storage_path.mkdir(parents=True, exist_ok=True)
    settings.storage_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        for table_name in ("decisions", "assumptions", "constraints", "outcomes", "commitments"):
            columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()}
            if "topic_key" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN topic_key VARCHAR(255) NOT NULL DEFAULT 'general'")
        connection.exec_driver_sql(
            "CREATE VIRTUAL TABLE IF NOT EXISTS artifact_chunks_fts USING fts5(chunk_id UNINDEXED, artifact_id UNINDEXED, workspace_id UNINDEXED, text)"
        )


def _bootstrap_admin_password() -> str:
    settings = get_settings()
    if settings.default_admin_password:
        return settings.default_admin_password
    credentials_file = settings.bootstrap_admin_credentials_file
    credentials_file.parent.mkdir(parents=True, exist_ok=True)
    if credentials_file.exists():
        payload = json.loads(credentials_file.read_text(encoding="utf-8"))
        password = payload.get("password")
        if password:
            return password
    password = secrets.token_urlsafe(18)
    credentials_file.write_text(
        json.dumps({"email": settings.default_admin_email, "password": password}, indent=2),
        encoding="utf-8",
    )
    return password


def seed_defaults(db: Session) -> None:
    settings = get_settings()
    workspace = db.scalar(select(Workspace))
    if workspace is None:
        workspace = Workspace(name=settings.workspace_name, description=settings.workspace_description)
        db.add(workspace)
        db.commit()
        db.refresh(workspace)

    admin = db.scalar(select(User).where(User.email == settings.default_admin_email))
    if admin is None:
        admin = User(
            workspace_id=workspace.workspace_id,
            role="Admin",
            display_name=settings.default_admin_display_name,
            email=settings.default_admin_email,
            password_hash=hash_password(_bootstrap_admin_password()),
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        log_event(
            db,
            workspace_id=workspace.workspace_id,
            actor_user_id=admin.user_id,
            event_type="USER_SEEDED",
            target_type="user",
            target_id=admin.user_id,
            event_metadata={"role": admin.role, "email": admin.email},
        )
