from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.engine import Connection, Engine

from app import models as _models  # noqa: F401 - import registers SQLAlchemy models on Base.metadata
from app.db import Base, engine as default_engine


REQUIRED_SCHEMA_COLUMNS: dict[str, set[str]] = {
    "work_tasks": {"task_id", "workspace_id", "created_by", "assignee_user_id", "status", "remind_at", "source_artifact_ids", "source_snapshot"},
    "colleague_runs": {"run_id", "workspace_id", "created_by", "status", "participant_user_ids", "lease_expires_at", "sources"},
    "colleague_run_events": {"event_id", "run_id", "sequence", "event_type", "payload"},
    "artifacts": {"artifact_id", "workspace_id", "title", "review_status", "reviewed_by", "reviewed_at", "review_notes"},
    "artifact_chunks": {"chunk_id", "artifact_id", "workspace_id", "sequence_number", "text", "chunk_metadata"},
    "query_runs": {"query_run_id", "workspace_id", "query_class", "route_confidence", "answer_payload", "permissions_limited"},
    "query_trace_steps": {"trace_step_id", "query_run_id", "workspace_id", "step_kind", "payload_json"},
    "orchestration_stage_runs": {
        "stage_run_id",
        "query_run_id",
        "workspace_id",
        "stage_key",
        "status",
        "authority_level",
        "verifier_status",
        "input_refs",
        "output_summary",
        "created_at",
    },
    "company_chat_messages": {"message_id", "workspace_id", "author_user_id", "body", "message_metadata", "created_at"},
    "orchestration_jobs": {
        "job_id",
        "workspace_id",
        "created_by",
        "query_run_id",
        "job_kind",
        "stage_key",
        "status",
        "priority",
        "payload_json",
        "result_json",
        "error_message",
        "lease_owner",
        "lease_expires_at",
        "available_at",
        "claimed_at",
        "completed_at",
    },
    "scenario_runs": {
        "scenario_run_id",
        "workspace_id",
        "created_by",
        "scenario_text_hash",
        "packet_id",
        "input_snapshot_hash",
        "candidate_snapshot_hash",
        "scenario_packet",
        "result_payload",
    },
    "claim_families": {
        "family_id",
        "workspace_id",
        "claim_family_key",
        "status",
        "first_seen_at",
        "latest_seen_at",
        "occurrence_count",
    },
    "claim_occurrences": {
        "occurrence_id",
        "family_id",
        "workspace_id",
        "memory_type",
        "memory_id",
        "source_artifact_id",
        "observed_at",
        "valid_from",
        "status",
    },
}

REQUIRED_VIRTUAL_TABLES = {"artifact_chunks_fts"}


def assert_required_schema_ready(connection: Connection) -> None:
    """Fail loudly if a company database is missing critical portable-memory tables/columns."""

    inspector = inspect(connection)
    problems: list[str] = []
    for table_name, required_columns in REQUIRED_SCHEMA_COLUMNS.items():
        if not inspector.has_table(table_name):
            problems.append(f"{table_name}: missing table")
            continue
        existing_columns = {str(column["name"]) for column in inspector.get_columns(table_name)}
        missing_columns = sorted(required_columns - existing_columns)
        if missing_columns:
            problems.append(f"{table_name}: missing columns {', '.join(missing_columns)}")
    for table_name in sorted(REQUIRED_VIRTUAL_TABLES):
        if not inspector.has_table(table_name):
            problems.append(f"{table_name}: missing table")
    if problems:
        raise RuntimeError(
            "Database schema is not ready for the portable memory/orchestration runtime. "
            "Run `python -m app.migration_tools upgrade` against the target database before serving traffic: "
            + "; ".join(problems)
        )


def ensure_fts_table(connection: Connection) -> None:
    connection.exec_driver_sql(
        "CREATE VIRTUAL TABLE IF NOT EXISTS artifact_chunks_fts USING fts5("
        "chunk_id UNINDEXED, artifact_id UNINDEXED, workspace_id UNINDEXED, text)"
    )


def ensure_legacy_schema_compatibility(target_engine: Engine = default_engine) -> None:
    """Non-destructive repair path for pre-Alembic local/company SQLite databases.

    This preserves existing seeded/company rows, creates missing additive tables from current
    SQLAlchemy metadata, applies the historic additive column repairs, creates the FTS table,
    and then requires the schema checker to pass before migration tooling can stamp the DB.
    """

    Base.metadata.create_all(bind=target_engine)
    with target_engine.begin() as connection:
        for table_name in ("decisions", "assumptions", "constraints", "outcomes", "commitments"):
            columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()}
            if "topic_key" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN topic_key VARCHAR(255) NOT NULL DEFAULT 'general'")
            if "extraction_method" not in columns:
                connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN extraction_method VARCHAR(64) NOT NULL DEFAULT 'heuristic'")
            if table_name == "commitments" and "owner_label" not in columns:
                connection.exec_driver_sql("ALTER TABLE commitments ADD COLUMN owner_label VARCHAR(255)")
        query_run_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(query_runs)").fetchall()}
        if "route_confidence" not in query_run_columns:
            connection.exec_driver_sql("ALTER TABLE query_runs ADD COLUMN route_confidence FLOAT NOT NULL DEFAULT 0.0")
        artifact_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(artifacts)").fetchall()}
        if "review_status" not in artifact_columns:
            connection.exec_driver_sql("ALTER TABLE artifacts ADD COLUMN review_status VARCHAR(32) NOT NULL DEFAULT 'submitted'")
        if "reviewed_by" not in artifact_columns:
            connection.exec_driver_sql("ALTER TABLE artifacts ADD COLUMN reviewed_by VARCHAR(64)")
        if "reviewed_at" not in artifact_columns:
            connection.exec_driver_sql("ALTER TABLE artifacts ADD COLUMN reviewed_at DATETIME")
        if "review_notes" not in artifact_columns:
            connection.exec_driver_sql("ALTER TABLE artifacts ADD COLUMN review_notes TEXT")
        ensure_fts_table(connection)
        assert_required_schema_ready(connection)
