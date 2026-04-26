# MVP_IMPLEMENTATION_CONTRACT.md
## Izge MVP Contract

### 1. Contract purpose
This document defines the exact MVP to be implemented. It is the source of truth for scope, architecture, behavior, storage, UI, API coverage, and non-goals. If a feature is not defined here, it is out of scope.

### 2. Product definition
The MVP is a **local-first institutional memory and decision intelligence system** for a **single workspace**.

Its purpose is to reconstruct **product and roadmap history** from internal artifacts and answer evidence-backed questions about:
- decisions,
- contradictions,
- assumption drift,
- and next actions.

It must also support a proactive path in which a newly submitted artifact can be evaluated against existing organizational memory and trigger contradiction, assumption-drift, supersession, and/or grounded next-action signals.

The MVP must not behave or present itself as:
- internal search,
- chat over files,
- a PM copilot,
- a roadmap assistant,
- a generic RAG app,
- a generic agent-memory framework.

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
- weekly reports,
- member-submitted daily/weekly logs,
- member-submitted presentation summaries,
- pasted meeting excerpts,
- intern reports and continuity artifacts.

#### 3.2 Supported input types
The MVP supports exactly:
- Markdown files
- Plain text files
- PDF files
- Pasted text

Constraints:
- PDFs are **text-extractable only**
- **No OCR**
- No images as source artifacts
- No audio/video
- No DOCX
- No slide decks as native files unless converted into supported text form
- No spreadsheets
- No third-party integrations in the MVP

### 4. User/workspace model

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
- review or inspect submitted artifacts,
- run ingestion,
- run queries,
- view contradiction/drift/next-action signals,
- view audit logs,
- manage artifact visibility.

**Member can:**
- submit supported artifacts,
- run queries,
- view signals and results allowed by permissions,
- view only permitted evidence and derived outputs.

#### 4.3 Permission model
Permissions are artifact-scoped and inherited by evidence.

If a user lacks access to an artifact:
- the artifact must not be shown,
- evidence spans from it must not be shown,
- summaries must not leak restricted facts.

If some evidence is hidden, the system may return a partial answer, but it must explicitly note that some relevant evidence may be unavailable due to permissions.

### 5. Product capabilities

#### 5.1 Local-first processing model
The MVP uses company-controlled infrastructure as the primary storage and reasoning environment.
- artifacts are stored locally,
- heavy reasoning runs on a central company-controlled inference node,
- external hosted AI is not required as the primary reasoning layer,
- future optional edge-side small-model participation is not part of MVP acceptance.

#### 5.2 Ingestion
The system must:
- accept supported inputs from local files and pasted text,
- store original files on the local filesystem,
- normalize extracted text,
- split artifacts into ordered chunks,
- run structured extraction,
- persist artifacts, chunks, memory objects, graph relations, signals, and audit events locally.

#### 5.3 Required memory objects
The MVP must extract and persist at minimum:
- **Decision**
- **Assumption**
- **Constraint**
- **Outcome**
- **Commitment**

Optional supporting objects allowed if useful:
- Proposal
- Question
- Topic

Each extracted object must include:
- stable ID,
- workspace ID,
- source artifact reference,
- source chunk reference or quoted evidence span,
- confidence score,
- timestamp when explicit or reasonably inferable,
- normalized text fields needed for reasoning and display.

#### 5.4 Proactive detection on new artifacts
When a newly ingested artifact materially interacts with existing memory, the system must be able to:
- detect likely contradiction,
- detect likely assumption drift,
- detect likely supersession or reopening,
- generate grounded next-action guidance,
- link detections to supporting evidence and related memory objects.

### 6. Locked query classes
The MVP supports exactly four first-class query classes:

1. **Decision lineage**  
2. **Contradiction analysis**  
3. **Assumption drift**  
4. **Next-action guidance**

Users may type queries naturally, but the system must classify each query into one of these four modes before reasoning.

### 7. Answer and signal requirements
Every query answer must include:
- direct answer text,
- query class,
- why this answer,
- supporting evidence references,
- supporting memory objects,
- contradictions section when relevant,
- assumption drift section when relevant,
- recommended next actions when relevant,
- uncertainty or missing-context notes.

Every surfaced signal (contradiction / drift / next action) must include:
- title or summary,
- supporting rationale,
- linked evidence,
- related memory objects,
- urgency/priority signal if available,
- uncertainty/confidence signal if available.

Major historical claims without evidence are not allowed.

### 8. Storage and graph architecture

#### 8.1 Persistence
The MVP uses:
- **SQLite** for application data and graph tables
- **local filesystem** for original files
- **local model runtime / company-controlled inference** for extraction and reasoning

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
- `signals`
- `audit_events`
- `graph_nodes`
- `graph_edges`

Required edge types for MVP include:
- `MENTIONED_IN`
- `BASED_ON`
- `CONSTRAINED_BY`
- `RESULTED_IN`
- `CONTRADICTS`
- `SUPERSEDES`
- `RELATES_TO`

#### 8.3 Retrieval baseline
The MVP must **not** be vector-first.

Baseline retrieval:
- SQLite-backed structured filtering,
- graph traversal,
- evidence lookup,
- SQLite FTS for text retrieval.

Embeddings are optional later, but not required for MVP acceptance.

### 9. Reasoning design
Reasoning must be staged:
1. extraction
2. normalization
3. graph linking
4. query classification or signal classification
5. query-/signal-specific analysis
6. result composition

Reasoning must operate over:
- structured memory objects,
- graph state,
- permitted evidence excerpts.

Raw concatenated documents are not an acceptable primary reasoning substrate.

### 10. Locked stack
The MVP stack is fixed:
- **Backend:** FastAPI
- **Frontend:** React + TypeScript
- **Database:** SQLite
- **File storage:** local filesystem
- **Inference:** company-controlled local/on-prem model runtime

### 11. Required UI surfaces
The MVP UI must include:
- sign in,
- workspace dashboard,
- artifact upload / contribution view,
- pasted text input,
- ingestion status view,
- query input,
- query result view,
- contradiction/drift/next-action signals view,
- memory/decision detail view,
- graph or timeline view,
- admin user/permissions view,
- audit log view.

The UI must present the system as institutional memory and decision intelligence. It must not feel like a chatbot.

### 12. Required API/resource coverage
The backend must expose resources covering:
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
- next-action signal list,
- audit event retrieval.

### 13. Audit requirements
The system must log:
- user sign in,
- user creation and role changes,
- artifact uploads,
- pasted text submissions,
- ingestion runs,
- extraction persistence events,
- proactive signal generation,
- query submissions,
- query result generation,
- permission changes,
- graph update events.

### 14. Non-goals
The MVP must not include:
- third-party integrations,
- OCR,
- enterprise SSO,
- multi-workspace support,
- workflow automation beyond current signal/guidance scope,
- broad analytics dashboards,
- cloud-first dependency,
- full scenario simulation,
- mandatory edge inference on employee devices.

### 15. Acceptance criteria
The MVP is complete only if all are true:

1. Users can upload Markdown, plain text, and PDF files, and submit pasted text.  
2. Files are stored locally.  
3. Extracted memory objects are persisted in SQLite.  
4. The graph is stored explicitly in `graph_nodes` and `graph_edges`.  
5. All four query classes work from the UI.  
6. Newly submitted conflicting artifacts can trigger contradiction and/or drift detection with grounded next-action guidance.  
7. Every answer includes evidence references and structured supporting objects.  
8. Permission-restricted evidence is never exposed to unauthorized users.  
9. Admins can manage users and permissions for the single workspace.  
10. Audit logs exist and include required event types.  
11. The product experience does not collapse into chat-over-files.  
12. The implementation works without external SaaS AI dependency as the primary reasoning layer.

### 16. Final contract rule
If an implementation choice makes the product feel like search, chat-over-files, or a generic assistant, that choice violates the MVP contract.
