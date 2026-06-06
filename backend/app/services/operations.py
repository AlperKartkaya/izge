from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Base
from app.migration_tools import current_revision
from app.models import (
    Artifact,
    ArtifactChunk,
    Assumption,
    ClaimFamily,
    ClaimOccurrence,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    IngestionJob,
    OrchestrationJob,
    OrchestrationStageRun,
    Outcome,
    QueryRun,
    QueryTraceStep,
    ScenarioRun,
    Signal,
    User,
)
from app.services.llm_status import inspect_local_llm_status
from app.services.storage import resolve_artifact_source_path

MEMORY_MODELS = (
    ("decision", Decision),
    ("assumption", Assumption),
    ("constraint", Constraint),
    ("outcome", Outcome),
    ("commitment", Commitment),
)

WARNING_STATUSES = {"warning", "critical"}
TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}
CLAIMABLE_JOB_STATUSES = {"queued", "retry"}


def _utcnow() -> datetime:
    return datetime.utcnow()


def _count_rows(db: Session, model: Any, *criteria: Any) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*criteria)) or 0)


def _count_by_value(db: Session, column: Any, *criteria: Any) -> dict[str, int]:
    rows = db.execute(select(column, func.count()).where(*criteria).group_by(column)).all()
    return {str(value or "unknown"): int(count) for value, count in rows}


def _latest_datetime(db: Session, column: Any, *criteria: Any) -> datetime | None:
    return db.scalar(select(func.max(column)).where(*criteria))


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _count_table_rows(db: Session, table_name: str) -> int:
    return int(db.execute(text(f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}")).scalar_one())


def _memory_count_for_artifact(db: Session, artifact_id: str) -> int:
    return sum(
        int(db.scalar(select(func.count()).select_from(model).where(model.source_artifact_id == artifact_id)) or 0)
        for _, model in MEMORY_MODELS
    )


def _chunk_count_for_artifact(db: Session, artifact_id: str) -> int:
    return _count_rows(db, ArtifactChunk, ArtifactChunk.artifact_id == artifact_id)


def _artifact_issue(artifact: Artifact, *, reason: str, chunk_count: int | None = None, memory_count: int | None = None) -> dict[str, Any]:
    source_path = resolve_artifact_source_path(source_path=artifact.source_path, artifact_id=artifact.artifact_id, source_type=artifact.source_type)
    return {
        "artifact_id": artifact.artifact_id,
        "title": artifact.title,
        "reason": reason,
        "ingestion_status": artifact.ingestion_status,
        "review_status": artifact.review_status,
        "updated_at": artifact.updated_at,
        "source_path": str(source_path or artifact.source_path),
        "chunk_count": chunk_count,
        "memory_object_count": memory_count,
    }


def _section(status: str, title: str, summary: str, metrics: dict[str, Any], issues: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "title": title,
        "summary": summary,
        "metrics": metrics,
        "issues": issues or [],
    }


def _max_status(statuses: list[str]) -> str:
    if "critical" in statuses:
        return "critical"
    if "warning" in statuses:
        return "warning"
    return "healthy"


def _age_seconds(value: datetime | None, now: datetime) -> int | None:
    if value is None:
        return None
    return max(0, int((now - value).total_seconds()))


def _table_inventory(db: Session) -> tuple[int, int]:
    actual_table_names = sorted(set(inspect(db.get_bind()).get_table_names()) | {table.name for table in Base.metadata.sorted_tables})
    total_rows = 0
    for table_name in actual_table_names:
        total_rows += _count_table_rows(db, table_name)
    return len(actual_table_names), total_rows


def _database_storage_section(db: Session, workspace_id: str, artifacts: list[Artifact]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    settings = get_settings()
    table_count, total_rows = _table_inventory(db)
    missing_storage: list[dict[str, Any]] = []
    stored_sources = 0
    total_bytes = 0

    for artifact in artifacts:
        source_path = resolve_artifact_source_path(source_path=artifact.source_path, artifact_id=artifact.artifact_id, source_type=artifact.source_type)
        if source_path is not None:
            stored_sources += 1
            total_bytes += source_path.stat().st_size
        else:
            missing_storage.append(
                _artifact_issue(
                    artifact,
                    reason="source file is missing at the recorded admin storage path",
                    chunk_count=_chunk_count_for_artifact(db, artifact.artifact_id),
                    memory_count=_memory_count_for_artifact(db, artifact.artifact_id),
                )
            )

    status = "critical" if missing_storage else "healthy"
    section = _section(
        status,
        "Database and source storage",
        "SQLite, mounted storage roots, migration revision, and physical source-file integrity.",
        {
            "workspace_id": workspace_id,
            "alembic_revision": current_revision(),
            "sqlite_path": str(Path(settings.sqlite_path).resolve()),
            "storage_root": str(settings.storage_path),
            "pasted_text_root": str(settings.pasted_storage_path),
            "table_count": table_count,
            "total_table_rows": total_rows,
            "artifact_records": len(artifacts),
            "stored_sources": stored_sources,
            "missing_sources": len(missing_storage),
            "total_source_bytes": total_bytes,
        },
        missing_storage[:12],
    )
    return section, missing_storage


def _artifact_index_section(db: Session, artifacts: list[Artifact]) -> tuple[dict[str, Any], dict[str, int], list[dict[str, Any]]]:
    by_review = Counter(artifact.review_status for artifact in artifacts)
    by_ingestion = Counter(artifact.ingestion_status for artifact in artifacts)
    zero_chunk: list[dict[str, Any]] = []
    zero_memory: list[dict[str, Any]] = []
    pending_review = [artifact for artifact in artifacts if artifact.review_status in {"submitted", "needs_review"}]

    for artifact in artifacts:
        chunk_count = _chunk_count_for_artifact(db, artifact.artifact_id)
        memory_count = _memory_count_for_artifact(db, artifact.artifact_id)
        if artifact.ingestion_status == "completed" and chunk_count == 0:
            zero_chunk.append(_artifact_issue(artifact, reason="ingestion completed but no chunks are indexed", chunk_count=0, memory_count=memory_count))
        if artifact.ingestion_status == "completed" and memory_count == 0:
            zero_memory.append(_artifact_issue(artifact, reason="ingestion completed but no structured memory was extracted", chunk_count=chunk_count, memory_count=0))

    status = _max_status([
        "warning" if pending_review else "healthy",
        "critical" if zero_chunk else "healthy",
        "warning" if zero_memory else "healthy",
    ])
    issues = [
        *zero_chunk[:8],
        *zero_memory[:8],
        *[
            _artifact_issue(
                artifact,
                reason="artifact is waiting for admin trust review",
                chunk_count=_chunk_count_for_artifact(db, artifact.artifact_id),
                memory_count=_memory_count_for_artifact(db, artifact.artifact_id),
            )
            for artifact in pending_review[:8]
        ],
    ]
    section = _section(
        status,
        "Artifacts and indexing coverage",
        "Lifecycle, trust review, chunk coverage, and structured-memory extraction coverage for stored artifacts.",
        {
            "total_artifacts": len(artifacts),
            "review_status_counts": dict(by_review),
            "ingestion_status_counts": dict(by_ingestion),
            "pending_review_count": len(pending_review),
            "completed_without_chunks": len(zero_chunk),
            "completed_without_memory": len(zero_memory),
            "latest_artifact_update": max((artifact.updated_at for artifact in artifacts), default=None),
        },
        issues,
    )
    return section, {"pending_review": len(pending_review), "zero_chunk": len(zero_chunk), "zero_memory": len(zero_memory)}, issues


def _memory_section(db: Session, workspace_id: str, artifact_ids: list[str]) -> dict[str, Any]:
    memory_counts: dict[str, int] = {}
    extraction_methods: Counter[str] = Counter()
    latest_memory_at: datetime | None = None
    for memory_type, model in MEMORY_MODELS:
        criteria = [model.workspace_id == workspace_id]
        if artifact_ids:
            criteria.append(model.source_artifact_id.in_(artifact_ids))
        memory_counts[memory_type] = _count_rows(db, model, *criteria)
        rows = db.execute(select(model.extraction_method, func.count()).where(*criteria).group_by(model.extraction_method)).all()
        extraction_methods.update({str(method or "unknown"): int(count) for method, count in rows})
        latest_for_type = _latest_datetime(db, model.updated_at, *criteria)
        if latest_for_type and (latest_memory_at is None or latest_for_type > latest_memory_at):
            latest_memory_at = latest_for_type

    chunk_count = _count_rows(db, ArtifactChunk, ArtifactChunk.workspace_id == workspace_id)
    chunk_metadata_rows = db.scalars(select(ArtifactChunk.chunk_metadata).where(ArtifactChunk.workspace_id == workspace_id)).all()
    fallback_chunks = [metadata for metadata in chunk_metadata_rows if isinstance(metadata, dict) and metadata.get("fallback_reason")]
    llm_chunks = [metadata for metadata in chunk_metadata_rows if isinstance(metadata, dict) and str(metadata.get("extraction_method", "")).startswith("llm")]

    total_memory = sum(memory_counts.values())
    status = "warning" if chunk_count > 0 and total_memory == 0 else "healthy"
    return _section(
        status,
        "Structured memory freshness",
        "Typed decisions, assumptions, constraints, outcomes, and commitments that the assistant can use independent of model strength.",
        {
            "chunk_count": chunk_count,
            "memory_object_count": total_memory,
            "memory_counts": memory_counts,
            "extraction_methods": dict(extraction_methods),
            "llm_extracted_chunk_count": len(llm_chunks),
            "fallback_chunk_count": len(fallback_chunks),
            "latest_memory_update": latest_memory_at,
        },
        [
            {
                "artifact_id": str(metadata.get("artifact_id", "unknown")),
                "title": str(metadata.get("title", "Chunk fallback")),
                "reason": str(metadata.get("fallback_reason")),
                "ingestion_status": str(metadata.get("extraction_status", "unknown")),
                "review_status": "unknown",
                "updated_at": None,
                "source_path": None,
                "chunk_count": None,
                "memory_object_count": None,
            }
            for metadata in fallback_chunks[:8]
        ],
    )


def _graph_signal_section(db: Session, workspace_id: str) -> dict[str, Any]:
    signal_counts = _count_by_value(db, Signal.signal_type, Signal.workspace_id == workspace_id, Signal.status == "active")
    graph_edge_counts = _count_by_value(db, GraphEdge.edge_type, GraphEdge.workspace_id == workspace_id)
    active_signals = sum(signal_counts.values())
    status = "warning" if active_signals == 0 else "healthy"
    return _section(
        status,
        "Graph, signals, and temporal claims",
        "Evidence-backed links, claim families, active signals, and freshness warnings generated from memory objects.",
        {
            "graph_edge_count": _count_rows(db, GraphEdge, GraphEdge.workspace_id == workspace_id),
            "graph_edge_counts": graph_edge_counts,
            "claim_family_count": _count_rows(db, ClaimFamily, ClaimFamily.workspace_id == workspace_id),
            "claim_occurrence_count": _count_rows(db, ClaimOccurrence, ClaimOccurrence.workspace_id == workspace_id),
            "active_signal_count": active_signals,
            "signal_counts": signal_counts,
            "latest_signal_update": _latest_datetime(db, Signal.updated_at, Signal.workspace_id == workspace_id),
        },
    )


def _worker_queue_section(db: Session, workspace_id: str, now: datetime) -> dict[str, Any]:
    jobs = db.scalars(
        select(OrchestrationJob)
        .where(OrchestrationJob.workspace_id == workspace_id)
        .order_by(OrchestrationJob.created_at.desc())
        .limit(12)
    ).all()
    status_counts = _count_by_value(db, OrchestrationJob.status, OrchestrationJob.workspace_id == workspace_id)
    expired_lease_count = _count_rows(
        db,
        OrchestrationJob,
        OrchestrationJob.workspace_id == workspace_id,
        OrchestrationJob.status == "claimed",
        OrchestrationJob.lease_expires_at.is_not(None),
        OrchestrationJob.lease_expires_at <= now,
    )
    claimable_count = _count_rows(
        db,
        OrchestrationJob,
        OrchestrationJob.workspace_id == workspace_id,
        OrchestrationJob.status.in_(CLAIMABLE_JOB_STATUSES),
        OrchestrationJob.available_at <= now,
    ) + expired_lease_count
    oldest_queued_at = db.scalar(
        select(func.min(OrchestrationJob.available_at)).where(
            OrchestrationJob.workspace_id == workspace_id,
            OrchestrationJob.status.in_(CLAIMABLE_JOB_STATUSES),
            OrchestrationJob.available_at <= now,
        )
    )
    failed_count = sum(count for status, count in status_counts.items() if status == "failed")
    status = _max_status([
        "critical" if expired_lease_count else "healthy",
        "warning" if failed_count else "healthy",
        "warning" if claimable_count and not expired_lease_count else "healthy",
    ])
    latest_jobs = [
        {
            "job_id": job.job_id,
            "job_kind": job.job_kind,
            "stage_key": job.stage_key,
            "status": job.status,
            "priority": job.priority,
            "lease_owner": job.lease_owner,
            "lease_expires_at": job.lease_expires_at,
            "available_at": job.available_at,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "completed_at": job.completed_at,
            "error_message": job.error_message,
        }
        for job in jobs
    ]
    return _section(
        status,
        "Worker queue and orchestration jobs",
        "DB-backed bounded jobs, claim leases, idle/queued state, and recent worker outcomes.",
        {
            "total_jobs": _count_rows(db, OrchestrationJob, OrchestrationJob.workspace_id == workspace_id),
            "status_counts": status_counts,
            "claimable_count": claimable_count,
            "expired_lease_count": expired_lease_count,
            "oldest_queued_age_seconds": _age_seconds(oldest_queued_at, now),
            "latest_job_update": _latest_datetime(db, OrchestrationJob.updated_at, OrchestrationJob.workspace_id == workspace_id),
            "latest_completed_at": _latest_datetime(db, OrchestrationJob.completed_at, OrchestrationJob.workspace_id == workspace_id),
            "terminal_statuses": sorted(TERMINAL_JOB_STATUSES),
        },
        [
            {
                "artifact_id": job["job_id"],
                "title": job["stage_key"] or job["job_kind"],
                "reason": job["error_message"] or ("lease expired" if job["status"] == "claimed" and job["lease_expires_at"] and job["lease_expires_at"] <= now else f"job status is {job['status']}"),
                "ingestion_status": job["status"],
                "review_status": "worker_queue",
                "updated_at": job["updated_at"],
                "source_path": None,
                "chunk_count": None,
                "memory_object_count": None,
            }
            for job in latest_jobs
            if job["status"] not in {"completed", "cancelled"}
        ][:8],
    ) | {"latest_jobs": latest_jobs}


def _llm_section() -> dict[str, Any]:
    status_payload = inspect_local_llm_status()
    feature_flags = status_payload.get("feature_flags") or {}
    enabled_features = sum(1 for enabled in feature_flags.values() if enabled)
    gateway_status = str(status_payload.get("gateway_status") or "unknown")
    status = "healthy" if gateway_status == "ready" else ("warning" if enabled_features else "healthy")
    return _section(
        status,
        "Local/private LLM gateway",
        "Configured inference gateway, enabled feature flags, model availability, and deterministic fallback boundary.",
        {
            "enabled": status_payload.get("enabled"),
            "configured_model": status_payload.get("configured_model"),
            "base_url": status_payload.get("base_url"),
            "gateway_reachable": status_payload.get("gateway_reachable"),
            "gateway_status": gateway_status,
            "configured_model_available": status_payload.get("configured_model_available"),
            "available_model_count": len(status_payload.get("available_models") or []),
            "enabled_feature_count": enabled_features,
            "feature_flags": feature_flags,
            "checked_at": status_payload.get("checked_at"),
            "error": status_payload.get("error"),
        },
        [
            {
                "artifact_id": "llm-gateway",
                "title": "LLM gateway",
                "reason": str(status_payload.get("error") or f"gateway status is {gateway_status}"),
                "ingestion_status": gateway_status,
                "review_status": "configuration",
                "updated_at": status_payload.get("checked_at"),
                "source_path": None,
                "chunk_count": None,
                "memory_object_count": None,
            }
        ] if status == "warning" else [],
    )


def _trace_section(db: Session, workspace_id: str) -> dict[str, Any]:
    query_run_count = _count_rows(db, QueryRun, QueryRun.workspace_id == workspace_id)
    trace_step_count = _count_rows(db, QueryTraceStep, QueryTraceStep.workspace_id == workspace_id)
    stage_run_count = _count_rows(db, OrchestrationStageRun, OrchestrationStageRun.workspace_id == workspace_id)
    scenario_run_count = _count_rows(db, ScenarioRun, ScenarioRun.workspace_id == workspace_id)
    status = "warning" if query_run_count and trace_step_count == 0 else "healthy"
    return _section(
        status,
        "Queries, traces, and replay evidence",
        "Stored query runs, trace packets, stage-run ledger rows, scenario replays, and ingestion jobs.",
        {
            "query_run_count": query_run_count,
            "trace_step_count": trace_step_count,
            "stage_run_count": stage_run_count,
            "scenario_run_count": scenario_run_count,
            "ingestion_job_count": _count_rows(db, IngestionJob, IngestionJob.workspace_id == workspace_id),
            "latest_query_run": _latest_datetime(db, QueryRun.created_at, QueryRun.workspace_id == workspace_id),
            "latest_trace_step": _latest_datetime(db, QueryTraceStep.created_at, QueryTraceStep.workspace_id == workspace_id),
            "latest_stage_run": _latest_datetime(db, OrchestrationStageRun.created_at, OrchestrationStageRun.workspace_id == workspace_id),
            "latest_scenario_run": _latest_datetime(db, ScenarioRun.created_at, ScenarioRun.workspace_id == workspace_id),
            "latest_ingestion_job": _latest_datetime(db, IngestionJob.updated_at, IngestionJob.workspace_id == workspace_id),
        },
    )


def _next_actions(sections: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    actions: list[dict[str, str]] = []
    storage = sections["database_storage"]
    artifacts = sections["artifact_index"]
    queue = sections["worker_queue"]
    llm = sections["llm"]

    if int(storage["metrics"].get("missing_sources") or 0) > 0:
        actions.append(
            {
                "severity": "critical",
                "title": "Repair missing artifact source files",
                "description": "The database still has artifact records, chunks, or memory, but at least one recorded source file is missing. Restore the mounted data directory or re-upload replacement artifacts before shipping.",
                "route": "/admin/data",
            }
        )
    if int(artifacts["metrics"].get("pending_review_count") or 0) > 0:
        actions.append(
            {
                "severity": "warning",
                "title": "Review pending artifacts",
                "description": "Submitted or needs-review artifacts can be visible, but they are not fully trusted. Review or reject them so institutional memory freshness is explicit.",
                "route": "/artifacts",
            }
        )
    if int(artifacts["metrics"].get("completed_without_chunks") or 0) > 0 or int(artifacts["metrics"].get("completed_without_memory") or 0) > 0:
        actions.append(
            {
                "severity": "warning",
                "title": "Re-run ingestion for coverage gaps",
                "description": "Some completed artifacts have no chunks or no structured memory. Re-run ingestion and inspect fallback reasons.",
                "route": "/ingestion",
            }
        )
    if int(queue["metrics"].get("expired_lease_count") or 0) > 0 or int(queue["metrics"].get("claimable_count") or 0) > 0:
        actions.append(
            {
                "severity": "warning",
                "title": "Inspect worker queue",
                "description": "Jobs are queued, retryable, or lease-expired. Confirm the worker daemon is running and then run the worker smoke gate.",
                "route": "/orchestration",
            }
        )
    if llm["status"] == "warning":
        actions.append(
            {
                "severity": "warning",
                "title": "Fix LLM gateway configuration",
                "description": "Private inference features are enabled but the configured gateway/model is not ready. Check Ollama/model availability or disable feature flags intentionally.",
                "route": "/admin",
            }
        )
    if not actions:
        actions.append(
            {
                "severity": "healthy",
                "title": "No immediate operator action required",
                "description": "Current read-only checks did not find storage, indexing, queue, or LLM blockers. Keep running smoke/eval gates before deployment.",
                "route": "/readiness",
            }
        )
    return actions


def build_operations_overview(db: Session, user: User) -> dict[str, Any]:
    now = _utcnow()
    artifacts = list(db.scalars(
        select(Artifact).where(Artifact.workspace_id == user.workspace_id).order_by(Artifact.updated_at.desc(), Artifact.created_at.desc())
    ).all())
    artifact_ids = [artifact.artifact_id for artifact in artifacts]

    database_storage, _missing_storage = _database_storage_section(db, user.workspace_id, artifacts)
    artifact_index, _coverage_counts, _coverage_issues = _artifact_index_section(db, artifacts)
    sections = {
        "database_storage": database_storage,
        "artifact_index": artifact_index,
        "memory_freshness": _memory_section(db, user.workspace_id, artifact_ids),
        "graph_signals": _graph_signal_section(db, user.workspace_id),
        "worker_queue": _worker_queue_section(db, user.workspace_id, now),
        "llm": _llm_section(),
        "traces": _trace_section(db, user.workspace_id),
    }
    overall_status = _max_status([str(section["status"]) for section in sections.values()])
    health_score = round(sum({"healthy": 1.0, "warning": 0.65, "critical": 0.25}.get(str(section["status"]), 0.5) for section in sections.values()) / len(sections), 4)
    warnings = [section["title"] for section in sections.values() if section["status"] in WARNING_STATUSES]

    return {
        "workspace_id": user.workspace_id,
        "generated_at": now,
        "schema_version": "operations_overview.v1",
        "overall_status": overall_status,
        "health_score": health_score,
        "summary": {
            "warning_count": len(warnings),
            "warnings": warnings,
            "section_count": len(sections),
            "admin_only": True,
        },
        "sections": sections,
        "next_actions": _next_actions(sections),
        "links": [
            {"label": "Data and storage", "route": "/admin/data", "description": "Inspect table rows, raw admin-only paths, artifact storage, and safe metadata edits."},
            {"label": "Artifacts", "route": "/artifacts", "description": "Upload evidence, update review state, and manage visibility."},
            {"label": "Ingestion", "route": "/ingestion", "description": "Run extraction against artifacts with missing chunks or memory."},
            {"label": "Memory filesystem", "route": "/memory-filesystem", "description": "Inspect logical artifact locators, trust boundaries, and coverage notes."},
            {"label": "Jobs", "route": "/orchestration", "description": "Inspect stage catalog, worker queue jobs, and scenario replay."},
            {"label": "Readiness", "route": "/readiness", "description": "Compare current proof signals against product readiness promises."},
            {"label": "Audit", "route": "/audit", "description": "Review governance events and user actions."},
        ],
    }
