# IMPLEMENTATION_ROADMAP.md
## Build Roadmap for Institution Memory Engine

## Phase 0 — Scope lock
- choose one domain for V1
- define supported artifact types
- define supported query types
- freeze anti-goals

## Phase 1 — Architecture and schema
- define modules
- define internal objects
- define graph model
- define API shape

## Phase 2 — Ingestion pipeline
- upload files
- parse files
- chunk files
- store chunks
- index chunks

## Phase 3 — Memory extraction
- extract decisions
- extract assumptions
- extract constraints
- extract commitments
- extract outcomes
- extract entities

## Phase 4 — Graph construction
- build nodes
- build edges
- resolve duplicates
- attach evidence refs
- create contradiction candidates

## Phase 5 — Query and reasoning
- implement query classifier
- implement memory query answering
- implement stale assumption analysis
- implement recommendation generation

## Phase 6 — UX and inspection
- result page
- evidence views
- timeline or graph exploration
- ingestion visibility

## Phase 7 — Governance and polish
- permissions
- audit logs
- workspace boundaries
- result clarity
- failure handling

## Final roadmap rule
Ship the smallest product that proves institutional reasoning.
