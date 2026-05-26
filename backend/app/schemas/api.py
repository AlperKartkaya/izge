from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: "UserRead"


class SignInRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str


class UserBase(BaseModel):
    display_name: str
    email: str = Field(min_length=3, max_length=255)
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
    review_status: str = "submitted"
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    review_notes: str | None = None
    created_at: datetime
    updated_at: datetime


class ArtifactPermissionUpdate(BaseModel):
    visibility_scope: Literal["workspace", "restricted"]
    permitted_user_ids: list[str] = Field(default_factory=list)


class ArtifactReviewUpdate(BaseModel):
    review_status: Literal["submitted", "needs_review", "reviewed", "rejected"]
    review_notes: str | None = Field(default=None, max_length=1200)


class ArtifactMetadataUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class PastedTextCreate(BaseModel):
    title: str
    text: str = Field(min_length=1)
    visibility_scope: Literal["workspace", "restricted"] = "workspace"
    permitted_user_ids: list[str] = Field(default_factory=list)


class ArtifactDetail(ArtifactRead):
    extracted_text_preview: str | None = None
    chunk_count: int = 0
    permitted_user_ids: list[str] = Field(default_factory=list)
    chunk_provenance: list["ArtifactChunkProvenance"] = Field(default_factory=list)


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


class ArtifactChunkProvenance(BaseModel):
    chunk_id: str
    sequence_number: int
    extraction_method: str
    extraction_status: str
    extracted_object_count: int
    fallback_reason: str | None = None
    chunk_excerpt: str


class EvidenceReference(BaseModel):
    artifact_id: str
    artifact_title: str
    artifact_review_status: str = "submitted"
    chunk_id: str | None = None
    excerpt: str
    evidence_kind: Literal["graph", "search_fallback"] = "graph"


class MemoryReference(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    confidence_score: float
    source_artifact_id: str
    source_artifact_review_status: str = "submitted"
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
    related_signals: list["SignalRead"] = Field(default_factory=list)
    uncertainty_notes: list[str]
    permissions_limited: bool
    created_at: datetime


class QueryTraceEvidence(BaseModel):
    artifact_id: str
    artifact_title: str
    chunk_id: str | None = None
    evidence_kind: str | None = None
    excerpt: str | None = None
    why_selected: str | None = None


class QueryTraceMemory(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    source_artifact_id: str


class QueryTraceStepRead(BaseModel):
    step_kind: str
    payload: dict[str, Any]
    created_at: datetime


class QueryTraceRead(BaseModel):
    query_run_id: str
    query_class: str
    route_confidence: float
    permissions_limited: bool
    steps: list[QueryTraceStepRead]

class LocalLLMFeatureFlags(BaseModel):
    extraction: bool
    query_routing: bool
    answer_synthesis: bool
    signal_explanation: bool


class LocalLLMStatusRead(BaseModel):
    enabled: bool
    configured_model: str
    base_url: str
    timeout_seconds: int
    feature_flags: LocalLLMFeatureFlags
    gateway_reachable: bool
    gateway_status: Literal["disabled", "unreachable", "model_missing", "ready"]
    available_models: list[str] = Field(default_factory=list)
    configured_model_available: bool
    checked_at: datetime
    error: str | None = None


class LocalLLMSmokeRead(BaseModel):
    status: Literal["passed", "failed", "skipped"]
    model: str
    duration_ms: int
    message: str
    checked_at: datetime
    error: str | None = None


class GraphSummary(BaseModel):
    workspace_id: str
    artifact_count: int
    memory_counts: dict[str, int]
    edge_counts: dict[str, int]
    signal_counts: dict[str, int] = Field(default_factory=dict)


class GraphTimelineItem(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    event_timestamp: datetime
    timeline_status: str
    topic_key: str
    source_artifact_id: str
    source_artifact_title: str
    source_chunk_id: str | None
    evidence_span: str | None = None
    owner_label: str | None = None
    due_date: datetime | None = None
    contradiction_count: int = 0
    supersedes_count: int = 0
    related_count: int = 0


class GraphTimeline(BaseModel):
    workspace_id: str
    items: list[GraphTimelineItem]


class GraphNeighborhoodNeighbor(BaseModel):
    edge_id: str
    edge_type: str
    direction: Literal["incoming", "outgoing"]
    related_memory_type: str
    related_memory_id: str
    related_title_or_label: str
    related_topic_key: str
    related_status: str | None = None
    evidence_artifact_id: str | None = None
    evidence_artifact_title: str | None = None
    evidence_chunk_id: str | None = None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    confidence_score: float


class GraphNeighborhood(BaseModel):
    center_memory_type: str
    center_memory_id: str
    center_title_or_label: str
    center_topic_key: str
    center_event_timestamp: datetime
    neighbors: list[GraphNeighborhoodNeighbor]


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
    extraction_method: str = "heuristic"
    source_artifact_title: str | None = None
    source_artifact_review_status: str = "submitted"
    source_chunk_excerpt: str | None = None
    extraction_fallback_reason: str | None = None


class ContradictionEvidence(BaseModel):
    artifact_id: str
    artifact_title: str
    artifact_review_status: str = "submitted"
    chunk_id: str | None = None
    excerpt: str
    provenance: str
    time_label: str


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
    evidence_artifact_review_status: str | None = None
    evidence_chunk_id: str | None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    from_evidence: ContradictionEvidence
    to_evidence: ContradictionEvidence
    topic_key: str
    ranking_basis: list[str] = Field(default_factory=list)
    uncertainty_note: str | None = None


class AssumptionDriftItem(BaseModel):
    assumption_id: str
    title_or_label: str
    status: str
    validity_notes: str | None
    source_artifact_id: str
    source_artifact_review_status: str = "submitted"
    confidence_score: float
    topic_key: str
    supporting_signal_source_artifact_id: str | None = None
    supporting_signal_artifact_review_status: str | None = None
    supporting_signal_title: str | None = None
    supporting_signal_type: str | None = None
    supporting_signal_memory_id: str | None = None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    ranking_basis: list[str] = Field(default_factory=list)
    uncertainty_note: str | None = None


class NextActionSignalItem(BaseModel):
    signal_id: str
    signal_type: Literal["next_action"] = "next_action"
    title: str
    summary: str
    related_topic: str
    urgency_score: float
    uncertainty_score: float
    grounded_reasoning: str
    recommended_action: str
    supporting_memory_objects: list[MemoryReference] = Field(default_factory=list)
    supporting_evidence: list[EvidenceReference] = Field(default_factory=list)
    source_signal_types: list[str] = Field(default_factory=list)
    ranking_basis: list[str] = Field(default_factory=list)


class SupersessionItem(BaseModel):
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
    evidence_artifact_title: str | None = None
    evidence_artifact_review_status: str | None = None
    evidence_chunk_id: str | None
    evidence_span: str | None = None
    evidence_provenance: str | None = None
    topic_key: str
    ranking_basis: list[str] = Field(default_factory=list)


class PriorRelevantWorkItem(BaseModel):
    prior_artifact_id: str
    prior_artifact_title: str
    prior_artifact_review_status: str = "submitted"
    related_topic: str
    overlap_score: float
    continuity_reason: str
    recommended_action: str
    introduced_memory_objects: list[MemoryReference] = Field(default_factory=list)
    prior_memory_objects: list[MemoryReference] = Field(default_factory=list)
    supporting_evidence: list[EvidenceReference] = Field(default_factory=list)
    ranking_basis: list[str] = Field(default_factory=list)


class ArtifactProactiveSignals(BaseModel):
    artifact_id: str
    artifact_title: str
    ingestion_status: str
    summary: str
    signal_counts: dict[str, int]
    introduced_contradictions: list[ContradictionItem] = Field(default_factory=list)
    revealed_assumption_drift: list[AssumptionDriftItem] = Field(default_factory=list)
    superseded_memory: list[SupersessionItem] = Field(default_factory=list)
    prior_relevant_work: list[PriorRelevantWorkItem] = Field(default_factory=list)
    recommended_next_actions: list[NextActionSignalItem] = Field(default_factory=list)
    persisted_signals: list["SignalRead"] = Field(default_factory=list)


class SignalRead(BaseModel):
    signal_id: str
    workspace_id: str
    source_artifact_id: str | None = None
    source_artifact_title: str | None = None
    signal_type: str
    title: str
    summary: str
    related_topic: str
    urgency_score: float
    uncertainty_score: float
    grounded_reasoning: str
    recommended_action: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class SignalIntelligenceStep(BaseModel):
    step_kind: str
    title: str
    description: str
    supporting_evidence: list[EvidenceReference] = Field(default_factory=list)
    supporting_memory_objects: list[MemoryReference] = Field(default_factory=list)


class SignalDetail(SignalRead):
    payload_json: dict[str, Any] = Field(default_factory=dict)
    supporting_memory_objects: list[MemoryReference] = Field(default_factory=list)
    supporting_evidence: list[EvidenceReference] = Field(default_factory=list)
    intelligence_path: list[SignalIntelligenceStep] = Field(default_factory=list)


class TemporalGraphOccurrence(BaseModel):
    occurrence_id: str
    family_id: str
    memory_type: str
    memory_id: str
    claim_family_key: str
    title_or_label: str
    observed_at: datetime
    valid_from: datetime
    valid_to: datetime | None = None
    source_artifact_id: str
    source_artifact_title: str
    source_chunk_id: str | None = None
    evidence_span: str | None = None
    status: str
    confidence_score: float


class TemporalClaimFamilyRead(BaseModel):
    family_id: str
    claim_family_key: str
    memory_type: str
    title_or_label: str
    status: str
    first_seen_at: datetime
    latest_seen_at: datetime
    active_occurrence_id: str | None = None
    occurrence_count: int


class TemporalGraphLink(BaseModel):
    edge_id: str
    edge_type: str
    from_occurrence_id: str
    to_occurrence_id: str
    evidence_artifact_id: str | None = None
    evidence_chunk_id: str | None = None
    confidence_score: float


class TemporalGraphRead(BaseModel):
    workspace_id: str
    families: list[TemporalClaimFamilyRead] = Field(default_factory=list)
    occurrences: list[TemporalGraphOccurrence]
    links: list[TemporalGraphLink]
    sync_summary: dict[str, Any] = Field(default_factory=dict)


class ScenarioImpactRequest(BaseModel):
    scenario_text: str = Field(min_length=3, max_length=4000)
    limit: int = Field(default=10, ge=1, le=25)


class ScenarioTemplateRead(BaseModel):
    template_key: str
    title: str
    confidence_score: float
    matched_terms: list[str]
    review_lens: list[str]
    example_prompts: list[str]


class ScenarioTemplateCatalogItem(BaseModel):
    template_catalog_version: str
    template_key: str
    title: str
    keywords: list[str]
    review_lens: list[str]
    example_prompts: list[str]


class ScenarioMemoryRef(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    source_artifact_id: str
    source_chunk_id: str | None
    confidence_score: float
    matched_terms: list[str]
    ranking_key: list[str]


class ScenarioEvidenceRef(BaseModel):
    artifact_id: str
    artifact_title: str
    artifact_review_status: str
    chunk_id: str | None
    excerpt: str
    excerpt_hash: str


class ScenarioCandidateSnapshotItem(ScenarioMemoryRef):
    evidence_excerpt_hash: str
    source_artifact_review_status: str


class ScenarioOmittedReason(BaseModel):
    reason: Literal["permission_hidden_or_rejected", "scenario_budget"]
    count: int = Field(ge=0)


class ScenarioEvidenceBudget(BaseModel):
    max_impacted_memory: int = Field(ge=1)
    selected_memory_count: int = Field(ge=0)
    candidate_memory_count: int = Field(ge=0)
    selected_artifact_count: int = Field(ge=0)
    visible_artifact_count: int = Field(ge=0)
    within_budget: bool


ScenarioRankingScoreComponentName = Literal["matched_scenario_terms", "selected_template_confidence_boost"]
ScenarioRankingSortField = Literal["confidence_score", "memory_type", "source_artifact_id", "source_chunk_id", "memory_id"]
ScenarioDeterministicInput = Literal[
    "scenario_text_hash",
    "classifier_version",
    "template_catalog_version",
    "ranking_recipe",
    "candidate_snapshot_hash",
    "current_user_artifact_permissions",
]


class ScenarioRankingScoreComponent(BaseModel):
    name: ScenarioRankingScoreComponentName
    weight: float
    direction: Literal["asc", "desc"]


class ScenarioRankingSort(BaseModel):
    field: ScenarioRankingSortField
    direction: Literal["asc", "desc"]
    null_value: str | None = None


class ScenarioRankingRecipe(BaseModel):
    recipe_version: Literal["scenario_ranking_recipe.v1"]
    score_components: list[ScenarioRankingScoreComponent]
    primary_sort: ScenarioRankingSort
    tie_breakers: list[ScenarioRankingSort]


class ScenarioReplayContract(BaseModel):
    deterministic_inputs: list[ScenarioDeterministicInput]
    input_snapshot_hash: str
    candidate_snapshot_hash: str
    selection_recipe: ScenarioRankingRecipe
    replay_mode: Literal["deterministic_selection_summary"]
    replay_requires_current_permissions: bool
    trusted_write_allowed: Literal[False] = False
    forecasting_allowed: Literal[False] = False


class ScenarioContextPacketRead(BaseModel):
    schema_version: Literal["scenario_context_packet.v1"]
    packet_type: Literal["bounded_scenario_impact"]
    packet_id: str
    scenario_text_hash: str
    classifier_version: str
    template_catalog_version: str
    ranking_recipe: ScenarioRankingRecipe
    candidate_snapshot_hash: str
    input_snapshot_hash: str
    selected_template_key: str
    scenario_terms: list[str]
    selected_memory_ids: list[str]
    selected_memory_refs: list[ScenarioMemoryRef]
    candidate_memory_snapshot: list[ScenarioCandidateSnapshotItem]
    selected_artifact_ids: list[str]
    selected_evidence_refs: list[ScenarioEvidenceRef]
    omitted_reasons: list[ScenarioOmittedReason]
    evidence_budget: ScenarioEvidenceBudget
    replay_contract: ScenarioReplayContract


class ScenarioImpactItem(BaseModel):
    memory_type: str
    memory_id: str
    title_or_label: str
    impact_reason: str
    matched_terms: list[str] = Field(default_factory=list)
    source_artifact_id: str
    source_artifact_title: str
    source_chunk_id: str | None = None
    confidence_score: float
    evidence_excerpt: str


class ScenarioImpactRead(BaseModel):
    scenario_text: str
    scenario_template: ScenarioTemplateRead
    candidate_templates: list[ScenarioTemplateRead]
    scenario_packet: ScenarioContextPacketRead
    scenario_run_id: str | None = None
    answer_text: str
    impacted_memory: list[ScenarioImpactItem]
    recommended_questions: list[str]
    uncertainty_notes: list[str]


class ScenarioRunSummaryRead(BaseModel):
    scenario_run_id: str
    scenario_text_hash: str
    packet_id: str
    selected_template_key: str
    selected_memory_count: int
    candidate_memory_count: int
    replay_verdict: str
    created_at: datetime


class ScenarioRunRead(BaseModel):
    scenario_run_id: str
    workspace_id: str
    created_by: str
    scenario_text: str
    scenario_text_hash: str
    packet_id: str
    selected_template_key: str
    input_snapshot_hash: str
    candidate_snapshot_hash: str
    result_payload: ScenarioImpactRead
    replay_summary: dict[str, Any]
    created_at: datetime


class ScenarioRunListRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    runs: list[ScenarioRunSummaryRead]


class ScenarioReplayRead(BaseModel):
    scenario_run_id: str
    replayed_at: datetime
    verdict: Literal["stable", "changed", "permission_limited"]
    original_packet_id: str
    current_packet_id: str
    original_template_key: str
    current_template_key: str
    input_snapshot_changed: bool
    candidate_snapshot_changed: bool
    selected_memory_kept: list[str]
    selected_memory_added: list[str]
    selected_memory_removed: list[str]
    summary: str
    current_result: ScenarioImpactRead


class MemoryFilesystemRoot(BaseModel):
    node_id: str
    label: str
    node_type: str
    status: str
    description: str
    children_count: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryFilesystemArtifact(BaseModel):
    artifact_id: str
    title: str
    source_type: str
    storage_locator: str
    checksum_sha256: str | None = None
    mime_type: str
    visibility_scope: str
    ingestion_status: str
    review_status: str
    created_at: datetime
    updated_at: datetime
    chunk_count: int
    memory_counts: dict[str, int]
    graph_edge_count: int
    signal_count: int
    organization_path: list[str]
    retrieval_state: str
    trust_boundary: str
    coverage_notes: list[str] = Field(default_factory=list)


class DatabaseBlueprintLayer(BaseModel):
    layer: str
    table_names: list[str]
    purpose: str
    write_path: str
    read_path: str
    organization_rule: str


class OrganizationGuideStep(BaseModel):
    step: str
    title: str
    description: str


class MemoryFilesystemRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    roots: list[MemoryFilesystemRoot]
    artifacts: list[MemoryFilesystemArtifact]
    database_blueprint: list[DatabaseBlueprintLayer]
    organization_guide: list[OrganizationGuideStep]


class OrchestrationStageRead(BaseModel):
    stage_key: str
    title: str
    agent_role: str
    purpose: str
    inputs: list[str]
    outputs: list[str]
    deterministic_gate: str
    authority_level: str
    current_reflection: str
    status: str


class OrchestrationBlueprintRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    execution_model: str
    current_runtime_note: str
    stage_catalog: list[OrchestrationStageRead]
    spawn_policy: list[str]
    current_reflection: dict[str, Any]


class OrchestrationStageRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stage_run_id: str
    query_run_id: str
    workspace_id: str
    stage_key: str
    status: str
    authority_level: str
    verifier_status: str | None = None
    input_refs: dict[str, Any]
    output_summary: dict[str, Any]
    created_at: datetime


class OrchestrationStageRunsRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    query_run_id: str | None = None
    runs: list[OrchestrationStageRunRead]


class OrchestrationJobCreate(BaseModel):
    job_kind: str = Field(default="stage_packet", min_length=1, max_length=64)
    stage_key: str | None = Field(default=None, max_length=64)
    query_run_id: str | None = None
    priority: int = Field(default=100, ge=0, le=10000)
    payload_json: dict[str, Any] = Field(default_factory=dict)


class OrchestrationJobClaimRequest(BaseModel):
    worker_id: str = Field(min_length=1, max_length=255)
    lease_seconds: int = Field(default=90, ge=10, le=3600)


class OrchestrationJobCompleteRequest(BaseModel):
    status: Literal["completed", "failed", "cancelled"] = "completed"
    result_json: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = Field(default=None, max_length=2000)


class OrchestrationJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    workspace_id: str
    created_by: str
    query_run_id: str | None
    job_kind: str
    stage_key: str | None
    status: str
    priority: int
    payload_json: dict[str, Any]
    result_json: dict[str, Any]
    error_message: str | None
    lease_owner: str | None
    lease_expires_at: datetime | None
    available_at: datetime
    claimed_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class OrchestrationJobListRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    jobs: list[OrchestrationJobRead]


class DatabaseTableRead(BaseModel):
    table_name: str
    row_count: int
    write_surface: str
    read_surface: str


class ArtifactStorageAdminRead(BaseModel):
    artifact_id: str
    title: str
    source_type: str
    logical_locator: str
    source_path: str
    storage_exists: bool
    byte_size: int | None
    checksum_sha256: str | None
    mime_type: str
    ingestion_status: str
    review_status: str
    visibility_scope: str
    chunk_count: int
    memory_object_count: int
    updated_at: datetime


class DatabaseOverviewRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    sqlite_path: str
    storage_root: str
    pasted_text_root: str
    alembic_revision: str | None
    tables: list[DatabaseTableRead]
    artifacts: list[ArtifactStorageAdminRead]
    management_notes: list[str]


ReadinessAreaStatus = Literal["implemented", "partial", "planned"]


class TargetReadinessProofSignal(BaseModel):
    label: str
    value: str
    route: str | None = None


class TargetReadinessAreaRead(BaseModel):
    area_key: str
    title: str
    status: ReadinessAreaStatus
    score: float = Field(ge=0, le=1)
    promise: str
    demo_reflection: str
    evidence_routes: list[str]
    demo_surfaces: list[str]
    proof_signals: list[TargetReadinessProofSignal]
    remaining_work: list[str]
    risks: list[str] = Field(default_factory=list)


class TargetReadinessRead(BaseModel):
    workspace_id: str
    generated_at: datetime
    schema_version: Literal["target_readiness.v1"]
    target_score: float = Field(ge=0, le=1)
    status_counts: dict[str, int]
    current_workspace_snapshot: dict[str, Any]
    areas: list[TargetReadinessAreaRead]
    next_best_passes: list[str]
    evaluator_gate: dict[str, Any]


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
ArtifactDetail.model_rebuild()
QueryResult.model_rebuild()
ArtifactProactiveSignals.model_rebuild()
