# DOMAIN_MODEL.md
## Izge Domain Model

## Core entities

### Workspace
- `workspace_id`
- `name`
- `description`
- `created_at`

### User
- `user_id`
- `workspace_id`
- `role` (`admin` | `member`)
- `display_name`
- `email`
- `created_at`

### Artifact
- `artifact_id`
- `workspace_id`
- `title`
- `source_type`
- `source_path`
- `mime_type`
- `uploaded_by`
- `intake_status` (`submitted` | `processed` | optional `reviewed`)
- `created_at`

### ArtifactChunk
- `chunk_id`
- `artifact_id`
- `workspace_id`
- `sequence_number`
- `text`
- `metadata`

## Memory objects

### Decision
- `decision_id`
- `workspace_id`
- `title`
- `normalized_text`
- `status`
- `decision_date`
- `topic_key`
- `source_artifact_ids`
- `confidence_score`

### Assumption
- `assumption_id`
- `workspace_id`
- `statement`
- `status`
- `topic_key`
- `validity_notes`
- `source_artifact_ids`
- `confidence_score`

### Constraint
- `constraint_id`
- `workspace_id`
- `statement`
- `topic_key`
- `constraint_type`
- `source_artifact_ids`
- `confidence_score`

### Outcome
- `outcome_id`
- `workspace_id`
- `statement`
- `topic_key`
- `status`
- `source_artifact_ids`
- `confidence_score`

### Commitment
- `commitment_id`
- `workspace_id`
- `statement`
- `topic_key`
- `owner`
- `due_date`
- `status`
- `source_artifact_ids`
- `confidence_score`

## Signal objects

### ContradictionSignal
- `signal_id`
- `workspace_id`
- `signal_type` = `contradiction`
- `title`
- `related_topic`
- `urgency_score`
- `uncertainty_score`
- `grounded_reasoning`
- `supporting_memory_object_ids`
- `supporting_evidence_refs`
- `created_at`

### AssumptionDriftSignal
- `signal_id`
- `workspace_id`
- `signal_type` = `assumption_drift`
- `title`
- `related_topic`
- `urgency_score`
- `uncertainty_score`
- `grounded_reasoning`
- `supporting_memory_object_ids`
- `supporting_evidence_refs`
- `created_at`

### NextActionSignal
- `signal_id`
- `workspace_id`
- `signal_type` = `next_action`
- `title`
- `related_topic`
- `urgency_score`
- `uncertainty_score`
- `grounded_reasoning`
- `recommended_action`
- `supporting_memory_object_ids`
- `supporting_evidence_refs`
- `created_at`

## Domain rules
- artifacts are sources,
- memory objects are extracted interpretations grounded in sources,
- graph relations connect memory objects and sources,
- signals are derived products of memory + graph + reasoning,
- permissions propagate from artifacts to evidence and derived outputs,
- continuity use cases (e.g. recurring intern work) should rely on topic continuity and prior artifact lineage rather than flat search alone.
