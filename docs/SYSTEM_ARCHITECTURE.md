# SYSTEM_ARCHITECTURE.md
## Institution Memory Engine

## High-level architecture
The system consists of these major layers:
1. Interface Layer
2. Application Layer
3. Extraction & Memory Layer
4. Decision Graph Layer
5. Reasoning & Guidance Layer
6. Governance Layer
7. Infrastructure Layer

## Layer responsibilities
### Interface Layer
Handles upload, queries, results, graph/timeline views, and admin controls.

### Application Layer
Handles API routing, session management, task lifecycle, ingestion jobs, and result delivery.

### Extraction & Memory Layer
Parses artifacts and extracts decisions, assumptions, constraints, commitments, outcomes, and unresolved questions.

### Decision Graph Layer
Builds graph nodes and edges, links timelines, creates contradiction edges, and tracks assumption drift signals.

### Reasoning & Guidance Layer
Answers memory queries, generates contradiction summaries, detects stale assumptions, and recommends next actions.

### Governance Layer
Enforces workspace permissions, file access rules, and audit logging.

### Infrastructure Layer
Provides local model runtime, relational database, graph store or graph abstraction, vector store, file storage, and indexing jobs.

## Key architectural rules
- do not bury the whole system in one giant LLM prompt,
- preserve structured memory objects,
- preserve graph structure explicitly,
- keep retrieval distinct from reasoning,
- keep evidence references attached,
- keep traceability first-class.
