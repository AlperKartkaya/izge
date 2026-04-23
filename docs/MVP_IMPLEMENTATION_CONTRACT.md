# Izge MVP Contract

### 1. Contract purpose
This document defines the exact MVP to be implemented. It is the source of truth for scope, architecture, behavior, storage, UI, API coverage, and non-goals. If a feature is not defined here, it is out of scope.

### 2. Product definition
The MVP is a **local-first institutional memory and decision intelligence system** for a **single workspace**.

Its purpose is to reconstruct **product and roadmap history** from internal artifacts and answer evidence-backed questions about:
- decisions,
- contradictions,
- assumption drift,
- and next actions.

The MVP must not behave or present itself as:
- internal search,
- chat over files,
- a PM copilot,
- a roadmap assistant,
- a generic RAG app.

**Trajectory note:** This MVP is the first stage of a broader product trajectory that may later include deeper decision guidance and bounded scenario support. That future trajectory introduces **no additional MVP scope, modules, schemas, APIs, or architectural obligations** in this contract.

### 3. Locked scope

#### 3.1 V1 domain
The MVP domain is **product and roadmap history**.

Included examples:
- product strategy notes,
- roadmap documents,
- planning notes,
- decision logs,
- product review notes,
- retrospectives,
- postmortems related to product decisions,
- pasted meeting excerpts.

#### 3.2 Supported input types
The MVP supports exactly:
- Markdown files
- Plain text files
- PDF files
- Pasted text in the UI

Constraints:
- PDFs are **text-extractable only**
- **No OCR**
- No images
- No audio/video
- No DOCX
- No slide decks
- No spreadsheets
- No third-party integrations

### 4. Locked user/workspace model

#### 4.1 Workspace model
- Single workspace only
- Created during setup or first run
- Multi-workspace is out of scope

#### 4.2 Roles
Exactly two roles:
- **Admin**
- **Member**

**Admin can:**
- manage users in the single workspace,
- upload artifacts,
- run ingestion,
- run queries,
- view audit logs,
- manage artifact visibility.

**Member can:**
- upload artifacts if permitted,
- run queries,
- view only permitted evidence and derived outputs.

#### 4.3 Permission model
Permissions are artifact-scoped and inherited by evidence.

If a user lacks access to an artifact:
- the artifact must not be shown,
- evidence spans from it must not be shown,
- summaries must not leak restricted facts.

If some evidence is hidden, the system may return a partial answer, but it must explicitly note that some relevant evidence may be unavailable due to permissions.

### 5. Locked product capabilities

#### 5.1 Ingestion
The system must:
- accept supported inputs from local files and pasted text,
- store original files on the local filesystem,
- normalize extracted text,
- split artifacts into ordered chunks,
- run structured extraction,
- persist artifacts, chunks, memory objects, graph relations, and audit events locally.

#### 5.2 Required memory objects
The MVP must extract and persist at minimum:
- **Decision**
- **Assumption**
- **Constraint**
- **Outcome**
- **Commitment**

Optional supporting objects allowed if useful:
- Proposal
- Question

Each extracted object must include:
- stable ID,
- workspace ID,
- source artifact reference,
- source chunk reference or quoted evidence span,
- confidence score,
- timestamp,
- normalized text fields needed for reasoning and display.

### 6. Locked query classes
The MVP supports exactly four first-class query classes:

1. **Decision lineage**  
   What was decided, when, why, by whom if available, and under which assumptions and constraints.

2. **Contradiction analysis**  
   Where current or later statements, commitments, assumptions, or plans conflict with prior history.

3. **Assumption drift**  
   Which assumptions appear stale, weakened, reversed, or unsupported by later evidence.

4. **Next-action guidance**  
   What the team should do now, grounded in historical evidence and unresolved tensions.

Users may type queries naturally, but the system must classify each query into one of these four modes before reasoning.

### 7. Locked answer requirements
Every answer must include:
- direct answer text,
- query class,
- supporting evidence references,
- supporting memory objects,
- contradictions section when relevant,
- assumption drift section when relevant,
- recommended next actions when relevant,
- uncertainty or missing-context notes.

Major historical claims without evidence are not allowed.

### 8. Locked storage and graph architecture

#### 8.1 Persistence
The MVP uses:
- **SQLite** for application data and graph tables
- **local filesystem** for original files
- **local model runtime** for extraction and reasoning

#### 8.2 Graph rule
The graph must be explicit, not implicit.

Required tables at minimum:
- `workspace`
- `users`
- `artifacts`
- `artifact_chunks`
- `decisions`
- `assumptions`
- `constraints`
- `outcomes`
- `commitments`
- `query_runs`
- `audit_events`
- `graph_nodes`
- `graph_edges`

`graph_nodes` minimum fields:
- `node_id`
- `workspace_id`
- `node_type`
- `entity_id`
- `title_or_label`
- `visibility_scope`
- `created_at`
- `updated_at`

`graph_edges` minimum fields:
- `edge_id`
- `workspace_id`
- `from_node_id`
- `to_node_id`
- `edge_type`
- `evidence_artifact_id`
- `evidence_chunk_id` or `evidence_span`
- `confidence_score`
- `created_at`

Required edge types for MVP:
- `MENTIONED_IN`
- `BASED_ON`
- `CONSTRAINED_BY`
- `RESULTED_IN`
- `CONTRADICTS`
- `SUPERSEDES`
- `OWNS`
- `RELATES_TO`

#### 8.3 Retrieval baseline
The MVP must **not** be vector-first.

Baseline retrieval:
- SQLite-backed structured filtering,
- graph traversal,
- evidence lookup,
- and SQLite FTS for text retrieval.

Embeddings are optional later, but not required for MVP acceptance.

#### 8.4 Portability rule
The schema must be designed so it can migrate cleanly to Postgres later, but the MVP implementation remains SQLite.

### 9. Locked reasoning design

#### 9.1 Architecture rule
The system must not rely on one giant prompt.

Reasoning must be staged:
1. extraction
2. normalization
3. graph linking
4. query classification
5. query-specific analysis
6. result composition

#### 9.2 Reasoning inputs
Reasoning must operate over:
- structured memory objects,
- graph state,
- permitted evidence excerpts.

Raw concatenated documents are not an acceptable primary reasoning substrate.

#### 9.3 Query-specific behavior
- **Decision lineage** must traverse related decisions, assumptions, constraints, outcomes, commitments, and evidence in temporal order where possible.
- **Contradiction analysis** must compare semantically related claims across time and show evidence on both sides.
- **Assumption drift** must identify assumptions weakened or invalidated by later evidence.
- **Next-action guidance** must be grounded in historical evidence and unresolved tensions, not generic advice.

### 10. Locked system stack
The MVP stack is fixed:
- **Backend:** FastAPI
- **Frontend:** React + TypeScript
- **Database:** SQLite
- **File storage:** local filesystem
- **Model runtime:** local model runtime

Changing the stack is out of scope unless there is a hard implementation blocker.

### 11. Locked UI surfaces
The MVP UI must include:
- sign in,
- workspace dashboard,
- artifact upload,
- pasted text input,
- ingestion status view,
- query input,
- query result view,
- memory/decision detail view,
- graph or timeline view,
- admin user/permissions view,
- audit log view.

#### 11.1 Result view sections
Every result view must display:
- Direct Answer
- Why This Answer
- Supporting Evidence
- Related Decisions and Memory Objects
- Contradictions or Tensions
- Assumption Drift
- Recommended Next Actions
- Uncertainty or Missing Context

#### 11.2 UX rule
The UI must present the system as institutional memory and decision intelligence. It must not feel like a chatbot.

### 12. Locked API coverage
The backend must expose routes covering:
- authentication,
- current user,
- user management,
- artifact upload,
- pasted text submission,
- artifact list/detail,
- ingestion run creation,
- ingestion job status,
- query submission,
- query result retrieval,
- graph summary,
- memory object detail,
- contradiction list,
- assumption drift list,
- audit event retrieval.

Exact route names may vary, but this resource coverage is mandatory.

### 13. Locked audit requirements
The system must log:
- user sign in,
- user creation and role changes,
- artifact uploads,
- pasted text submissions,
- ingestion runs,
- extraction persistence events,
- query submissions,
- query result generation,
- permission changes,
- graph update events.

Each audit event must include:
- `event_id`
- `workspace_id`
- `actor_user_id` when applicable
- `event_type`
- `target_type`
- `target_id`
- `timestamp`
- `event_metadata`

### 14. Non-goals
The MVP must not include:
- third-party integrations,
- OCR,
- enterprise SSO,
- multi-workspace support,
- workflow automation,
- outbound actions,
- generic semantic search framing,
- generic RAG positioning,
- fake multi-agent theater,
- broad analytics dashboards,
- cloud-first dependency,
- autonomous task execution.

### 15. Acceptance criteria
The MVP is complete only if all are true:

1. Users can upload Markdown, plain text, and PDF files, and submit pasted text.  
2. Files are stored locally.  
3. Extracted memory objects are persisted in SQLite.  
4. The graph is stored explicitly in `graph_nodes` and `graph_edges`.  
5. All four query classes work from the UI.  
6. Every answer includes evidence references and structured supporting objects.  
7. Permission-restricted evidence is never exposed to unauthorized users.  
8. Admins can manage users and permissions for the single workspace.  
9. Audit logs exist and include required event types.  
10. The product experience does not collapse into chat-over-files.  
11. The implementation works without external SaaS integrations.  

### 16. Final contract rule
If an implementation choice makes the product feel like search, chat-over-files, or a generic assistant, that choice violates the MVP contract.
