---
skill_id: mem0_additive_memory_patterns
version: "1.0"
priority: "P0"
source_projects: ["Mem0"]
consumes: ["project_research", "repo_patterns"]
produces: ["additive_extraction_patterns", "hybrid_retrieval_patterns", "entity_linking_patterns"]
depends_on: []
---

# Mem0 Additive Memory Patterns

## Short description
Capture the Mem0 patterns that fit Izge: add-only extraction, use of prior memories for dedup and linking rather than overwrite, multi-signal retrieval, and batch entity linking.

## What Mem0 is actually good at
Mem0's most useful contribution to Izge is not its product framing. It is the operational decision to make memory extraction additive and retrieval pragmatic.

The most reusable parts are:
- single-pass add-only extraction
- related-memory linking
- batch hash dedup
- semantic plus BM25 plus entity-boost retrieval

## Pattern 1. Extraction is ADD-only

Mem0's recent OSS direction is explicit:
- one LLM call
- ADD only
- no extraction-time UPDATE
- no extraction-time DELETE

### Why this matters
The extractor's job is recall, not historical adjudication. It should miss as little as possible, then let downstream stages deduplicate, link, rerank, and interpret.

### Translation for Izge
Extraction should append claim occurrences. Do not update or delete previous decisions, assumptions, or commitments in the extraction stage.

## Pattern 2. Existing memories are for dedup and linking only

Mem0's additive prompt is unusually clear:
- new memories must come from new messages
- existing memories are only for duplicate checking and linking

### Translation for Izge
During extraction:
- use prior claim families to decide whether a new occurrence links to an old family
- but do not let old memory text become substitute evidence for new extraction

This prevents the system from "remembering its own memory" instead of the source artifact.

## Pattern 3. Prefer context-rich memories over brittle fragments

Mem0's prompt pushes extraction toward self-contained memories that preserve the surrounding context when it materially changes meaning.

### Why this matters
An isolated fact often becomes useless later because the why or change context is lost.

### Translation for Izge
Keep context together when it is essential:
- "Decision moved from November to December because holiday freeze reduced QA time"

Split only when multiple reusable objects really exist:
- decision
- constraint
- commitment

## Pattern 4. Ground relative time to observation date

Mem0's additive prompt uses observation date, not system date, to resolve expressions such as:
- yesterday
- last week
- next month

### Translation for Izge
When extracting from artifacts or dated conversations, resolve relative dates against artifact-local observation time or document timestamp, not the current clock at ingestion.

## Pattern 5. Use batch hash dedup after extraction

Mem0's memory pipeline does:
- batch embed extracted texts
- hash dedup against existing hashes
- hash dedup within the current batch
- then persist

### Translation for Izge
For claim occurrences:
- exact duplicates should be removed cheaply by normalized text plus source anchors
- semantic contradiction or supersession should happen later

This preserves model budget for real reasoning problems.

## Pattern 6. Hybrid retrieval should fuse multiple simple signals

Mem0's search flow:
1. lemmatize query for BM25
2. extract query entities
3. run semantic vector search
4. run keyword search
5. compute normalized BM25 scores
6. compute entity boosts
7. build candidate set from semantic results
8. combine scores additively
9. optionally rerank

It also gates by semantic threshold before combining.

### Why this matters
This is a pragmatic alternative to over-engineered retrieval stacks.

### Translation for Izge
Use:
- structured filters first
- FTS or BM25 second
- optional embeddings third
- entity or topic boosts as ranking modifiers

But keep graph reasoning as the final deciding stage for lineage, contradiction, and drift.

## Pattern 7. Entity linking should happen in batch

Mem0's pipeline:
- extracts entities across newly added memories
- deduplicates them globally within the batch
- embeds each unique entity once
- searches existing entity records
- updates linked memory IDs when similarity is high

### Translation for Izge
For newly extracted objects:
- batch-normalize actors, teams, projects, and initiatives
- link them once per batch
- store family or relation links separately from the original object text

This reduces duplicate work and keeps linking deterministic.

## Pattern 8. Retrieval scoring should stay understandable

Mem0's scoring logic is intentionally simple:
- start with semantic score
- add BM25 if available
- add entity boost if available
- normalize by the maximum active signal weight
- filter out low-semantic candidates before the boost helps them

### Translation for Izge
The ranking layer should be understandable enough that Izge can later explain why an evidence packet or claim was selected.

Opaque fused rankers are hard to debug in institutional memory products.

## Concrete implementation rules for Izge

### Do copy
- add-only extraction
- prior-memory linking without overwrite
- hash dedup for exact repeats
- simple multi-signal ranking
- batch entity normalization and linking

### Do not copy
- user/session/agent memory scopes as the product model
- graph memory as an optional extra that can disappear
- personalization-first framing

## Minimal pseudo-code pattern

```python
def add_only_extract(new_chunk, related_objects):
    extracted = llm_extract(new_chunk, related_objects=related_objects)
    deduped = hash_dedup(extracted)
    linked = link_to_existing_families(deduped, related_objects)
    return linked
```

```python
def score_candidate(semantic, bm25, entity_boost, has_bm25, has_entity):
    max_possible = 1.0
    if has_bm25:
        max_possible += 1.0
    if has_entity:
        max_possible += 0.5
    return min((semantic + bm25 + entity_boost) / max_possible, 1.0)
```

## Anti-patterns to avoid
- Extraction-time update and delete logic.
- Treating an existing entity mention as proof no new memory should be extracted about that entity.
- Using graph storage only as a retrieval boost and hiding it from the product model.
- Letting BM25 rescue semantically irrelevant candidates without thresholding.

## References
- Mem0 README
- Mem0 additive extraction prompt
- Mem0 memory pipeline and scoring utilities
