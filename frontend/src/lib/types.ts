export type UserRole = 'Admin' | 'Member'

export interface UserRead {
  user_id: string
  workspace_id: string
  display_name: string
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_at: string
  user: UserRead
}

export interface ArtifactRead {
  artifact_id: string
  workspace_id: string
  title: string
  source_type: string
  source_path: string
  mime_type: string
  uploaded_by: string
  visibility_scope: 'workspace' | 'restricted'
  original_filename: string | null
  checksum_sha256: string | null
  ingestion_status: string
  review_status: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
  updated_at: string
}

export interface ArtifactDetail extends ArtifactRead {
  extracted_text_preview: string | null
  chunk_count: number
  permitted_user_ids: string[]
  chunk_provenance: ArtifactChunkProvenance[]
}

export interface IngestionJobRead {
  job_id: string
  workspace_id: string
  artifact_id: string
  created_by: string
  status: string
  stage: string
  detail: string | null
  created_at: string
  updated_at: string
}

export interface ArtifactChunkProvenance {
  chunk_id: string
  sequence_number: number
  extraction_method: string
  extraction_status: string
  extracted_object_count: number
  fallback_reason: string | null
  chunk_excerpt: string
}

export interface EvidenceReference {
  artifact_id: string
  artifact_title: string
  artifact_review_status: string
  chunk_id: string | null
  excerpt: string
  evidence_kind: 'graph' | 'search_fallback'
}

export interface MemoryReference {
  memory_type: string
  memory_id: string
  title_or_label: string
  confidence_score: number
  source_artifact_id: string
  source_artifact_review_status: string
  topic_key: string
  status: string | null
  due_date: string | null
  owner_label: string | null
}

export interface QueryResult {
  query_run_id: string
  query_text: string
  query_class: string
  status: string
  answer_text: string
  why_this_answer: string
  answer_type: string
  supporting_nodes: MemoryReference[]
  supporting_evidence: EvidenceReference[]
  contradictions: Array<Record<string, unknown>>
  stale_assumptions: Array<Record<string, unknown>>
  recommended_next_actions: string[]
  related_signals: SignalRead[]
  uncertainty_notes: string[]
  permissions_limited: boolean
  created_at: string
}

export interface QueryTraceStepRead {
  step_kind: string
  payload: Record<string, unknown>
  created_at: string
}

export interface QueryTraceRead {
  query_run_id: string
  query_class: string
  route_confidence: number
  permissions_limited: boolean
  steps: QueryTraceStepRead[]
}


export interface LocalLLMFeatureFlags {
  extraction: boolean
  query_routing: boolean
  answer_synthesis: boolean
  signal_explanation: boolean
}

export interface LocalLLMStatusRead {
  enabled: boolean
  configured_model: string
  base_url: string
  timeout_seconds: number
  feature_flags: LocalLLMFeatureFlags
  gateway_reachable: boolean
  gateway_status: 'disabled' | 'unreachable' | 'model_missing' | 'ready'
  available_models: string[]
  configured_model_available: boolean
  checked_at: string
  error: string | null
}

export interface LocalLLMSmokeRead {
  status: 'passed' | 'failed' | 'skipped'
  model: string
  duration_ms: number
  message: string
  checked_at: string
  error: string | null
}

export interface GraphSummary {
  workspace_id: string
  artifact_count: number
  memory_counts: Record<string, number>
  edge_counts: Record<string, number>
  signal_counts: Record<string, number>
}

export interface GraphTimelineItem {
  memory_type: string
  memory_id: string
  title_or_label: string
  event_timestamp: string
  timeline_status: string
  topic_key: string
  source_artifact_id: string
  source_artifact_title: string
  source_chunk_id: string | null
  evidence_span: string | null
  owner_label: string | null
  due_date: string | null
  contradiction_count: number
  supersedes_count: number
  related_count: number
}

export interface GraphTimeline {
  workspace_id: string
  items: GraphTimelineItem[]
}

export interface GraphNeighborhoodNeighbor {
  edge_id: string
  edge_type: string
  direction: 'incoming' | 'outgoing'
  related_memory_type: string
  related_memory_id: string
  related_title_or_label: string
  related_topic_key: string
  related_status: string | null
  evidence_artifact_id: string | null
  evidence_artifact_title: string | null
  evidence_chunk_id: string | null
  evidence_span: string | null
  evidence_provenance: string | null
  confidence_score: number
}

export interface GraphNeighborhood {
  center_memory_type: string
  center_memory_id: string
  center_title_or_label: string
  center_topic_key: string
  center_event_timestamp: string
  neighbors: GraphNeighborhoodNeighbor[]
}

export interface MemoryDetail {
  memory_type: string
  memory_id: string
  title_or_label: string
  normalized_text: string
  confidence_score: number
  event_timestamp: string
  source_artifact_id: string
  source_chunk_id: string | null
  evidence_span: string | null
  status: string | null
  due_date: string | null
  owner_label: string | null
  extraction_method: string
  source_artifact_title: string | null
  source_artifact_review_status: string
  source_chunk_excerpt: string | null
  extraction_fallback_reason: string | null
}

export interface ContradictionEvidence {
  artifact_id: string
  artifact_title: string
  artifact_review_status: string
  chunk_id: string | null
  excerpt: string
  provenance: string
  time_label: string
}

export interface ContradictionItem {
  edge_id: string
  from_node_id: string
  to_node_id: string
  from_type: string
  to_type: string
  from_title: string
  to_title: string
  relation_label: string
  confidence_score: number
  evidence_artifact_id: string | null
  evidence_artifact_review_status: string | null
  evidence_chunk_id: string | null
  evidence_span: string | null
  evidence_provenance: string | null
  from_evidence: ContradictionEvidence
  to_evidence: ContradictionEvidence
  topic_key: string
  ranking_basis: string[]
  uncertainty_note: string | null
}

export interface AssumptionDriftItem {
  assumption_id: string
  title_or_label: string
  status: string
  validity_notes: string | null
  source_artifact_id: string
  source_artifact_review_status: string
  confidence_score: number
  topic_key: string
  supporting_signal_source_artifact_id: string | null
  supporting_signal_artifact_review_status: string | null
  supporting_signal_title: string | null
  supporting_signal_type: string | null
  supporting_signal_memory_id: string | null
  evidence_span: string | null
  evidence_provenance: string | null
  ranking_basis: string[]
  uncertainty_note: string | null
}

export interface NextActionSignalItem {
  signal_id: string
  signal_type: 'next_action'
  title: string
  summary: string
  related_topic: string
  urgency_score: number
  uncertainty_score: number
  grounded_reasoning: string
  recommended_action: string
  supporting_memory_objects: MemoryReference[]
  supporting_evidence: EvidenceReference[]
  source_signal_types: string[]
  ranking_basis: string[]
}

export interface SupersessionItem {
  edge_id: string
  from_node_id: string
  to_node_id: string
  from_type: string
  to_type: string
  from_title: string
  to_title: string
  relation_label: string
  confidence_score: number
  evidence_artifact_id: string | null
  evidence_artifact_title: string | null
  evidence_artifact_review_status: string | null
  evidence_chunk_id: string | null
  evidence_span: string | null
  evidence_provenance: string | null
  topic_key: string
  ranking_basis: string[]
}

export interface PriorRelevantWorkItem {
  prior_artifact_id: string
  prior_artifact_title: string
  prior_artifact_review_status: string
  related_topic: string
  overlap_score: number
  continuity_reason: string
  recommended_action: string
  introduced_memory_objects: MemoryReference[]
  prior_memory_objects: MemoryReference[]
  supporting_evidence: EvidenceReference[]
  ranking_basis: string[]
}

export interface ArtifactProactiveSignals {
  artifact_id: string
  artifact_title: string
  ingestion_status: string
  summary: string
  signal_counts: Record<string, number>
  introduced_contradictions: ContradictionItem[]
  revealed_assumption_drift: AssumptionDriftItem[]
  superseded_memory: SupersessionItem[]
  prior_relevant_work: PriorRelevantWorkItem[]
  recommended_next_actions: NextActionSignalItem[]
  persisted_signals: SignalRead[]
}

export interface SignalRead {
  signal_id: string
  workspace_id: string
  source_artifact_id: string | null
  source_artifact_title: string | null
  signal_type: string
  title: string
  summary: string
  related_topic: string
  urgency_score: number
  uncertainty_score: number
  grounded_reasoning: string
  recommended_action: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface SignalIntelligenceStep {
  step_kind: string
  title: string
  description: string
  supporting_evidence: EvidenceReference[]
  supporting_memory_objects: MemoryReference[]
}

export interface SignalDetail extends SignalRead {
  payload_json: Record<string, unknown>
  supporting_memory_objects: MemoryReference[]
  supporting_evidence: EvidenceReference[]
  intelligence_path: SignalIntelligenceStep[]
}

export interface AuditEventRead {
  event_id: string
  workspace_id: string
  actor_user_id: string | null
  event_type: string
  target_type: string
  target_id: string
  event_metadata: Record<string, unknown>
  timestamp: string
}

export interface SessionState {
  token: string
  expiresAt: string
  user: UserRead
}
export interface MemoryFilesystemRoot {
  node_id: string
  label: string
  node_type: string
  status: string
  description: string
  children_count: number
  metadata: Record<string, unknown>
}

export interface MemoryFilesystemArtifact {
  artifact_id: string
  title: string
  source_type: string
  storage_locator: string
  checksum_sha256: string | null
  mime_type: string
  visibility_scope: string
  ingestion_status: string
  review_status: string
  created_at: string
  updated_at: string
  chunk_count: number
  memory_counts: Record<string, number>
  graph_edge_count: number
  signal_count: number
  organization_path: string[]
  retrieval_state: string
  trust_boundary: string
  coverage_notes: string[]
}

export interface DatabaseBlueprintLayer {
  layer: string
  table_names: string[]
  purpose: string
  write_path: string
  read_path: string
  organization_rule: string
}

export interface OrganizationGuideStep {
  step: string
  title: string
  description: string
}

export interface MemoryFilesystemRead {
  workspace_id: string
  generated_at: string
  roots: MemoryFilesystemRoot[]
  artifacts: MemoryFilesystemArtifact[]
  database_blueprint: DatabaseBlueprintLayer[]
  organization_guide: OrganizationGuideStep[]
}

export interface OrchestrationStageRead {
  stage_key: string
  title: string
  agent_role: string
  purpose: string
  inputs: string[]
  outputs: string[]
  deterministic_gate: string
  authority_level: string
  current_reflection: string
  status: string
}

export interface OrchestrationBlueprintRead {
  workspace_id: string
  generated_at: string
  execution_model: string
  current_runtime_note: string
  stage_catalog: OrchestrationStageRead[]
  spawn_policy: string[]
  current_reflection: Record<string, unknown>
}

export interface OrchestrationStageRunRead {
  stage_run_id: string
  query_run_id: string
  workspace_id: string
  stage_key: string
  status: string
  authority_level: string
  verifier_status: string | null
  input_refs: Record<string, unknown>
  output_summary: Record<string, unknown>
  created_at: string
}

export interface OrchestrationStageRunsRead {
  workspace_id: string
  generated_at: string
  query_run_id: string | null
  runs: OrchestrationStageRunRead[]
}

export interface OrchestrationJobRead {
  job_id: string
  workspace_id: string
  created_by: string
  query_run_id: string | null
  job_kind: string
  stage_key: string | null
  status: string
  priority: number
  payload_json: Record<string, unknown>
  result_json: Record<string, unknown>
  error_message: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  available_at: string
  claimed_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface OrchestrationJobListRead {
  workspace_id: string
  generated_at: string
  jobs: OrchestrationJobRead[]
}

export type ReadinessAreaStatus = 'implemented' | 'partial' | 'planned'

export interface TargetReadinessProofSignal {
  label: string
  value: string
  route: string | null
}

export interface TargetReadinessAreaRead {
  area_key: string
  title: string
  status: ReadinessAreaStatus
  score: number
  promise: string
  demo_reflection: string
  evidence_routes: string[]
  demo_surfaces: string[]
  proof_signals: TargetReadinessProofSignal[]
  remaining_work: string[]
  risks: string[]
}

export interface TargetReadinessRead {
  workspace_id: string
  generated_at: string
  schema_version: 'target_readiness.v1'
  target_score: number
  status_counts: Record<ReadinessAreaStatus, number>
  current_workspace_snapshot: Record<string, unknown>
  areas: TargetReadinessAreaRead[]
  next_best_passes: string[]
  evaluator_gate: {
    name: string
    command: string
    required_checks: string[]
  }
}

export interface TemporalGraphOccurrence {
  occurrence_id: string
  family_id: string
  memory_type: string
  memory_id: string
  claim_family_key: string
  title_or_label: string
  observed_at: string
  valid_from: string
  valid_to: string | null
  source_artifact_id: string
  source_artifact_title: string
  source_chunk_id: string | null
  evidence_span: string | null
  status: string
  confidence_score: number
}

export interface TemporalClaimFamilyRead {
  family_id: string
  claim_family_key: string
  memory_type: string
  title_or_label: string
  status: string
  first_seen_at: string
  latest_seen_at: string
  active_occurrence_id: string | null
  occurrence_count: number
}

export interface TemporalGraphLink {
  edge_id: string
  edge_type: string
  from_occurrence_id: string
  to_occurrence_id: string
  evidence_artifact_id: string | null
  evidence_chunk_id: string | null
  confidence_score: number
}

export interface TemporalGraphRead {
  workspace_id: string
  families: TemporalClaimFamilyRead[]
  occurrences: TemporalGraphOccurrence[]
  links: TemporalGraphLink[]
  sync_summary: Record<string, unknown>
}

export interface ScenarioImpactItem {
  memory_type: string
  memory_id: string
  title_or_label: string
  impact_reason: string
  matched_terms: string[]
  source_artifact_id: string
  source_artifact_title: string
  source_chunk_id: string | null
  confidence_score: number
  evidence_excerpt: string
}

export interface ScenarioTemplateRead {
  template_key: string
  title: string
  confidence_score: number
  matched_terms: string[]
  review_lens: string[]
  example_prompts: string[]
}

export interface ScenarioTemplateCatalogItem {
  template_catalog_version: string
  template_key: string
  title: string
  keywords: string[]
  review_lens: string[]
  example_prompts: string[]
}

export interface ScenarioMemoryRef {
  memory_type: string
  memory_id: string
  title_or_label: string
  source_artifact_id: string
  source_chunk_id: string | null
  confidence_score: number
  matched_terms: string[]
  ranking_key: string[]
}

export interface ScenarioEvidenceRef {
  artifact_id: string
  artifact_title: string
  artifact_review_status: string
  chunk_id: string | null
  excerpt: string
  excerpt_hash: string
}

export interface ScenarioCandidateSnapshotItem extends ScenarioMemoryRef {
  evidence_excerpt_hash: string
  source_artifact_review_status: string
}

export interface ScenarioOmittedReason {
  reason: 'permission_hidden_or_rejected' | 'scenario_budget'
  count: number
}

export interface ScenarioEvidenceBudget {
  max_impacted_memory: number
  selected_memory_count: number
  candidate_memory_count: number
  selected_artifact_count: number
  visible_artifact_count: number
  within_budget: boolean
}

export type ScenarioRankingScoreComponentName = 'matched_scenario_terms' | 'selected_template_confidence_boost'
export type ScenarioRankingSortField = 'confidence_score' | 'memory_type' | 'source_artifact_id' | 'source_chunk_id' | 'memory_id'
export type ScenarioDeterministicInput =
  | 'scenario_text_hash'
  | 'classifier_version'
  | 'template_catalog_version'
  | 'ranking_recipe'
  | 'candidate_snapshot_hash'
  | 'current_user_artifact_permissions'

export interface ScenarioRankingScoreComponent {
  name: ScenarioRankingScoreComponentName
  weight: number
  direction: 'asc' | 'desc'
}

export interface ScenarioRankingSort {
  field: ScenarioRankingSortField
  direction: 'asc' | 'desc'
  null_value?: string | null
}

export interface ScenarioRankingRecipe {
  recipe_version: 'scenario_ranking_recipe.v1'
  score_components: ScenarioRankingScoreComponent[]
  primary_sort: ScenarioRankingSort
  tie_breakers: ScenarioRankingSort[]
}

export interface ScenarioReplayContract {
  deterministic_inputs: ScenarioDeterministicInput[]
  input_snapshot_hash: string
  candidate_snapshot_hash: string
  selection_recipe: ScenarioRankingRecipe
  replay_mode: 'deterministic_selection_summary'
  replay_requires_current_permissions: boolean
  trusted_write_allowed: false
  forecasting_allowed: false
}

export interface ScenarioContextPacketRead {
  schema_version: 'scenario_context_packet.v1'
  packet_type: 'bounded_scenario_impact'
  packet_id: string
  scenario_text_hash: string
  classifier_version: string
  template_catalog_version: string
  ranking_recipe: ScenarioRankingRecipe
  candidate_snapshot_hash: string
  input_snapshot_hash: string
  selected_template_key: string
  scenario_terms: string[]
  selected_memory_ids: string[]
  selected_memory_refs: ScenarioMemoryRef[]
  candidate_memory_snapshot: ScenarioCandidateSnapshotItem[]
  selected_artifact_ids: string[]
  selected_evidence_refs: ScenarioEvidenceRef[]
  omitted_reasons: ScenarioOmittedReason[]
  evidence_budget: ScenarioEvidenceBudget
  replay_contract: ScenarioReplayContract
}

export interface ScenarioImpactRead {
  scenario_text: string
  scenario_template: ScenarioTemplateRead
  candidate_templates: ScenarioTemplateRead[]
  scenario_packet: ScenarioContextPacketRead
  scenario_run_id: string | null
  answer_text: string
  impacted_memory: ScenarioImpactItem[]
  recommended_questions: string[]
  uncertainty_notes: string[]
}

export interface ScenarioRunSummaryRead {
  scenario_run_id: string
  scenario_text_hash: string
  packet_id: string
  selected_template_key: string
  selected_memory_count: number
  candidate_memory_count: number
  replay_verdict: string
  created_at: string
}

export interface ScenarioRunRead {
  scenario_run_id: string
  workspace_id: string
  created_by: string
  scenario_text: string
  scenario_text_hash: string
  packet_id: string
  selected_template_key: string
  input_snapshot_hash: string
  candidate_snapshot_hash: string
  result_payload: ScenarioImpactRead
  replay_summary: Record<string, unknown>
  created_at: string
}

export interface ScenarioRunListRead {
  workspace_id: string
  generated_at: string
  runs: ScenarioRunSummaryRead[]
}

export interface ScenarioReplayRead {
  scenario_run_id: string
  replayed_at: string
  verdict: 'stable' | 'changed' | 'permission_limited'
  original_packet_id: string
  current_packet_id: string
  original_template_key: string
  current_template_key: string
  input_snapshot_changed: boolean
  candidate_snapshot_changed: boolean
  selected_memory_kept: string[]
  selected_memory_added: string[]
  selected_memory_removed: string[]
  summary: string
  current_result: ScenarioImpactRead
}
