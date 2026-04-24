---
skill_id: persist_decision_graph_sqlite
version: "1.1"
priority: "P0"
source_projects: ["Graphiti", "Neo4j GraphRAG", "TrustGraph", "SQLite"]
consumes: ["memory_objects"]
produces: ["graph_nodes", "graph_edges", "chunk_fts", "object_provenance"]
depends_on: ["extract_memory_objects_schema_first"]
---

# Explicit Decision Graph Persistence in SQLite

## Short description
Persist memory objects, temporal claim occurrences, evidence lineage, and explicit graph edges in SQLite so Izge can answer lineage, contradiction, drift, and next-action questions without falling back to generic retrieval.

## Why this skill exists
The source projects converge on a hard lesson: if temporal history, graph structure, and provenance are collapsed into one opaque record, the system can retrieve text but cannot reason credibly about change.

For Izge, persistence must preserve four different things:

- canonical source chunks,
- typed memory objects,
- typed graph links,
- and provenance / trace data

They are related, but they are not the same table.

## Storage model to borrow

### From Graphiti
- facts are additive and time-aware
- contradictions invalidate or supersede prior facts rather than deleting them
- comparison sets should be narrowed by comparable entity or claim family

### From Neo4j GraphRAG
- keep the lexical graph alongside the semantic graph
- keep construction stages separate
- write explicit edges and use deterministic traversal instead of "prompting the graph"

### From TrustGraph
- provenance deserves its own storage surface
- extraction-time provenance and query-time trace data are different layers
- a selected edge must be traceable to chunk and artifact evidence without reverse-engineering JSON blobs

## Persistence layers

### 1. Canonical evidence layer
- `artifacts`
- `artifact_chunks`
- `chunk_fts`
- `chunk_links`

### 2. Memory object layer
- `memory_objects`
- `claim_occurrences`
- `object_aliases`

### 3. Graph layer
- `graph_nodes`
- `graph_edges`
- `edge_evidence`

### 4. Provenance layer
- `object_evidence`
- `extraction_runs`
- `query_run_trace`
- `query_trace_steps`

Do not overload `graph_edges` to hold all provenance and query-debug information.

## Recommended data model

### memory_objects
Represents the normalized logical object or claim family anchor.

Suggested fields:
- `object_id`
- `workspace_id`
- `object_kind`
- `subject_key`
- `claim_family_key`
- `canonical_text`
- `adjudication_state`
- `created_at`
- `updated_at`

### claim_occurrences
Represents one observed occurrence of an object in time and evidence.

Suggested fields:
- `occurrence_id`
- `object_id`
- `artifact_id`
- `chunk_id`
- `observed_at`
- `ingested_at`
- `valid_from`
- `valid_to`
- `superseded_by_occurrence_id`
- `supersession_basis`
- `confidence`

This is the table that gives Izge a real historical spine.

### graph_edges
Suggested fields:
- `edge_id`
- `workspace_id`
- `from_object_id`
- `to_object_id`
- `edge_type`
- `valid_from`
- `valid_to`
- `confidence_score`
- `created_at`

### edge_evidence / object_evidence
Suggested fields:
- `edge_id` or `object_id`
- `artifact_id`
- `chunk_id`
- `evidence_quote`
- `char_start`
- `char_end`
- `page_no`
- `extraction_run_id`

## SQLite design rules

### Keep text canonical in one place
Store the canonical chunk text once in `artifact_chunks`, then build `FTS5` as an external-content table.

### Persist explicit typed edges
Use a small fixed edge taxonomy:
- `BASED_ON`
- `SUPPORTED_BY`
- `CONSTRAINED_BY`
- `RESULTED_IN`
- `SUPERSEDES`
- `CONTRADICTS`
- `REOPENS`
- `OWNS`
- `RELATES_TO`
- `ADDRESSES`
- `LEAVES_OPEN`

### Compare within families before linking contradictions
Contradiction and supersession should be computed inside normalized claim families such as:
- same decision family,
- same assumption topic,
- same commitment owner plus deliverable,
- same metric plus target

This is the Graphiti-style narrowing step that keeps contradiction analysis from turning into global fuzzy matching.

## Implementation blueprint

### Step 1. Write evidence rows first
Artifacts and chunks should already exist from ingestion. Do not write memory objects whose chunk lineage does not exist.

### Step 2. Write normalized objects
Persist or upsert into `memory_objects` using stable keys such as:
- `claim_family_key`
- `subject_key`
- normalized kind

### Step 3. Append claim occurrences
Every extraction creates a new occurrence row. This is where Izge keeps additive history.

### Step 4. Link graph edges explicitly
Edges should be created by deterministic linking rules plus targeted model adjudication, not by free-form schema generation.

### Step 5. Run reconciliation after bulk import
Graphiti's current bulk path explicitly does not track edge invalidation. Carry that lesson into Izge:

- bulk import quickly if needed,
- then run a second reconciliation pass to attach `SUPERSEDES` and `CONTRADICTS`,
- and only after that treat the graph as historically complete.

### Step 6. Index for the real query shapes
Add indexes for:
- `claim_family_key`
- `subject_key`
- `object_kind`
- `observed_at`
- `valid_from`
- `artifact_id`
- `chunk_id`
- `edge_type`
- `from_object_id`
- `to_object_id`

## Minimal reproducible code snippets

```sql
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS memory_objects (
  object_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  subject_key TEXT,
  claim_family_key TEXT,
  canonical_text TEXT NOT NULL,
  adjudication_state TEXT NOT NULL DEFAULT 'unreviewed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  observed_at TEXT,
  ingested_at TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  superseded_by_occurrence_id TEXT,
  supersession_basis TEXT,
  confidence REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  edge_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  from_object_id TEXT NOT NULL,
  to_object_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  confidence_score REAL,
  created_at TEXT NOT NULL
);
```

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  text,
  content='artifact_chunks',
  content_rowid='pk'
);
```

```sql
WITH RECURSIVE lineage(object_id, depth) AS (
  SELECT :start_object_id, 0
  UNION ALL
  SELECT e.to_object_id, depth + 1
  FROM graph_edges e
  JOIN lineage l ON e.from_object_id = l.object_id
  WHERE e.edge_type IN ('BASED_ON','CONSTRAINED_BY','RESULTED_IN','SUPERSEDES')
    AND depth < 8
)
SELECT * FROM lineage;
```

## Integration notes
- Keep SQL traversal deterministic for the four fixed query classes.
- Store permission-relevant scope on artifacts and join through evidence, not through denormalized summary caches.
- If JSON is used, use it only for optional metadata, never as the only home for provenance or temporal fields.

## Anti-patterns to avoid
- Last-write-wins updates to memory objects.
- Storing provenance as one opaque JSON field per node or edge.
- Building a hidden graph used only for ranking boosts while the explicit graph becomes non-authoritative.
- Open-ended Text2Cypher as the core product interface.
- Declaring bulk import "done" before reconciliation of supersession and contradiction edges.

## Testing / validation steps
- Fixture: one decision supported by assumptions, constrained by policy, resulting in an outcome, then later superseded.
- Assert that two contradictory occurrences remain present and are linked rather than overwritten.
- Assert that every `CONTRADICTS` or `SUPERSEDES` edge has evidence on both sides.
- Run lineage traversal tests with depth limits and cycle safety.

## Performance considerations
- WAL mode helps read-heavy concurrent access, but writes still need disciplined serialization.
- FTS5 plus typed filters should be the default lexical retrieval substrate.
- Use batched inserts for occurrences and evidence rows; avoid row-at-a-time edge creation for backfills.

## Security / privacy / licensing notes
- Evidence references inherit artifact visibility.
- Never denormalize restricted evidence into unrestricted answer caches.
- Permission checks should operate before retrieval and before answer composition, not only in the UI.

## References
- Graphiti temporal edge invalidation and add-only fact persistence
- Neo4j GraphRAG lexical graph plus staged KG construction
- TrustGraph separation of knowledge, provenance, and query trace layers
