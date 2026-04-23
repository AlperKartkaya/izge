# API_SPEC.md
## Institution Memory Engine API Specification

## Core endpoints
- POST /api/workspaces
- GET /api/workspaces/:workspaceId
- POST /api/artifacts/upload
- GET /api/artifacts/:artifactId
- POST /api/ingestion/run
- GET /api/ingestion/jobs/:jobId
- GET /api/graph/summary
- GET /api/graph/decision/:decisionId
- POST /api/query
- GET /api/query/:queryId
- GET /api/contradictions
- GET /api/assumptions/stale
- GET /api/commitments/unresolved
- GET /api/timeline
- GET /api/audit/events

## Query result shape
- answer_text
- answer_type
- supporting_nodes
- supporting_evidence
- contradictions
- stale_assumptions
- recommended_next_actions
- uncertainty_notes

## Design rule
Do not make the API feel like a chat wrapper.
It should reflect a memory-and-reasoning system with structured outputs.
