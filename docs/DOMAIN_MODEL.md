# DOMAIN_MODEL.md
## Institution Memory Engine Domain Objects

## Core entities
### Workspace
- workspace_id
- name
- description
- created_at

### User
- user_id
- workspace_id
- role
- display_name
- email
- created_at

### Artifact
- artifact_id
- workspace_id
- title
- source_type
- source_path
- mime_type
- uploaded_by
- created_at

### ArtifactChunk
- chunk_id
- artifact_id
- workspace_id
- sequence_number
- text
- metadata

## Memory objects
### Decision
- decision_id
- workspace_id
- title
- normalized_text
- status
- decision_date
- owner_entity_ids
- source_artifact_ids
- confidence_score

### Assumption
- assumption_id
- workspace_id
- statement
- status
- validity_notes
- source_artifact_ids

### Constraint
- constraint_id
- workspace_id
- statement
- category
- source_artifact_ids

### Outcome
- outcome_id
- workspace_id
- description
- outcome_type
- source_artifact_ids
- occurred_at

### Commitment
- commitment_id
- workspace_id
- statement
- owner_entity_ids
- due_date
- status
- source_artifact_ids

## Rule
Do not reduce institutional memory to plain text.
Preserve it as structured objects and relationships.
