from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Base, get_db
from app.dependencies import get_current_user
from app.migration_tools import current_revision
from app.models import Artifact, ArtifactChunk, Assumption, Commitment, Constraint, Decision, Outcome, User
from app.schemas.api import ArtifactStorageAdminRead, DatabaseOverviewRead, DatabaseTableRead
from app.services.permissions import require_admin
from app.services.storage import resolve_artifact_source_path

router = APIRouter(prefix="/admin/database", tags=["admin-data"])


TABLE_SURFACES: dict[str, tuple[str, str]] = {
    "workspace": ("bootstrap/admin setup", "admin data overview"),
    "users": ("admin user management", "admin user management"),
    "user_sessions": ("auth sign-in", "auth/session guards"),
    "artifacts": ("upload, paste, metadata, review, permissions", "artifacts, memory FS, admin data"),
    "artifact_permissions": ("artifact permissions", "artifact access guards"),
    "artifact_chunks": ("ingestion", "artifact detail, retrieval, memory FS"),
    "ingestion_jobs": ("ingestion run", "ingestion status"),
    "decisions": ("ingestion/extraction", "queries, graph, memory FS"),
    "assumptions": ("ingestion/extraction", "queries, graph, memory FS"),
    "constraints": ("ingestion/extraction", "queries, graph, memory FS"),
    "outcomes": ("ingestion/extraction", "queries, graph, memory FS"),
    "commitments": ("ingestion/extraction", "queries, graph, memory FS"),
    "signals": ("proactive signal generation", "signals and dashboard"),
    "query_runs": ("query API", "query history and readiness"),
    "query_trace_steps": ("query/orchestration tracing", "trace evidence"),
    "company_chat_messages": ("employee team chat", "team chat and admin data"),
    "orchestration_stage_runs": ("bounded orchestration runtime", "orchestration evidence"),
    "orchestration_jobs": ("worker queue API/daemon", "jobs dashboard, admin data"),
    "scenario_runs": ("scenario replay", "scenario history and readiness"),
    "claim_families": ("temporal claim projection", "temporal graph"),
    "claim_occurrences": ("temporal claim projection", "temporal graph"),
    "graph_nodes": ("knowledge graph projection", "graph UI/API"),
    "graph_edges": ("knowledge graph projection", "graph UI/API"),
    "audit_events": ("audited API actions", "audit page"),
    "alembic_version": ("migration tooling", "admin data overview"),
}

MEMORY_MODELS = (Decision, Assumption, Constraint, Outcome, Commitment)


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _count_table_rows(db: Session, table_name: str) -> int:
    return int(db.execute(text(f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}")).scalar_one())


def _artifact_memory_count(db: Session, artifact_id: str) -> int:
    total = 0
    for model in MEMORY_MODELS:
        total += int(db.scalar(select(func.count()).select_from(model).where(model.source_artifact_id == artifact_id)) or 0)
    return total


def _storage_record(db: Session, artifact: Artifact) -> ArtifactStorageAdminRead:
    source_path = resolve_artifact_source_path(source_path=artifact.source_path, artifact_id=artifact.artifact_id, source_type=artifact.source_type)
    storage_exists = source_path is not None
    byte_size = source_path.stat().st_size if source_path is not None else None
    chunk_count = int(db.scalar(select(func.count()).select_from(ArtifactChunk).where(ArtifactChunk.artifact_id == artifact.artifact_id)) or 0)
    return ArtifactStorageAdminRead(
        artifact_id=artifact.artifact_id,
        title=artifact.title,
        source_type=artifact.source_type,
        logical_locator=f"artifact://{artifact.artifact_id}/source",
        source_path=str(source_path or Path(artifact.source_path)),
        storage_exists=storage_exists,
        byte_size=byte_size,
        checksum_sha256=artifact.checksum_sha256,
        mime_type=artifact.mime_type,
        ingestion_status=artifact.ingestion_status,
        review_status=artifact.review_status,
        visibility_scope=artifact.visibility_scope,
        chunk_count=chunk_count,
        memory_object_count=_artifact_memory_count(db, artifact.artifact_id),
        updated_at=artifact.updated_at,
    )


@router.get("", response_model=DatabaseOverviewRead)
def get_database_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DatabaseOverviewRead:
    require_admin(current_user)
    settings = get_settings()
    actual_table_names = sorted(set(inspect(db.get_bind()).get_table_names()) | {table.name for table in Base.metadata.sorted_tables})
    tables = [
        DatabaseTableRead(
            table_name=table_name,
            row_count=_count_table_rows(db, table_name),
            write_surface=TABLE_SURFACES.get(table_name, ("internal", "internal"))[0],
            read_surface=TABLE_SURFACES.get(table_name, ("internal", "internal"))[1],
        )
        for table_name in actual_table_names
    ]
    artifacts = db.scalars(
        select(Artifact).where(Artifact.workspace_id == current_user.workspace_id).order_by(Artifact.updated_at.desc(), Artifact.created_at.desc())
    ).all()
    return DatabaseOverviewRead(
        workspace_id=current_user.workspace_id,
        generated_at=datetime.utcnow(),
        sqlite_path=str(Path(settings.sqlite_path).resolve()),
        storage_root=str(settings.storage_path),
        pasted_text_root=str(settings.pasted_storage_path),
        alembic_revision=current_revision(),
        tables=tables,
        artifacts=[_storage_record(db, artifact) for artifact in artifacts],
        management_notes=[
            "Use this page and the API for supported inspection and metadata changes; avoid raw SQL edits against company data.",
            "Uploaded files are persisted under IZGE_STORAGE_ROOT/<artifact_id>/source.<ext>; pasted text is under IZGE_PASTED_TEXT_ROOT/<artifact_id>/pasted.txt.",
            "Raw source content is immutable for auditability. To change a document, upload or paste a replacement artifact and review/restrict the old one.",
            "Editable artifact fields today: title, review status/notes, visibility scope, and permitted users.",
            "Database-level access should be limited to authorized operators; day-to-day changes should use authenticated UI/API surfaces.",
        ],
    )
