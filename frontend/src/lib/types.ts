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
  created_at: string
  updated_at: string
}

export interface ArtifactDetail extends ArtifactRead {
  extracted_text_preview: string | null
  chunk_count: number
  permitted_user_ids: string[]
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

export interface EvidenceReference {
  artifact_id: string
  artifact_title: string
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

export interface GraphSummary {
  workspace_id: string
  artifact_count: number
  memory_counts: Record<string, number>
  edge_counts: Record<string, number>
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
}

export interface ContradictionEvidence {
  artifact_id: string
  artifact_title: string
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
  confidence_score: number
  topic_key: string
  supporting_signal_title: string | null
  supporting_signal_type: string | null
  supporting_signal_memory_id: string | null
  evidence_span: string | null
  evidence_provenance: string | null
  ranking_basis: string[]
  uncertainty_note: string | null
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
