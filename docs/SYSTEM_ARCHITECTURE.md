# SYSTEM_ARCHITECTURE.md
## Izge

## High-level architecture
The system consists of these major layers:
1. Interface Layer
2. Application Layer
3. Intake & Ingestion Layer
4. Extraction & Memory Layer
5. Institutional Graph Layer
6. Reasoning & Guidance Layer
7. Governance Layer
8. Infrastructure Layer

## Layer responsibilities

### 1. Interface Layer
Handles:
- landing/product surfaces,
- admin workspace surfaces,
- member contribution and query surfaces,
- result views,
- signals views,
- graph/timeline views,
- admin controls.

### 2. Application Layer
Handles:
- API routing,
- sessions,
- user/role enforcement,
- ingestion job lifecycle,
- query lifecycle,
- signal surfacing.

### 3. Intake & Ingestion Layer
Handles:
- artifact upload,
- pasted text submission,
- member-submitted logs/reports/notes,
- intake state,
- parsing and chunking.

### 4. Extraction & Memory Layer
Handles:
- structured extraction of decisions, assumptions, constraints, outcomes, commitments,
- topic normalization,
- provenance capture,
- confidence assignment.

### 5. Institutional Graph Layer
Handles:
- explicit graph persistence,
- typed relationships,
- continuity across time,
- contradictions, drift-supporting linkages, supersession/reopening structures.

### 6. Reasoning & Guidance Layer
Handles:
- query classification,
- decision lineage,
- contradiction analysis,
- assumption drift detection,
- next-action guidance,
- proactive evaluation of newly ingested artifacts against existing memory,
- signal generation.

### 7. Governance Layer
Handles:
- role-based access,
- permission-aware evidence,
- audit logging,
- trust surfaces.

### 8. Infrastructure Layer
Handles:
- local filesystem storage,
- SQLite persistence,
- central company-controlled inference runtime,
- future compatibility with optional edge-side model participation.

## Architectural rules
- memory before magic,
- raw documents are not the primary reasoning substrate,
- graph and memory are first-class, not decorative,
- proactive ingestion-time intelligence is part of the product, not a bolt-on,
- central local inference is the MVP default,
- future edge participation is optional and non-blocking,
- trust and inspectability are product requirements.

## Complexity placement
Complexity should live in:
- extraction quality,
- graph linkage,
- contradiction/drift/guidance reasoning,
- evidence and permission handling.

Complexity should not live in:
- unnecessary integrations,
- speculative multi-agent theater,
- premature distributed architecture,
- visual gimmicks that weaken product clarity.
