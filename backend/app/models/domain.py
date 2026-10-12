from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Workspace(Base):
    __tablename__ = "workspace"

    workspace_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ws"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("public_demo_visitor_hash", "public_demo_persona", name="uq_public_demo_visitor_persona"),)

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("usr"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_public_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    public_demo_persona: Mapped[str | None] = mapped_column(String(32), index=True)
    public_demo_ip_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    public_demo_visitor_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class UserSession(Base):
    __tablename__ = "user_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ses"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class PublicDemoQuota(Base):
    __tablename__ = "public_demo_quotas"
    __table_args__ = (UniqueConstraint("ip_hash", "window_started_at", name="uq_public_demo_quota_ip_window"),)

    quota_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("pdq"))
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    request_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Artifact(Base, TimestampMixin):
    __tablename__ = "artifacts"

    artifact_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("art"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    visibility_scope: Mapped[str] = mapped_column(String(32), default="workspace", nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    ingestion_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    review_status: Mapped[str] = mapped_column(String(32), default="submitted", nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.user_id"), nullable=True, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    review_notes: Mapped[str | None] = mapped_column(Text)


class ArtifactPermission(Base):
    __tablename__ = "artifact_permissions"
    __table_args__ = (UniqueConstraint("artifact_id", "user_id", name="uq_artifact_permission"),)

    permission_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("perm"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.artifact_id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    granted_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ArtifactChunk(Base):
    __tablename__ = "artifact_chunks"

    chunk_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("chk"))
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.artifact_id"), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MemoryMixin:
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    source_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.artifact_id"), nullable=False, index=True)
    source_chunk_id: Mapped[str | None] = mapped_column(ForeignKey("artifact_chunks.chunk_id"), index=True)
    evidence_span: Mapped[str | None] = mapped_column(String(255))
    confidence_score: Mapped[float] = mapped_column(Float, default=0.35, nullable=False)
    event_timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False)
    title_or_label: Mapped[str] = mapped_column(String(255), nullable=False)
    topic_key: Mapped[str] = mapped_column(String(255), default="general", nullable=False, index=True)
    extraction_method: Mapped[str] = mapped_column(String(64), default="heuristic", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Decision(Base, MemoryMixin):
    __tablename__ = "decisions"

    decision_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("dec"))
    status: Mapped[str] = mapped_column(String(32), default="noted", nullable=False)


class Assumption(Base, MemoryMixin):
    __tablename__ = "assumptions"

    assumption_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("asm"))
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    validity_notes: Mapped[str | None] = mapped_column(Text)


class Constraint(Base, MemoryMixin):
    __tablename__ = "constraints"

    constraint_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("con"))
    category: Mapped[str] = mapped_column(String(64), default="general", nullable=False)


class Outcome(Base, MemoryMixin):
    __tablename__ = "outcomes"

    outcome_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("out"))
    outcome_type: Mapped[str] = mapped_column(String(64), default="observed", nullable=False)


class Commitment(Base, MemoryMixin):
    __tablename__ = "commitments"

    commitment_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("com"))
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False)
    owner_label: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[datetime | None] = mapped_column(DateTime)


class CompanyChatMessage(Base):
    __tablename__ = "company_chat_messages"

    message_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("msg"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    author_user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    message_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("job"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.artifact_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    stage: Mapped[str] = mapped_column(String(64), default="queued", nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class QueryRun(Base):
    __tablename__ = "query_runs"

    query_run_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("qry"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    query_class: Mapped[str] = mapped_column(String(64), nullable=False)
    route_confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    permissions_limited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class QueryTraceStep(Base):
    __tablename__ = "query_trace_steps"

    trace_step_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("qts"))
    query_run_id: Mapped[str] = mapped_column(ForeignKey("query_runs.query_run_id"), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    step_kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class OrchestrationStageRun(Base):
    __tablename__ = "orchestration_stage_runs"

    stage_run_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("osr"))
    query_run_id: Mapped[str] = mapped_column(ForeignKey("query_runs.query_run_id"), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    stage_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    authority_level: Mapped[str] = mapped_column(String(64), nullable=False)
    verifier_status: Mapped[str | None] = mapped_column(String(32), index=True)
    input_refs: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    output_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class OrchestrationJob(Base):
    __tablename__ = "orchestration_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ojb"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    query_run_id: Mapped[str | None] = mapped_column(ForeignKey("query_runs.query_run_id"), nullable=True, index=True)
    job_kind: Mapped[str] = mapped_column(String(64), default="stage_packet", nullable=False, index=True)
    stage_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False, index=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    lease_owner: Mapped[str | None] = mapped_column(String(255), index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ScenarioRun(Base):
    __tablename__ = "scenario_runs"

    scenario_run_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("scr"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    scenario_text: Mapped[str] = mapped_column(Text, nullable=False)
    scenario_text_hash: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    packet_id: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    selected_template_key: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    input_snapshot_hash: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    candidate_snapshot_hash: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    scenario_packet: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    replay_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class ClaimFamily(Base, TimestampMixin):
    __tablename__ = "claim_families"
    __table_args__ = (UniqueConstraint("workspace_id", "claim_family_key", name="uq_claim_family_workspace_key"),)

    family_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("clf"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    claim_family_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    memory_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title_or_label: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    latest_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    active_occurrence_id: Mapped[str | None] = mapped_column(String(64), index=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ClaimOccurrence(Base, TimestampMixin):
    __tablename__ = "claim_occurrences"
    __table_args__ = (UniqueConstraint("workspace_id", "memory_type", "memory_id", name="uq_claim_occurrence_memory"),)

    occurrence_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("clo"))
    family_id: Mapped[str] = mapped_column(ForeignKey("claim_families.family_id"), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    memory_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    memory_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.artifact_id"), nullable=False, index=True)
    source_chunk_id: Mapped[str | None] = mapped_column(ForeignKey("artifact_chunks.chunk_id"), index=True)
    title_or_label: Mapped[str] = mapped_column(String(255), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.35, nullable=False)
    evidence_span: Mapped[str | None] = mapped_column(String(255))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class Signal(Base, TimestampMixin):
    __tablename__ = "signals"

    signal_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("sig"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    source_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifacts.artifact_id"), index=True)
    signal_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    related_topic: Mapped[str] = mapped_column(String(255), default="general", nullable=False, index=True)
    urgency_score: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    uncertainty_score: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    grounded_reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str | None] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False, index=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("evt"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.user_id"), index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    event_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class GraphNode(Base):
    __tablename__ = "graph_nodes"

    node_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("node"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    node_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title_or_label: Mapped[str] = mapped_column(String(255), nullable=False)
    visibility_scope: Mapped[str] = mapped_column(String(32), default="workspace", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    edge_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("edge"))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspace.workspace_id"), nullable=False, index=True)
    from_node_id: Mapped[str] = mapped_column(ForeignKey("graph_nodes.node_id"), nullable=False, index=True)
    to_node_id: Mapped[str] = mapped_column(ForeignKey("graph_nodes.node_id"), nullable=False, index=True)
    edge_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    evidence_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifacts.artifact_id"), index=True)
    evidence_chunk_id: Mapped[str | None] = mapped_column(ForeignKey("artifact_chunks.chunk_id"), index=True)
    evidence_span: Mapped[str | None] = mapped_column(String(255))
    confidence_score: Mapped[float] = mapped_column(Float, default=0.35, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
