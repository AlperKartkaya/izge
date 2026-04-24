from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: "UserRead"


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class UserBase(BaseModel):
    display_name: str
    email: EmailStr
    role: Literal["Admin", "Member"]
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: Literal["Admin", "Member"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    workspace_id: str
    created_at: datetime


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    artifact_id: str
    workspace_id: str
    title: str
    source_type: str
    mime_type: str
    uploaded_by: str
    visibility_scope: str
    original_filename: str | None
    checksum_sha256: str | None
    ingestion_status: str
    created_at: datetime
    updated_at: datetime


class ArtifactPermissionUpdate(BaseModel):
    visibility_scope: Literal["workspace", "restricted"]
    permitted_user_ids: list[str] = Field(default_factory=list)


class PastedTextCreate(BaseModel):
    title: str
    text: str = Field(min_length=1)
    visibility_scope: Literal["workspace", "restricted"] = "workspace"
    permitted_user_ids: list[str] = Field(default_factory=list)


class ArtifactDetail(ArtifactRead):
    extracted_text_preview: str | None = None
    chunk_count: int = 0
    permitted_user_ids: list[str] = Field(default_factory=list)


class IngestionRunCreate(BaseModel):
    artifact_id: str


class IngestionJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    workspace_id: str
    artifact_id: str
    created_by: str
    status: str
    stage: str
    detail: str | None
    created_at: datetime
    updated_at: datetime


class EvidenceReference(BaseModel):
    artifact_id: str
    artifact_title: str
    chunk_id: str | None = None
    excerpt: str
    evidence_kind: Literal["graph", "search_fallback"] = "graph"


class MemoryReference(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    confidence_score: float
    source_artifact_id: str
    topic_key: str
    status: str | None = None
    due_date: datetime | None = None
    owner_label: str | None = None


class QueryCreate(BaseModel):
    query_text: str = Field(min_length=3)


class QueryResult(BaseModel):
    query_run_id: str
    query_text: str
    query_class: str
    status: str
    answer_text: str
    why_this_answer: str
    answer_type: str = "institutional_memory_response"
    supporting_nodes: list[MemoryReference]
    supporting_evidence: list[EvidenceReference]
    contradictions: list[dict[str, Any]]
    stale_assumptions: list[dict[str, Any]]
    recommended_next_actions: list[str]
    uncertainty_notes: list[str]
    permissions_limited: bool
    created_at: datetime


class GraphSummary(BaseModel):
    workspace_id: str
    artifact_count: int
    memory_counts: dict[str, int]
    edge_counts: dict[str, int]


class MemoryDetail(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    normalized_text: str
    confidence_score: float
    event_timestamp: datetime
    source_artifact_id: str
    source_chunk_id: str | None
    evidence_span: str | None
    status: str | None = None
    due_date: datetime | None = None
    owner_label: str | None = None


class ContradictionItem(BaseModel):
    edge_id: str
    from_node_id: str
    to_node_id: str
    from_type: str
    to_type: str
    from_title: str
    to_title: str
    relation_label: str
    confidence_score: float
    evidence_artifact_id: str | None
    evidence_chunk_id: str | None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    topic_key: str
    ranking_basis: list[str] = Field(default_factory=list)
    uncertainty_note: str | None = None


class AssumptionDriftItem(BaseModel):
    assumption_id: str
    title_or_label: str
    status: str
    validity_notes: str | None
    source_artifact_id: str
    confidence_score: float
    topic_key: str
    supporting_signal_title: str | None = None
    supporting_signal_type: str | None = None
    supporting_signal_memory_id: str | None = None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    ranking_basis: list[str] = Field(default_factory=list)
    uncertainty_note: str | None = None


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: str
    workspace_id: str
    actor_user_id: str | None
    event_type: str
    target_type: str
    target_id: str
    event_metadata: dict[str, Any]
    timestamp: datetime


TokenResponse.model_rebuild()
