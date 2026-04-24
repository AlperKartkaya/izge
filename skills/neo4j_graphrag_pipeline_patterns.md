---
skill_id: neo4j_graphrag_pipeline_patterns
version: "1.0"
priority: "P0"
source_projects: ["Neo4j GraphRAG"]
consumes: ["project_research", "repo_patterns"]
produces: ["pipeline_patterns", "retrieval_hooks", "schema_guidance"]
depends_on: []
---

# Neo4j GraphRAG Pipeline Patterns

## Short description
Capture the reusable Neo4j GraphRAG habits that fit Izge: staged pipeline boundaries, lexical graph support, schema precedence rules, pre-filtered retrieval, and result-formatter hooks.

## What Neo4j GraphRAG is actually good at
The most useful part of Neo4j GraphRAG for Izge is not "GraphRAG" as a buzzword. It is the discipline of treating graph construction and retrieval as explicit, modular components.

The library makes several boundaries obvious:
- load
- split
- embed
- derive or load schema
- extract
- prune
- write
- resolve

That shape is reusable even if Izge stays SQLite-native instead of becoming a Neo4j product.

## Pattern 1. Make the pipeline stages explicit

### The SimpleKGPipeline structure
The pipeline config declares components such as:
- `file_loader`
- `splitter`
- `chunk_embedder`
- `schema`
- `extractor`
- `pruner`
- `writer`
- `resolver`

Each stage has explicit connections. This matters because it prevents ingestion, extraction, and resolution from blurring into one prompt-shaped blob.

### Translation for Izge
Keep separate modules and contracts for:
- artifact ingestion
- chunk normalization
- object extraction
- graph linking
- contradiction and drift analysis
- answer composition

Do not let "one pipeline" become "one opaque function."

## Pattern 2. Keep schema precedence deliberate

Neo4j GraphRAG supports:
- explicit `GraphSchema`
- extracted schema
- effectively free schema

It also warns when multiple schema inputs conflict and gives precedence rules.

### Translation for Izge
Izge should not auto-generate ontology in production, but it should copy the discipline:
- one canonical schema version for the domain
- explicit precedence when overrides exist
- warnings when multiple sources of truth are supplied

If a field set changes, version the schema instead of silently mutating behavior.

## Pattern 3. Keep a lexical graph, not just semantic objects

Neo4j GraphRAG keeps document and chunk nodes as part of the lexical graph and allows them to exist even when entity-relation extraction is not performed.

### Why this matters
Chronology, order, and chunk provenance become much easier to inspect when document and chunk structure survive independently of semantic extraction.

### Translation for Izge
Persist:
- artifact
- chunk
- next/previous chunk links
- page metadata

alongside decision-memory objects. The evidence substrate should be queryable even when semantic extraction fails on parts of the artifact.

## Pattern 4. Use pre-filters before vector search

Neo4j GraphRAG's query builder supports metadata filters for vector search, with explicit guardrails:
- filters are applied before retrieval
- filters require known label/property/dimension metadata
- filters are not supported in hybrid search the same way

### Translation for Izge
Permission and scope filters should narrow candidate sets before retrieval or ranking. Also:
- different retrieval modes have different filtering affordances
- so the product must not pretend all query classes support the same search semantics

That means Izge should prefer:
- structured SQL filters first
- then FTS or semantic retrieval
- then graph traversal

## Pattern 5. Result formatter hooks are valuable

Neo4j GraphRAG retrievers expose `result_formatter` and default record formatting. This is more important than it looks.

### Why this matters
It decouples:
- how the database query returns data
- from how the application wants to consume it

### Translation for Izge
Use a formatter layer that converts SQL rows into:
- evidence packets
- context cards
- graph neighborhood payloads
- trace inspection records

This keeps answer composition and UI code from depending on raw DB row shapes.

## Pattern 6. Partial failure is better than fake completeness

The pipeline allows `on_error="IGNORE"` and continues through chunk-level extraction failures. That is the right operational posture when ingesting large corpora, but only if the failure is surfaced.

### Translation for Izge
Continue when a chunk extractor fails if:
- the artifact is still partly usable,
- the failure is localized,
- and a coverage gap is recorded

Never silently treat skipped chunks as if they were processed.

## Pattern 7. Resolver after write, not fuzzy resolution everywhere

Entity resolution in the SimpleKGPipeline sits after writing. That separation is useful.

### Translation for Izge
Do not smear deduplication, linking, and conflict resolution across every stage. Use:
- extraction to emit candidates,
- persistence to store them,
- resolution to connect them

This makes testing and auditing much easier.

## Pattern 8. Avoid open-ended Text2Cypher as the core product interface

Neo4j GraphRAG exposes Text2Cypher, but the repo and docs make clear it is a flexible retriever surface, not a guarantee of correctness.

### Translation for Izge
Do not build the product around:
- open-ended text-to-SQL
- text-to-graph-query
- or generic "ask the graph anything"

Izge's wedge is stronger when it uses a few opinionated reasoning plans with predictable query shapes.

## Concrete implementation rules for Izge

### Do copy
- stage boundaries
- lexical graph
- schema precedence discipline
- pre-filtering
- result formatter hooks
- explicit resolver stage

### Do not copy
- runtime auto-schema generation in production
- retriever sprawl for its own sake
- Text2Cypher as the default answer path
- database-demo ergonomics that outgrow the product wedge

## Minimal pseudo-code pattern

```python
pipeline = [
    "load_artifact",
    "split_chunks",
    "extract_objects",
    "persist_objects",
    "resolve_links",
    "analyze_query",
    "compose_answer",
]
```

```python
def format_evidence_packet(row):
    return {
        "object_id": row["object_id"],
        "chunk_id": row["chunk_id"],
        "evidence_quote": row["evidence_quote"],
        "page_no": row["page_no"],
        "why_selected": row["why_selected"],
    }
```

## Anti-patterns to avoid
- Letting extraction define the graph schema at runtime.
- Combining filters, ranking, and answer formatting in one function.
- Hiding partial failures.
- Treating raw DB rows as the UI contract.

## References
- Neo4j GraphRAG README
- `simple_kg_builder.py`
- `neo4j_queries.py`
- retriever base and vector retriever implementation
