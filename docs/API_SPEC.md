# API_SPEC.md
## Izge API Specification

## Core principles
- Evidence-aware and permission-aware by default
- Structured outputs over freeform chat responses
- Separate admin/operational surfaces from member reasoning surfaces
- Support both reactive query flows and proactive post-ingestion signal generation

## Core endpoint coverage

### Authentication and users
- `POST /api/auth/sign-in`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:userId`

### Artifacts and ingestion
- `POST /api/artifacts/upload`
- `POST /api/artifacts/pasted-text`
- `GET /api/artifacts`
- `GET /api/artifacts/:artifactId`
- `POST /api/ingestion/run`
- `GET /api/ingestion/jobs/:jobId`

### Memory and graph
- `GET /api/memory/:memoryId`
- `GET /api/graph/summary`
- `GET /api/graph/timeline`

### Queries and results
- `POST /api/query`
- `GET /api/query/:queryId`

### Signals
- `GET /api/contradictions`
- `GET /api/assumptions/drift`
- `GET /api/next-actions`

### Audit / admin
- `GET /api/audit/events`

## Query request shape
- `query_text`
- `workspace_id`
- optional `preferred_mode`
- optional `filters`

## Query result shape
- `answer_text`
- `why_this_answer`
- `query_class`
- `supporting_memory_objects`
- `supporting_evidence`
- `contradictions`
- `assumption_drift`
- `recommended_next_actions`
- `uncertainty_notes`

## Signal result shape
Each signal item should support fields such as:
- `signal_id`
- `signal_type`
- `title`
- `summary`
- `related_topic`
- `urgency_score`
- `uncertainty_score`
- `grounded_reasoning`
- `supporting_memory_objects`
- `supporting_evidence`

## Design rule
Do not make the API feel like a generic chat endpoint with optional metadata.
The API should clearly support:
- institutional memory reconstruction,
- evidence-backed reasoning,
- proactive signal generation,
- inspectable admin and member workflows.
